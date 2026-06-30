# Expert Algorithm — Voting Web App

A mobile-first web application for the Expert Algorithm (Weighted Majority) course at ETH Zurich.
Students vote daily on binary prediction questions; the data is analyzed live in the plenary session.

---

## Quick Start

> **Prerequisites:** [Docker Desktop](https://www.docker.com/products/docker-desktop/) must be running.

**Windows (PowerShell)**
```powershell
Copy-Item .env.example .env
docker compose up --build
# second terminal:
docker compose exec backend npm run seed
```

**macOS / Linux**
```bash
cp .env.example .env
docker compose up --build
# second terminal:
docker compose exec backend npm run seed
```

Then open **http://localhost:5173** — register a pseudonym, vote on a seeded question, view it in History.

To stop: press `Ctrl+C`, then `docker compose down`.

---

## Local Development (without Docker)

Requires **Node.js 20+** (`node --version` to check).

**Windows (PowerShell)**
```powershell
npm install
Copy-Item .env.example .env
npm run dev       # backend :3000 + frontend :5173
# second terminal:
npm run seed
```

**macOS / Linux**
```bash
npm install
cp .env.example .env
npm run dev       # backend :3000 + frontend :5173
# second terminal:
npm run seed
```

To run each service in its own terminal instead:

```powershell
# Terminal 1
npm run dev --workspace=apps/backend
# Terminal 2
npm run dev --workspace=apps/frontend
```

---

## Admin Operations

All admin endpoints require the `ADMIN_TOKEN` from your `.env` (default dev value: `dev-admin-token`).

### Create a question

**Windows (PowerShell — `Invoke-RestMethod`)**
```powershell
$h = @{ Authorization = "Bearer dev-admin-token"; "Content-Type" = "application/json" }
$b = @{
    title       = "Will it snow in Zurich?"
    description = "Forecast for next Monday."
    option_a    = "Yes"
    option_b    = "No"
    deadline    = "2026-06-20T23:59:00.000Z"
} | ConvertTo-Json
Invoke-RestMethod -Method POST -Uri http://localhost:3000/admin/questions -Headers $h -Body $b
```

**macOS / Linux (curl)**
```bash
curl -X POST http://localhost:3000/admin/questions \
  -H "Authorization: Bearer dev-admin-token" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Will it snow in Zurich?",
    "description": "Forecast for next Monday.",
    "option_a": "Yes",
    "option_b": "No",
    "deadline": "2026-06-20T23:59:00.000Z"
  }'
```

---

### Resolve a question (set ground truth)

Replace `1` with the question `id` from the create response.

**Windows (PowerShell)**
```powershell
$h = @{ Authorization = "Bearer dev-admin-token"; "Content-Type" = "application/json" }
Invoke-RestMethod -Method POST -Uri http://localhost:3000/admin/questions/1/resolve `
  -Headers $h -Body (@{ ground_truth = "B" } | ConvertTo-Json)
```

**macOS / Linux**
```bash
curl -X POST http://localhost:3000/admin/questions/1/resolve \
  -H "Authorization: Bearer dev-admin-token" \
  -H "Content-Type: application/json" \
  -d '{"ground_truth": "B"}'
```

---

### Export all votes

**Windows (PowerShell)**
```powershell
$h = @{ Authorization = "Bearer dev-admin-token" }

# JSON
Invoke-RestMethod -Uri http://localhost:3000/admin/export -Headers $h

# CSV — saved to file
Invoke-RestMethod -Uri "http://localhost:3000/admin/export?format=csv" -Headers $h -OutFile votes.csv
```

**macOS / Linux**
```bash
# JSON
curl -H "Authorization: Bearer dev-admin-token" http://localhost:3000/admin/export

# CSV
curl -H "Authorization: Bearer dev-admin-token" \
  "http://localhost:3000/admin/export?format=csv" -o votes.csv
```

---

### List all questions

**Windows (PowerShell)**
```powershell
Invoke-RestMethod -Uri http://localhost:3000/admin/questions `
  -Headers @{ Authorization = "Bearer dev-admin-token" }
```

**macOS / Linux**
```bash
curl -H "Authorization: Bearer dev-admin-token" http://localhost:3000/admin/questions
```

---

## Automated Question Lifecycle (Production)

In production on Railway, there are no in-process timers — the container can sleep between requests. Instead, three HTTP cron jobs on [cron-job.org](https://cron-job.org) (free) drive question creation and resolution.

### How to set up on cron-job.org

1. Sign up at [cron-job.org](https://cron-job.org)
2. Create each job below with:
   - **Request method:** `POST`
   - **Header key:** `Authorization`
   - **Header value:** `Bearer <your ADMIN_TOKEN from Railway>`

### Jobs

| Job | Endpoint | Cron schedule | When |
|-----|----------|---------------|------|
| SMI — create question | `POST /admin/smi/daily` | `0 7 * * 1-5` | 08:00 CET Mon–Fri |
| SMI — resolve question | `POST /admin/smi/resolve` | `30 16 * * 1-5` | 17:30 UTC = 18:30 CET Mon–Fri |
| YouTube — resolve | `POST /admin/youtube/resolve` | `0 * * * *` | Every hour |

**SMI timezone:** Switzerland uses CET (UTC+1) in winter and CEST (UTC+2) in summer (late March – late October). During summer, change the SMI schedules to `0 6 * * 1-5` and `30 15 * * 1-5`. Alternatively, keep both variants active year-round — all endpoints are idempotent so a duplicate call does nothing.

### What each job does

- **`/admin/smi/daily`** — fetches the previous SMI close from Stooq and creates today's question. Skips weekends and days where a question already exists.
- **`/admin/smi/resolve`** — fetches today's closing price and resolves the question as A (higher) or B (flat/lower). Skips if market data is not yet available. Automatically removes questions on public holidays when no data arrives.
- **`/admin/youtube/resolve`** — finds YouTube questions whose 24-hour deadline has passed, fetches current view counts, and resolves whichever video gained more views. Ties are left pending until the next hourly run.

### YouTube question creation (manual)

YouTube questions require admin approval before publishing:

1. Go to `/admin/login` and sign in with your `ADMIN_TOKEN`
2. Navigate to **Admin → Suggest** to fetch a video pair from YouTube
3. Review the pair and click **Approve** to publish it with a 24-hour deadline
4. The hourly cron job will resolve it automatically once the deadline passes

---

## Running Tests

```powershell
# All tests (backend + frontend)
npm run test

# Backend only
npm run test --workspace=apps/backend

# Frontend only
npm run test --workspace=apps/frontend
```

*(Same command on all platforms.)*

---

## Resetting the Database

**Windows (PowerShell)**
```powershell
# Docker
docker compose down -v
docker compose up --build -d
docker compose exec backend npm run seed

# Local dev
Remove-Item -Path apps\backend\data\app.db -ErrorAction SilentlyContinue
npm run seed
```

**macOS / Linux**
```bash
# Docker
docker compose down -v
docker compose up --build -d
docker compose exec backend npm run seed

# Local dev
rm -f apps/backend/data/app.db
npm run seed
```

---

## Project Structure

```
webapp/
├── apps/
│   ├── backend/          Fastify API (Node.js, TypeScript)
│   │   └── src/
│   │       ├── db/       SQLite schema + seed
│   │       ├── plugins/  JWT auth decorator
│   │       ├── routes/   auth, questions, votes, history, admin
│   │       └── types.ts  Shared TypeScript interfaces
│   └── frontend/         React + Vite SPA
│       └── src/
│           ├── api/      Typed fetch client
│           ├── pages/    Register, Login, Today, History
│           └── *.css     Token-based design system
├── docs/
│   ├── architecture.md
│   ├── algorithm.md
│   └── extending.md
├── docker-compose.yml
├── Dockerfile.backend
├── Dockerfile.frontend
└── .env.example
```

---

## Environment Variables

| Variable        | Description                           | Default (dev)             |
|-----------------|---------------------------------------|---------------------------|
| `DATABASE_PATH` | SQLite file path (inside container)   | `./data/app.db`           |
| `JWT_SECRET`    | Secret for signing JWTs               | `change-me-in-production` |
| `ADMIN_TOKEN`   | Bearer token for admin endpoints      | `dev-admin-token`         |
| `PORT`          | Backend listen port                   | `3000`                    |
| `CORS_ORIGIN`   | Allowed CORS origin                   | `http://localhost:5173`   |
| `VITE_API_URL`  | API base URL (frontend, build-time)   | `` (uses Vite proxy)      |

---

## Troubleshooting

**Windows: `curl` behaves differently in PowerShell**
PowerShell aliases `curl` to `Invoke-WebRequest` (different flags). Use `Invoke-RestMethod` as shown above, or use Git Bash where standard `curl` works.

**Docker healthcheck keeps failing**
Run `docker compose logs backend` — if the backend started successfully the issue is likely a stale cached image. Run `docker compose up --build` to force a rebuild.

**Port already in use**
Stop the conflicting process or change the ports in `docker-compose.yml` and `.env`.

**`npm run dev` fails locally**
Make sure `npm install` has been run and Node.js 20+ is active (`node --version`).

---

## Further Reading

- [Architecture decisions](docs/architecture.md)
- [Expert Algorithm explanation](docs/algorithm.md)
- [Extending the app (TA guide)](docs/extending.md)
