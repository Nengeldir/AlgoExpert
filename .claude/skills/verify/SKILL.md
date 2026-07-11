---
name: verify
description: How to launch and drive this app to verify changes end-to-end
---

# Verifying changes in this repo

## Launch

```bash
# Use a throwaway DB so test users don't pollute dev data:
DATABASE_PATH="<scratchpad>/verify-db/app.db" npm run dev   # backend :3000 + vite :5173
curl -s http://localhost:3000/health                        # {"status":"ok"}
```

**Gotcha:** a `tsx watch` backend is often already running on :3000 (check
`Get-NetTCPConnection -LocalPort 3000`). If so, your `npm run dev` backend dies with
EADDRINUSE while vite still starts — you'll silently be testing against the existing
backend and its DB at `apps/backend/data/app.db` (tsx watch hot-reloads your code
changes, so new routes DO go live on it). Either kill it first or clean up test rows
from that DB afterwards.

## Drive (UI)

No browser automation in the repo. Install Playwright in the session scratchpad
(`npm i playwright && npx playwright install chromium`), then drive
`http://localhost:5173`:

- Register: `/register` → fill pseudonym/email/password, check consent, submit → lands on `/today`.
- Auth pages use proper labels; `getByLabel(/pseudonym/i)` etc. works. Nav links via `getByRole('link', { name: ... })` (desktop sidebar ≥768px, bottom tabs below).
- JWT lives in `localStorage.token`; admin token in `localStorage['admin-token']` (admin login at `/admin/login`, dev token `dev-admin-token`).

## Drive (API)

`curl http://localhost:3000/api/...` with `Authorization: Bearer <token>` from
`POST /api/auth/login {identifier, password}`. Password-reset emails fall back to a
`[email] password reset for ...` console log when `RESEND_API_KEY` is unset.
