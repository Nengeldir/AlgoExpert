# Architecture Decisions

## Overview

```
┌─────────────────────────────────────┐
│  Browser (React SPA)                │
│  /register  /today  /history        │
│                                     │
│  localStorage: JWT token            │
└─────────────┬───────────────────────┘
              │ HTTP/JSON (fetch)
              │ Vite dev proxy → :3000
              ▼
┌─────────────────────────────────────┐
│  Fastify API  :3000                 │
│                                     │
│  /api/auth/register                 │
│  /api/auth/login                    │
│  /api/questions  (JWT required)     │
│  /api/votes      (JWT required)     │
│  /api/history    (JWT required)     │
│  /admin/*        (Bearer token)     │
│  /health                            │
└─────────────┬───────────────────────┘
              │ better-sqlite3
              ▼
┌─────────────────────────────────────┐
│  SQLite (WAL mode)                  │
│  ./data/app.db                      │
│                                     │
│  tables: users, questions, votes    │
└─────────────────────────────────────┘
```

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

## Auth design

- **JWT, 30-day expiry, stored in localStorage**: Simple for a course context. Not hardened against XSS (no httpOnly cookie), but the attack surface is low for an intranet-facing app. A TA can rotate `JWT_SECRET` to invalidate all sessions if needed.
- **bcrypt (10 rounds)**: Industry-standard password hashing. Argon2 would be marginally stronger but adds a native binary dependency that complicates Docker builds.
- **Admin bearer token**: Single static secret from env var. No need for admin user management for a TA workflow.

## Database schema

```sql
users       (id, pseudonym UNIQUE, password_hash, created_at)
questions   (id, title, description, option_a, option_b, image_url,
             deadline, resolved_at, ground_truth, created_at)
votes       (id, user_id FK, question_id FK, choice, is_correct, voted_at)
            UNIQUE(user_id, question_id)
```

`is_correct` is `NULL` until the question is resolved, then `0` or `1`. This lets the frontend distinguish "unresolved" from "wrong" without a separate status field.

`image_url` is a nullable text field — prepared for future YouTube thumbnail URLs without requiring a schema migration.

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
