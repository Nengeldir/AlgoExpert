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
| Design tokens (colors, fonts) | `apps/frontend/src/tokens.css`                    |
| Frontend pages                | `apps/frontend/src/pages/`                        |

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

## How to Integrate YouTube API

The `image_url` field on questions is prepared for thumbnail URLs.

1. **Automated**: Create a backend route `POST /admin/questions/from-youtube` that accepts a video ID, calls the YouTube Data API v3 (`videos.list?part=snippet`), extracts the thumbnail URL and title, and creates the question pre-populated.

2. **Manual**: When creating a question via `POST /admin/questions`, pass `image_url` as `https://img.youtube.com/vi/<VIDEO_ID>/hqdefault.jpg`.

3. **Future**: For video embedding on the voting page, add `video_id` as a separate column and render an `<iframe>` in `QuestionCard` when it is set.

---

## How to Add Cron Jobs (Time Triggers)

The app currently relies on explicit admin resolution. To automate:

1. Add `node-cron` to the backend: `npm install node-cron @types/node-cron --workspace=apps/backend`

2. In `apps/backend/src/index.ts`, after `app.listen(...)`:

```typescript
import cron from 'node-cron'

// Every minute: auto-close questions past their deadline
cron.schedule('* * * * *', () => {
  // Optionally send push notifications when a question opens
})

// Daily at 9:00 CEST: notify users to vote
cron.schedule('0 7 * * *', () => {
  // sendPushToAllSubscribers(...)
})
```

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

Or, for local dev: `rm -f data/app.db && npm run seed`.
