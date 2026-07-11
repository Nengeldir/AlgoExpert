# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development

```bash
# Docker (recommended)
docker compose up --build          # start both services with hot-reload
docker compose exec backend npm run seed   # seed test data (run once)
docker compose down                # stop
docker compose down -v             # stop + wipe SQLite volume

# Local (Node 20+ required)
npm install
npm run dev                        # backend :3000 + frontend :5173 concurrently
npm run seed                       # populate test questions and users
```

### Tests

```bash
npm run test                                   # all workspaces
npm run test --workspace=apps/backend          # backend only
npm run test --workspace=apps/frontend         # frontend only

# Single test file
npx vitest run apps/backend/src/test/auth.test.ts
npx vitest run apps/frontend/src/pages/Register.test.tsx
```

### Lint & Format

```bash
npm run lint        # ESLint across all workspaces
npm run format      # Prettier across all workspaces
```

### Admin operations (dev token: `dev-admin-token`)

```bash
# Create a question
curl -X POST http://localhost:3000/admin/questions \
  -H "Authorization: Bearer dev-admin-token" \
  -H "Content-Type: application/json" \
  -d '{"title":"Q","description":"D","option_a":"Yes","option_b":"No","deadline":"2026-12-31T23:59:00.000Z"}'

# Resolve (set ground truth)
curl -X POST http://localhost:3000/admin/questions/1/resolve \
  -H "Authorization: Bearer dev-admin-token" \
  -H "Content-Type: application/json" \
  -d '{"ground_truth":"B"}'

# Export votes
curl -H "Authorization: Bearer dev-admin-token" http://localhost:3000/admin/export
curl -H "Authorization: Bearer dev-admin-token" "http://localhost:3000/admin/export?format=csv" -o votes.csv
```

### Cron jobs (production — cron-job.org)

All automated question creation and resolution is driven by external HTTP cron jobs rather than in-process timers, so the Railway container can sleep between requests.

