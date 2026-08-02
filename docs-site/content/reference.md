# Reference

Lookup tables. Everything here was read off the code rather than remembered — but code
moves, so treat a surprise as a reason to check the source, not as a fact.

## Environment variables

| Variable | Read by | Default | Notes |
|---|---|---|---|
| `DATABASE_PATH` | backend | `./data/app.db` | Must point at the mounted volume in production |
| `JWT_SECRET` | backend | `change-me-in-production` | Changing it logs every student out |
| `ADMIN_TOKEN` | backend | *(empty)* | The admin password. Compared as a plain bearer token |
| `PORT` | backend | `3000` | Injected by Railway; do not set there |
| `CORS_ORIGIN` | backend | `http://localhost:5173` | Also the base URL for password-reset links and new-question emails |
| `LOG_LEVEL` | backend | `info` | Fastify log level |
| `YOUTUBE_API_KEY` | backend | *(none)* | YouTube endpoints return `503` without it |
| `RESEND_API_KEY` | backend | *(none)* | Without it, reset links and new-question emails are logged instead of sent |
| `EMAIL_FROM` | backend | — | Sender for all outgoing email |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | backend | *(none)* | Without both, `/api/push/vapid-public-key` returns `503` and push sends are skipped/logged. Generate with `npx web-push generate-vapid-keys` |
| `VAPID_SUBJECT` | backend | `mailto:admin@example.com` | Contact address sent to push services with each notification |
| `VITE_API_URL` | frontend | *(empty)* | **Build-time only.** Empty uses the dev proxy |

> **Note:** `.env.example` also contains `FINANCIAL_MODELLING_PREP_API_KEY`. No code
> reads it — it is a leftover from an SMI data provider that did not work out. Safe to
> delete.

## Public endpoints

No authentication.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Returns `{"status":"ok"}`. Used by Docker and Railway health checks |
| `POST` | `/api/auth/register` | `{pseudonym, email, password, consent}` → JWT (30-day expiry). Pseudonym is 3–30 chars, letters/digits/hyphen/underscore; password min 6; `consent` must be `true` |
| `POST` | `/api/auth/login` | `{identifier, password}` → JWT. `identifier` matches pseudonym **or** email |
| `POST` | `/api/auth/forgot-password` | `{email}` → always a generic `200`, to prevent user enumeration |
| `POST` | `/api/auth/reset-password` | `{token, password}`. Tokens are single-use and expire after 1 hour |

## Student endpoints

Require `Authorization: Bearer <jwt>`.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/me` | Own profile and settings |
| `PATCH` | `/api/me/settings` | Update `email_notifications` |
| `GET` | `/api/questions` | Open questions (`deadline > now` and `published_at <= now`), with the caller's own vote |
| `POST` | `/api/votes` | `{question_id, choice}` where choice is `"A"` or `"B"` |
| `GET` | `/api/history` | Past questions with the caller's own vote and result |

Vote submission fails with:

| Status | Reason |
|---|---|
| `404` | Question does not exist |
| `409` | Deadline passed, question already resolved, or already voted |

Every one of these endpoints joins votes **for the authenticated user only**. No student
can see another student's vote through the API.

## Admin endpoints

Require `Authorization: Bearer <ADMIN_TOKEN>`. A wrong or missing token gives `403`.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/admin/questions` | All questions with vote counts |
| `POST` | `/admin/questions` | Create a question manually |
| `POST` | `/admin/questions/:id/resolve` | `{ground_truth}` — sets truth and scores all votes. `409` if already resolved |
| `DELETE` | `/admin/questions/:id` | Deletes the question, its votes, and any YouTube suggestion row |
| `GET` | `/admin/questions/:id/votes` | Per-question vote list with pseudonyms |
| `GET` | `/admin/export` | All votes. `?format=csv` for CSV, otherwise JSON |
| `GET` | `/admin/youtube/suggest` | Today's video pair. `?refresh=true` discards the cached one |
| `POST` | `/admin/youtube/approve` | Publishes today's pending suggestion on the daily anchors |
| `POST` | `/admin/youtube/resolve` | The race tick: snapshot baselines, close finished races |
| `POST` | `/admin/smi/daily` | Create today's SMI question |
| `POST` | `/admin/smi/resolve` | Resolve expired SMI questions |
| `POST` | `/admin/notifications/dispatch` | Email opted-in participants about newly published questions |

