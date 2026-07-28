# Getting started

Goal: a working copy of the app on your own machine in about ten minutes, so you can
click through the admin console without touching production.

## What you need

- **Docker Desktop** running — this is the easy path, and
- **Git**, to clone the repository.

Node.js is only needed if you want to run without Docker (see [below](#without-docker)).

## Clone and start

```bash
git clone <repository-url> webapp
cd webapp
cp .env.example .env          # PowerShell: Copy-Item .env.example .env
docker compose up --build
```

The first build takes a few minutes because it compiles `better-sqlite3` from source.
Later starts are seconds.

In a **second terminal**, load some test data:

```bash
docker compose exec backend npm run seed
```

Open **http://localhost:5173**, register a pseudonym, and vote. That is the student view.

To stop: `Ctrl+C`, then `docker compose down`. Add `-v` to also wipe the database.

## Log in to the admin console

Go to **http://localhost:5173/admin/login** and paste the admin token. Locally that is
whatever `ADMIN_TOKEN` is set to in your `.env` — the example file ships
`change-me-admin-token`.

> **Warning:** The admin token is a single static secret with no username and no
> expiry. Anyone holding it can read every vote and delete every question. Never paste
> the production token into a chat, an issue, or a shared document.

You should now see the **Admin Dashboard** with a list of questions.
[Admin console](admin-console.html) walks through what each control does.

## Local API keys

Two features call third-party APIs. Both degrade gracefully when unconfigured, so you
can skip them locally:

| Key | Needed for | If missing |
|---|---|---|
| `YOUTUBE_API_KEY` | Generating and resolving YouTube race questions | Those endpoints return `503`; everything else works |
| `RESEND_API_KEY` | Sending password-reset emails | Reset links are printed to the backend console instead — fine for local testing |

The SMI question source needs **no key** — it reads public endpoints.

> **Note:** `.env.example` also lists `FINANCIAL_MODELLING_PREP_API_KEY`. Nothing in the
> app reads it. It is a leftover from an abandoned data provider and can be ignored or
> deleted. See [Reference → Environment variables](reference.html#environment-variables).

## Create a question by hand

Useful for checking the whole loop end-to-end without waiting for a cron job.

```bash
curl -X POST http://localhost:3000/admin/questions \
  -H "Authorization: Bearer change-me-admin-token" \
  -H "Content-Type: application/json" \
  -d '{"title":"Test","description":"A test question.","option_a":"Yes","option_b":"No","deadline":"2027-12-31T23:59:00.000Z"}'
```

On Windows, PowerShell aliases `curl` to `Invoke-WebRequest`, which takes different
flags. Use `Invoke-RestMethod` instead:

```powershell
$h = @{ Authorization = "Bearer change-me-admin-token"; "Content-Type" = "application/json" }
$b = @{
  title = "Test"; description = "A test question."
  option_a = "Yes"; option_b = "No"
  deadline = "2027-12-31T23:59:00.000Z"
} | ConvertTo-Json
Invoke-RestMethod -Method POST -Uri http://localhost:3000/admin/questions -Headers $h -Body $b
```

Vote on it as a student, then resolve it from the admin console and check that History
shows the result. That is the complete lifecycle.

## Without Docker

Requires **Node.js 20 or newer** (`node --version`).

```bash
npm install
cp .env.example .env
npm run dev          # backend :3000 and frontend :5173 together
npm run seed         # in a second terminal
```

`npm run dev` runs both services with hot reload. To run them separately:

```bash
npm run dev --workspace=apps/backend
npm run dev --workspace=apps/frontend
```

In development the frontend proxies `/api` and `/admin` to `localhost:3000`, so there
are no CORS problems and `VITE_API_URL` can stay empty.

## Running the tests

```bash
npm run test                              # everything
npm run test --workspace=apps/backend     # backend only
```

The backend tests run against an in-memory database, so they never touch your local
data. They also run inside the production Docker build — **a failing test blocks the
deploy**, which is deliberate.

## Next

→ [Daily operations](daily-operations.html): what the app does on its own each day, and
what it needs from you.
