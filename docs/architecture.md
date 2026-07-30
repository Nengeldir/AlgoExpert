# Architecture Decisions

## Overview

```
┌─────────────────────────────────────┐   ┌──────────────────────┐
│  Browser (React SPA)                │   │  External cron       │
│  /today /history /settings /admin   │   │  (cron-job.org)      │
│                                     │   │                      │
│  localStorage: JWT + admin token    │   │  POST /admin/smi/*   │
└─────────────┬───────────────────────┘   │  POST /admin/youtube │
              │ HTTP/JSON (fetch)         └──────────┬───────────┘
              │ Vite dev proxy → :3000               │ Bearer ADMIN_TOKEN
              ▼                                      ▼
┌─────────────────────────────────────────────────────────────────┐
│  Fastify API  :3000                                             │
│                                                                 │
│  /health                                                        │
│  /api/auth/*     register, login, forgot/reset-password         │
│  /api/me         profile + settings         (JWT required)      │
│  /api/questions  open questions             (JWT required)      │
│  /api/votes      cast a vote                (JWT required)      │
│  /api/history    own past votes             (JWT required)      │
│  /admin/*        questions, resolve, export (Bearer token)      │
│  /admin/smi/*    daily create + resolve     (Bearer token)      │
│  /admin/youtube/* suggest, approve, tick    (Bearer token)      │
└─────────────┬───────────────────────────────────────────────────┘
              │ better-sqlite3 (synchronous)
              ▼                          ┌───────────────────────┐
┌─────────────────────────────────────┐  │  Yahoo Finance (SMI)  │
│  SQLite (WAL mode)                  │  │  YouTube Data API v3  │
│  ./data/app.db  — /data on Railway  │◄─┤  Resend (email)       │
│                                     │  └───────────────────────┘
│  users, password_resets, questions, │
│  votes, smi_questions,              │
│  youtube_suggestions                │
└─────────────────────────────────────┘
```

Nothing schedules itself inside the process — there are no timers. Every time-driven
action is an idempotent HTTP endpoint invoked by an external scheduler, which is what
lets the container sleep between requests and makes every scheduled action reproducible
by hand. See [the operator handbook](../docs-site/content/cron-setup.md).

## Why SQLite?

**Chosen over PostgreSQL/MySQL because:**

1. **Zero ops**: No separate database container to manage. The file lives in a named Docker volume. Perfect for a course app with one TA managing it.
2. **WAL mode**: Write-Ahead Logging gives us concurrent readers alongside a single writer — more than sufficient for a few hundred students voting at staggered times.
3. **Data portability**: Backing up or moving the database is `cp app.db backup.db`. Easy for end-of-course archival.
4. **better-sqlite3**: Synchronous API avoids async complexity in route handlers. The library is battle-tested and significantly faster than `sqlite3` (async).

**When to reconsider**: If the app needs multiple concurrent writers (e.g., multi-server deployment) or complex analytics queries, migrate to PostgreSQL.

## Why Fastify?

1. **Schema validation**: Fastify validates request bodies against JSON Schema at the framework level. We get type-safe, well-documented API contracts with no extra library.
2. **Plugin system**: `@fastify/jwt` and `@fastify/cors` compose cleanly. Adding new plugins (rate limiting, file upload) is a one-liner.
3. **Performance**: Fastest Node.js HTTP framework by benchmark — relevant because `/api/questions` is hit by all students within a narrow time window.
4. **TypeScript first**: Excellent type inference for route handlers and plugin decorators.

**Alternative considered**: Express — rejected because it lacks built-in schema validation and the plugin ecosystem is less structured.

## Why a monorepo?

Keeps frontend and backend in a single `git clone`. TAs get the full picture without juggling two repositories. Shared TypeScript interfaces (e.g., API response shapes) can be extracted to a `packages/shared` package if they diverge significantly.

npm workspaces provide isolated `node_modules` per package while sharing a common lockfile.

`docs-site/` is deliberately **outside** the workspace list. The backend and frontend
Docker builds copy the root `package-lock.json` before installing, so anything added to
the workspace set becomes a dependency of those builds. Keeping the docs isolated means
a markdown-renderer bump can never break a deploy of the app.

## Auth design

- **JWT, 30-day expiry, stored in localStorage**: Simple for a course context. Not hardened against XSS (no httpOnly cookie), but the attack surface is low for an intranet-facing app. A TA can rotate `JWT_SECRET` to invalidate all sessions if needed.
- **Pseudonym plus email**: login accepts either (`WHERE pseudonym = ? OR email = ?`). The email exists only for login and password recovery and is never exposed publicly, so the identity used in lecture stays pseudonymous.
- **Password reset via one-time token**: the emailed token is stored only as its SHA-256 hash, expires after an hour, and is single-use. `forgot-password` always returns a generic 200 so the endpoint cannot be used to enumerate registered addresses.
- **bcrypt (10 rounds)**: Industry-standard password hashing. Argon2 would be marginally stronger but adds a native binary dependency that complicates Docker builds.
- **Admin bearer token**: Single static secret from env var. No need for admin user management for a TA workflow.

## Database schema