`POST /admin/questions` body:

```json
{
  "title": "string, 1-200 chars",
  "description": "string, required",
  "option_a": "string, required",
  "option_b": "string, required",
  "image_url": "string, optional",
  "deadline": "ISO-8601 date-time, required"
}
```

## Database tables

SQLite in WAL mode, foreign keys on.

**`users`** — `id`, `pseudonym` (unique), `email` (unique), `password_hash` (bcrypt),
`email_notifications`, `created_at`.

**`password_resets`** — `id`, `user_id`, `token_hash` (SHA-256 of the emailed token),
`expires_at`, `used_at`, `created_at`.

**`questions`** — `id`, `title`, `description`, `option_a`, `option_b`, `image_url`,
`deadline`, `resolved_at`, `ground_truth` (`'A'`/`'B'`/null), `created_at`, plus
`option_a_image`, `option_b_image`, `option_a_views`, `option_b_views`, `published_at`,
`race_starts_at`, `race_ends_at`, `notified_at`.

**`votes`** — `id`, `user_id`, `question_id`, `choice` (`'A'`/`'B'`), `is_correct`
(null until resolved, then 0/1), `voted_at`. Unique on `(user_id, question_id)`, which is
what makes voting one-shot.

**`smi_questions`** — `id`, `question_date` (unique), `question_id`, `prev_close`,
`prev_date`, `created_at`.

**`youtube_suggestions`** — `id`, `suggested_date` (unique), per-video `*_id`, `*_title`,
`*_channel`, `*_thumbnail`, `*_subscribers`, `*_published_at`, `*_views`, then `approved`,
`question_id`, and the race snapshots `race_start_views_a/b`, `race_start_at`,
`race_end_views_a/b`, `race_end_at`.

Schema changes are additive `ALTER TABLE` statements in
`apps/backend/src/db/migrate.ts`, wrapped in try/catch and re-run on every start. There
is no migration versioning — adding a column means appending to that list.

## Export CSV columns

```text
question_id, deadline, pseudonym, question_title, option_a, option_b,
ground_truth, user_vote, is_correct, voted_at
```

Ordered by `deadline`, then `question_id`, then `pseudonym`. Unresolved questions appear
with empty `ground_truth` and `is_correct`.

## Frontend routes

| Path | Page |
|---|---|
| `/register`, `/login` | Account creation and sign-in |
| `/forgot-password`, `/reset-password` | Password recovery |
| `/today` | Voting |
| `/history` | Own past votes and results |
| `/settings` | Email notification preference, theme |
| `/admin/login` | Admin token entry |
| `/admin/questions` | Admin dashboard (`/admin` redirects here) |

## Commands

```bash
# Development
docker compose up --build                    # both services, hot reload
docker compose exec backend npm run seed     # test data
docker compose down -v                       # stop and wipe the database

npm run dev                                  # local, without Docker
npm run seed

# Quality
npm run test                                 # all workspaces
npm run test --workspace=apps/backend
npx vitest run apps/backend/src/test/auth.test.ts    # single file
npm run lint
npm run format

# Docs site
cd docs-site && npm install && npm run build
npm run serve                                # preview on :4180
npm run dev                                  # rebuild on save

# Analysis
cd analysis && pip install -r requirements.txt
python test_expert_algorithm.py
python run.py votes.csv --sweep
```

## Source map

Where to look when the answer is not in this handbook.

| Question | File |
|---|---|
| What are the daily anchors? | `apps/backend/src/services/schedule.ts` |
| How does the SMI job work? | `apps/backend/src/services/smiService.ts` |
| How does the YouTube race work? | `apps/backend/src/services/youtubeResolver.ts` |
| Who gets a new-question email, and when? | `apps/backend/src/services/notifications.ts` |
| What is the database schema? | `apps/backend/src/db/migrate.ts` |
| How does admin auth work? | `apps/backend/src/plugins/authenticate.ts` |
| What does the admin UI do? | `apps/frontend/src/pages/AdminQuestions.tsx` |
| Colours, spacing, fonts | `apps/frontend/src/tokens.css` |
| The Expert Algorithm itself | `analysis/expert_algorithm.py`, `docs/algorithm.md` |
| Architecture rationale | `docs/architecture.md` |
| Extending the app | `docs/extending.md` |