All three jobs use:
- **Method:** `POST`
- **Header:** `Authorization: Bearer <ADMIN_TOKEN>` (the value set in Railway's environment variables)

| Job | URL | Cron schedule | Notes |
|-----|-----|---------------|-------|
| SMI — create question | `/admin/smi/daily` | `0 7 * * 1-5` | 08:00 CET (UTC+1). Change to `0 6 * * 1-5` during CEST (UTC+2, late Mar – late Oct) |
| SMI — resolve question | `/admin/smi/resolve` | `30 16 * * 1-5` | 17:30 UTC = 18:30 CET. Change to `30 15 * * 1-5` during CEST |
| YouTube — resolve | `/admin/youtube/resolve` | `0 * * * *` | Every hour; timezone-agnostic |

**SMI timezone note:** Switzerland observes CET (UTC+1) in winter and CEST (UTC+2) in summer. The simplest workaround is to run both UTC offset schedules year-round — all endpoints are idempotent so duplicate calls are harmless.

**YouTube creation** remains manual: visit `/admin/youtube/suggest` to fetch a pair, then `/admin/youtube/approve` to publish it as a question.

## Architecture

### Monorepo layout

```
apps/backend/   Fastify API — Node.js, TypeScript, CommonJS
apps/frontend/  React SPA  — Vite, TypeScript, ESM
docs/           Architecture, algorithm, and TA extension guide
```

npm workspaces link both packages under a single `node_modules` at the root.

### Backend (`apps/backend/src/`)

| Path | Purpose |
|------|---------|
| `index.ts` | App entry: registers plugins, decorators, routes, starts server |
| `types.ts` | Module augmentation for `FastifyInstance` (`db`, `authenticate`) and DB row shapes |
| `db/migrate.ts` | `initDb(path)` — creates SQLite file, sets WAL mode, runs schema DDL |
| `db/seed.ts` | Standalone script; run with `npm run seed` |
| `plugins/authenticate.ts` | `registerAuth(app)` adds `app.authenticate` (JWT preHandler); `requireAdmin` checks `ADMIN_TOKEN` bearer |
| `routes/auth.ts` | `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/forgot-password`, `POST /api/auth/reset-password` |
| `routes/me.ts` | `GET /api/me` — own profile + settings; `PATCH /api/me/settings` — update `email_notifications` |
| `routes/questions.ts` | `GET /api/questions` — enriched with per-user vote status |
| `routes/votes.ts` | `POST /api/votes` |
| `routes/history.ts` | `GET /api/history` — past questions with own vote only |
| `routes/admin.ts` | `POST /admin/questions`, `POST /admin/questions/:id/resolve`, `GET /admin/export`, `GET /admin/questions` |

**Auth flow:** `POST /api/auth/register` (pseudonym + email + password) → bcrypt hash → JWT (30 d). `POST /api/auth/login` takes `{ identifier, password }`, where `identifier` matches either `pseudonym` or `email` (`WHERE pseudonym = ? OR email = ?`). Email is never shown publicly — it exists only for login/recovery, to preserve the pseudonymous identity used in lecture. All `/api/*` routes use `preHandler: [app.authenticate]`. All `/admin/*` routes use `addHook('preHandler', requireAdmin)` which checks the `Authorization: Bearer <ADMIN_TOKEN>` header against the env var.

**Password reset:** `POST /api/auth/forgot-password { email }` always returns a generic 200 (no user enumeration); if the email matches an account it emails a one-time link via `services/email.ts` (Resend API, `RESEND_API_KEY`/`EMAIL_FROM` env vars — falls back to logging the link to the console when `RESEND_API_KEY` is unset, so local dev needs no email account). The link points at `${CORS_ORIGIN}/reset-password?token=...`; `POST /api/auth/reset-password { token, password }` looks up the SHA-256 hash of the token in `password_resets`, rejects if missing/expired/used, otherwise updates `password_hash` and marks the token used. Tokens expire after 1 hour.

**SQLite schema:** `users`, `password_resets`, `questions`, `votes` (plus `smi_questions`/`youtube_suggestions` for automated question sources). `votes.is_correct` is `NULL` until resolved, then `0|1`. The resolve endpoint runs a transaction that sets `ground_truth` on the question and bulk-updates `is_correct` on all votes in one shot.

**Testing:** `src/test/helpers.ts` builds a full app wired to `:memory:` SQLite — no disk I/O, no shared state between suites. Tests run serially (`singleFork: true`) because better-sqlite3 is synchronous and single-writer.

### Frontend (`apps/frontend/src/`)

| Path | Purpose |
|------|---------|
| `api/client.ts` | All `fetch` calls, token storage (`localStorage`), `ApiError` class, shared response types |
| `App.tsx` | Router, `<Header>`, `<RequireAuth>` guard |
| `pages/` | `Register`, `Login`, `ForgotPassword`, `ResetPassword`, `Today` (voting), `History`, `Settings` |
| `tokens.css` | CSS custom properties — **single source of truth** for all colors, spacing, typography |
| `index.css` | Reset + all component styles, imports `tokens.css` |

**No UI framework** — all styling is vanilla CSS using the token variables. Touch targets are `var(--touch-target)` (48 px minimum).

**Routing:** React Router v6. Unauthenticated users are redirected to `/register` by `<RequireAuth>`. The JWT is stored in `localStorage` and attached as a `Bearer` header by `api/client.ts`.

**Vite proxy:** in dev, `/api` and `/admin` requests are proxied to `http://localhost:3000` so there are no CORS issues and `VITE_API_URL` can be left empty.

**PWA:** `public/manifest.json` and `public/sw.js` are scaffolded but the service worker is not registered — push notification logic is deferred to a future iteration.

### Key design decisions

- **Other users' votes are never exposed** — `GET /api/history` and `GET /api/questions` only join votes for the authenticated user. This is intentional to preserve prediction heterogeneity for the Expert Algorithm.
- **`is_correct` is computed server-side** at resolve time, not on the fly — keeps query logic simple and export data self-contained.
- **Admin token is a static env var** — no admin user table. Rotate `ADMIN_TOKEN` to invalidate access.
- **better-sqlite3 is synchronous** — no `await` needed for DB calls inside route handlers. All DB access goes through `app.db` (decorated on `FastifyInstance` in `index.ts`).