```sql
users               (id, pseudonym UNIQUE, email UNIQUE, password_hash,
                     email_notifications, created_at)
password_resets     (id, user_id FK, token_hash, expires_at, used_at, created_at)
questions           (id, title, description, option_a, option_b, image_url,
                     option_a_image, option_b_image, option_a_views, option_b_views,
                     deadline, published_at, race_starts_at, race_ends_at,
                     resolved_at, ground_truth, notified_at, created_at)
votes               (id, user_id FK, question_id FK, choice, is_correct, voted_at)
                    UNIQUE(user_id, question_id)
smi_questions       (id, question_date UNIQUE, question_id FK,
                     prev_close, prev_date, created_at)
youtube_suggestions (id, suggested_date UNIQUE, question_id FK, approved,
                     video_{a,b}_{id,title,channel,thumbnail,subscribers,
                                  published_at,views},
                     race_start_views_{a,b}, race_start_at,
                     race_end_views_{a,b},   race_end_at, created_at)
```

`is_correct` is `NULL` until the question is resolved, then `0` or `1`. This lets the frontend distinguish "unresolved" from "wrong" without a separate status field.

The three timestamp columns on `questions` encode the fairness rule: `published_at` gates
visibility, `deadline` closes voting, and `race_starts_at`/`race_ends_at` bound the window
actually being measured. `race_starts_at` equals `deadline` by construction so the two
windows cannot overlap — see [scheduling](#scheduling-and-the-fairness-rule).

`race_start_at`/`race_end_at` on `youtube_suggestions` (singular, no `s`) are easy to
confuse with the question's `race_starts_at`/`race_ends_at`. The question columns are the
*nominal* schedule; the suggestion columns record when the snapshot was *actually* taken,
so cron slop is auditable rather than assumed.

### Migrations

There is no migration framework. `initDb()` creates tables with `CREATE TABLE IF NOT
EXISTS`, then runs a list of additive `ALTER TABLE` statements wrapped in try/catch —
each one either applies or fails harmlessly because the column already exists. Adding a
column means appending one line to that array in `db/migrate.ts`.

This works because every added column is nullable or has a default. It would not survive
a column rename or a type change; those need a manual table rebuild.

## Scheduling and the fairness rule

Questions run on fixed Europe/Zurich anchors — publish 08:00, voting closes 12:00, the
measured window runs 12:00–24:00. The voting window and the measured window must never
overlap, or a late voter observes the outcome instead of predicting it, which both
inflates their accuracy and destroys the prediction heterogeneity the Expert Algorithm
depends on.

`services/schedule.ts` owns the anchors and handles the CET/CEST switch by probing the
offset for the specific date rather than assuming a fixed `+01:00`.

**Timestamps are ISO-8601 strings; never compare them against `datetime('now')`.** SQLite
compares TEXT lexicographically and ISO's `T` (0x54) sorts above the space (0x20) that
`datetime('now')` emits, so `deadline < datetime('now')` stays false until the UTC date
rolls over. Bind `new Date().toISOString()` as a parameter instead.

Full rationale and the known residual leak in the SMI question:
[operator handbook → question lifecycle](../docs-site/content/question-lifecycle.md).

## Email notifications

New-question announcements are dispatched by an idempotent cron endpoint
(`POST /admin/notifications/dispatch` → `services/notifications.ts`), not as a side effect
of creating the question. Three reasons, in order of importance:

1. **Questions are created before they are published.** A YouTube pair can be approved at
   07:00 for an 08:00 slot; SMI questions are created by the morning cron. Emailing at
   creation time would announce a question that `GET /api/questions` still hides — and
   would leak its content ahead of the slot.
2. **The container may be asleep.** There are no in-process timers anywhere in this
   backend, so "send at 08:00" has to be an endpoint somebody calls.
3. **Retries and de-duplication need a ledger.** `questions.notified_at` is that ledger, so
   a tight cron interval only shortens the announcement delay; it cannot double-send.

Two properties worth preserving if this code is touched:

- **One message per recipient**, via Resend's batch endpoint. A single email with many `to`
  addresses would show every participant's address to everyone else, defeating the
  pseudonymity the lecture relies on.
- **A staleness cut-off** (24 h since publish): such questions are marked processed and
  skipped. Without it, deploying the feature or restoring a backup announces every
  still-open question that predates the column, and a cron outage produces announcements
  that arrive minutes before voting closes.

## Data flow for the lecture

```
Week of voting
     │
     ▼
GET /admin/export?format=csv
     │
     ▼
Spreadsheet / R / Python notebook
     │  applies Weighted Majority
     ▼
Live projection in lecture
```

See [algorithm.md](algorithm.md) for the Expert Algorithm details.

## Where the rest of the documentation lives

| Audience | Document |
|----------|----------|
| Running the app day to day | `docs-site/` — the operator handbook (deployable site) |
| Understanding the algorithm | [algorithm.md](algorithm.md) |
| Running the live analysis | [`analysis/README.md`](../analysis/README.md) |
| Changing the app | [extending.md](extending.md) |
| Getting it started | [`README.md`](../README.md) |

This file covers **why the app is built the way it is**. Operational "how do I" questions
belong in the handbook, not here.
