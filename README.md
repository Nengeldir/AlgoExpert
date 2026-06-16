# Expert Algorithm — Voting Web App

A mobile-first web application for the Expert Algorithm (Weighted Majority) course at ETH Zurich.
Students vote daily on binary prediction questions; the data is analyzed live in the plenary session.

---

## Quick Start

```bash
# 1. Copy environment variables
cp .env.example .env
# Edit .env: set JWT_SECRET and ADMIN_TOKEN to strong random values

# 2. Start with Docker (hot-reload for both services)
make dev
# or: docker compose up --build

# 3. Seed test data (run once, in a second terminal)
make seed
# or: docker compose exec backend npm run seed

# 4. Open http://localhost:5173
```

After `make dev` + `make seed`:
- Register with a pseudonym, vote on a seeded question, view it in History.
- Admin operations work via `curl` (see below).

---

## Local Development (without Docker)

Requires **Node.js 20+**.

```bash
npm install
cp .env.example .env
npm run dev     # starts both backend :3000 and frontend :5173
npm run seed    # populate test data
```

---

## Admin Operations

All admin endpoints require the bearer token from `ADMIN_TOKEN` in your `.env`.

### Create a question

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

### Resolve a question (set ground truth)

Replace `1` with the question id returned above.

```bash
curl -X POST http://localhost:3000/admin/questions/1/resolve \
  -H "Authorization: Bearer dev-admin-token" \
  -H "Content-Type: application/json" \
  -d '{"ground_truth": "B"}'
```

### Export all votes (JSON)

```bash
curl -H "Authorization: Bearer dev-admin-token" \
  http://localhost:3000/admin/export
```

### Export as CSV (for spreadsheet / lecture)

```bash
curl -H "Authorization: Bearer dev-admin-token" \
  "http://localhost:3000/admin/export?format=csv" -o votes.csv
```

### List all questions

```bash
curl -H "Authorization: Bearer dev-admin-token" \
  http://localhost:3000/admin/questions
```

---

## Running Tests

```bash
make test
# or individually:
npm run test --workspace=apps/backend
npm run test --workspace=apps/frontend
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
├── Makefile
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

## Further Reading

- [Architecture decisions](docs/architecture.md)
- [Expert Algorithm explanation](docs/algorithm.md)
- [Extending the app (TA guide)](docs/extending.md)
