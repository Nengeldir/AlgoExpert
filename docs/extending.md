# Extending the App — TA Guide

This document describes how to modify and extend the Expert Algorithm app for future course iterations.

---

## Central Configuration Locations

| What                          | File                                              |
|-------------------------------|---------------------------------------------------|
| Environment variables         | `.env` (copy from `.env.example`)                 |
| Admin token                   | `ADMIN_TOKEN` in `.env`                           |
| JWT secret                    | `JWT_SECRET` in `.env`                            |
| Database path                 | `DATABASE_PATH` in `.env`                         |
| Database schema               | `apps/backend/src/db/migrate.ts`                  |
| Seed data                     | `apps/backend/src/db/seed.ts`                     |
| API routes                    | `apps/backend/src/routes/`                        |
| Daily schedule anchors        | `apps/backend/src/services/schedule.ts`           |
| Automated question sources    | `apps/backend/src/services/{smiService,youtube,youtubeResolver}.ts` |
| Design tokens (colors, fonts) | `apps/frontend/src/tokens.css`                    |
| Frontend pages                | `apps/frontend/src/pages/`                        |
| Operator handbook content     | `docs-site/content/*.md`                          |
| Handbook navigation           | `docs-site/site.config.mjs`                       |

---

## How to Add a New Question Type

Currently questions are binary (option A / option B). To add a new type (e.g., numeric range, multiple choice):

### 1. Extend the schema

In `apps/backend/src/db/migrate.ts`, add a column:

```sql
ALTER TABLE questions ADD COLUMN question_type TEXT NOT NULL DEFAULT 'binary';
ALTER TABLE questions ADD COLUMN options_json TEXT; -- JSON array for multi-choice
```

Add a migration wrapper so existing databases are upgraded on next start:

```typescript
// In initDb(), after db.exec(SCHEMA):
const cols = db.prepare("PRAGMA table_info(questions)").all() as { name: string }[]
if (!cols.some(c => c.name === 'question_type')) {
  db.exec("ALTER TABLE questions ADD COLUMN question_type TEXT NOT NULL DEFAULT 'binary'")
}
```

### 2. Update the backend route

In `apps/backend/src/routes/admin.ts`, add `question_type` and `options_json` to the `CreateQuestionBody` interface and the INSERT statement.

In `apps/backend/src/routes/votes.ts`, validate that `choice` is valid for the question type (e.g., one of the JSON options).

### 3. Update the frontend

In `apps/frontend/src/api/client.ts`, add `question_type` and `options?: string[]` to the `Question` interface.

In `apps/frontend/src/pages/Today.tsx`, add a branch in `QuestionCard` that renders a radio group or text input when `question_type !== 'binary'`.

---

## How to Adjust Vote Eligibility / Filtering

The current rule: a student can vote if `deadline > now` and the question has no `ground_truth`.

To filter by other criteria (e.g., only students who attended a lecture):

1. Add an `eligible_user_ids` table or a `lecture_checkin` flag to `users`.
2. In `apps/backend/src/routes/votes.ts`, add a check:

```typescript
const eligibility = app.db
  .prepare('SELECT 1 FROM eligible_users WHERE user_id = ? AND question_id = ?')
  .get(userId, question_id)
if (!eligibility) return reply.status(403).send({ error: 'Not eligible to vote.' })
```

3. Populate eligibility via a new admin endpoint or an import script.

---

## How to Add Push Notifications

The service worker is already scaffolded at `apps/frontend/public/sw.js`.

1. **Generate VAPID keys** (one time):
   ```bash
   npx web-push generate-vapid-keys
   ```
   Add `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` to `.env`.

2. **Store push subscriptions**: Add a `push_subscriptions` table:
   ```sql
   CREATE TABLE push_subscriptions (
     id         INTEGER PRIMARY KEY AUTOINCREMENT,
     user_id    INTEGER NOT NULL REFERENCES users(id),
     endpoint   TEXT NOT NULL UNIQUE,
     p256dh     TEXT NOT NULL,
     auth       TEXT NOT NULL,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   ```

3. **Backend**: Add `POST /api/push/subscribe` (JWT-protected) that saves the subscription. Add `web-push` package and send notifications from `apps/backend/src/routes/admin.ts` when a question is created.

4. **Frontend**: In `apps/frontend/src/main.tsx`, uncomment the service worker registration. In a new `usePushSubscription` hook, call `serviceWorker.pushManager.subscribe()` and POST to `/api/push/subscribe`.

5. **Service worker**: In `apps/frontend/public/sw.js`, implement the `push` event handler to show a notification.

---

## How to Add a New Automated Question Source

SMI and YouTube are both **already implemented** — read them before writing a third, since
the shape is identical and worth copying rather than reinventing.

| Piece | SMI | YouTube |
|-------|-----|---------|
| Service (fetch + create + resolve) | `services/smiService.ts` | `services/youtube.ts`, `services/youtubeResolver.ts` |
| Routes | `routes/smi.ts` | `routes/youtube.ts` |
| Bookkeeping table | `smi_questions` | `youtube_suggestions` |
| Cron endpoints | `/admin/smi/daily`, `/admin/smi/resolve` | `/admin/youtube/resolve` (a tick driving both ends) |

To add a source, follow the same four steps:

1. **A bookkeeping table** in `db/migrate.ts` keyed by date, holding whatever the resolver
   will need later (a reference price, a baseline measurement) plus a nullable
   `question_id` linking to the published question.
2. **A service** exporting a create function and a resolve function, both taking
   `(db, log)` and both **idempotent** — they must be safe to call repeatedly, because
   the recommended cron setup deliberately fires duplicates (see below).
3. **Routes** under `/admin/<source>/` registered in `index.ts`, each returning
   `{ ok: true, log }` so a TA can read what happened by curling the endpoint.
4. **Cron jobs** pointed at those routes.

Two constraints are not optional:

- **Use `services/schedule.ts` for timestamps.** Call `nextQuestionSchedule()` rather than
  computing your own. It anchors the question to the fixed 08:00 / 12:00 / 24:00 Zurich
  slots and handles CET/CEST. Deriving times from `Date.now()` instead makes the window
  depend on when the cron happened to fire.
- **Never let the voting window overlap the measured window.** `race_starts_at` must be
  at or after `deadline`. Overlap does not raise an error; it silently lets late voters
  observe the outcome, which corrupts the experiment. This is explained in full in
  [the operator handbook](../docs-site/content/question-lifecycle.md).

### Why there is no in-process scheduler

There are no `setInterval` calls and no `node-cron`. Every time-driven action is an
idempotent HTTP endpoint called by an external scheduler (cron-job.org in production).

That keeps the container free to sleep between requests, and it makes every scheduled
action reproducible by hand — debugging a missed job is `curl` plus reading the returned
`log`, not attaching to a running process. Adding an in-process timer would give that up
and is not the direction to go.

---

## Running the App Without Docker

```bash
node --version   # must be ≥ 20
npm install
cp .env.example .env
npm run dev      # starts both services with hot-reload
```

Backend runs on `:3000`, frontend on `:5173` (with proxy to backend).

---

## Resetting for a New Semester

```bash
docker compose down -v          # removes db-data volume
docker compose up --build -d
docker compose exec backend npm run seed   # optional: add fresh test data
```

Or, for local dev: `rm -f apps/backend/data/app.db && npm run seed`.

That is the local case only. Resetting **production** also means taking a backup first and
rotating `ADMIN_TOKEN`/`JWT_SECRET` — which invalidates the cron jobs' authorization
header, the step most often forgotten. The full checklist is in
[the operator handbook](../docs-site/content/semester-reset.md).

---

## Updating the Documentation

- **Operational "how do I" content** → `docs-site/content/*.md`, then
  `cd docs-site && npm run build`. Adding a page also requires an entry in
  `site.config.mjs`; the build fails if content and navigation disagree, so a page cannot
  quietly become unreachable. `npm run build` also verifies every internal link resolves.
- **Design rationale** → `docs/architecture.md`.
- **Algorithm and analysis** → `docs/algorithm.md`, `analysis/README.md`.
- **This file** → how to change the code.
