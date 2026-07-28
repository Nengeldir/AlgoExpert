# Deployment

Production runs on [Railway](https://railway.app) as separate services built from
Dockerfiles in this repository. Railway terminates HTTPS, so none of the containers deal
with certificates.

## The services

| Service | Dockerfile | Config | What it is |
|---|---|---|---|
| Backend | `Dockerfile.backend.railway` | `deploy/railway.backend.toml` | Fastify API + SQLite on a volume |
| Frontend | `Dockerfile.frontend.railway` | `deploy/railway.frontend.toml` | Built React SPA served by Caddy |
| Docs | `Dockerfile.docs.railway` | `deploy/railway.docs.toml` | This handbook, served by Caddy |

Each is created in the Railway dashboard from the same repository, with its
**Config-as-code path** pointed at the matching `.toml`.

## Backend service

### Volume

The SQLite database lives on a Railway volume mounted at **`/data`**, with
`DATABASE_PATH=/data/app.db`. Without the volume the database is wiped on every deploy —
this is the single most important thing to get right.

Railway mounts the volume root-owned. `deploy/backend-entrypoint.sh` runs as root,
takes ownership of `/data`, then drops to the unprivileged `node` user via `gosu` before
starting the app.

### Environment variables

Set these in the Railway service's **Variables** tab:

| Variable | Value |
|---|---|
| `DATABASE_PATH` | `/data/app.db` |
| `JWT_SECRET` | A long random string. Changing it logs every student out |
| `ADMIN_TOKEN` | A long random string. This is the admin password |
| `CORS_ORIGIN` | The frontend's public URL, e.g. `https://your-frontend.up.railway.app` |
| `YOUTUBE_API_KEY` | From Google Cloud Console |
| `RESEND_API_KEY` | From resend.com — required for password-reset emails |
| `EMAIL_FROM` | e.g. `Expert Vote <noreply@yourdomain>` |

`PORT` is injected by Railway; do not set it. `LOG_LEVEL` defaults to `info`.

> **Warning:** `CORS_ORIGIN` does double duty — it is also the base URL used to build
> password-reset links. If it is wrong, reset emails point students at the wrong host and
> the links are dead.

### Health check and tests

The service exposes `/health` returning `{"status":"ok"}`; Railway gates traffic on it.

The backend Docker build **runs the test suite** before compiling. A failing test aborts
the build and Railway marks the deploy failed. This is intentional: it is the only
automated gate between a bad commit and production.

## Frontend service

The frontend is a static build. The one thing to know:

> **Danger:** `VITE_API_URL` is baked in at **build time**. Vite inlines environment
> variables during the build, so setting it after deploying does nothing — you must set
> it as a service variable *before* the build and redeploy to change it.

Set it to the backend's public URL. Caddy serves the built files with SPA fallback so
deep links and refreshes work, and sends `Cache-Control: no-cache` for `index.html`,
`sw.js` and `manifest.json` so students always get the current version.

## First deploy, in order

The two services reference each other's URLs, so ordering matters.

1. **Create the backend service.** Point Config-as-code at `deploy/railway.backend.toml`.
   Attach a volume mounted at `/data`. Set every variable except `CORS_ORIGIN`. Deploy.
2. **Note the backend's public URL.**
3. **Create the frontend service.** Point it at `deploy/railway.frontend.toml`. Set
   `VITE_API_URL` to the backend URL. Deploy.
4. **Note the frontend's public URL.**
5. **Set `CORS_ORIGIN` on the backend** to the frontend URL. Redeploy the backend.
6. **Set up the cron jobs** — see [Cron setup](cron-setup.html).
7. **Verify:** register a test account, vote, resolve from the admin console.

## The docs site itself

This handbook is a third static service, built by a small Node script — no framework, no
Vue, no React.

```bash
cd docs-site
npm install
npm run build        # markdown in content/ -> dist/
npm run serve        # preview at http://localhost:4180
npm run dev          # rebuild on save
```

Deploying it on Railway follows the frontend pattern:

1. Create a service from this repository.
2. Set its Config-as-code path to `deploy/railway.docs.toml`.
3. Deploy. There are no environment variables and no volume.

To change the docs: edit the markdown in `docs-site/content/`, commit, and Railway
rebuilds. Adding a **new page** also requires an entry in `docs-site/site.config.mjs` —
the build deliberately fails if a page exists but is not listed in the navigation, or
vice versa, so pages cannot go quietly unreachable.

> **Note:** `docs-site/` is intentionally **not** an npm workspace of the root package.
> It keeps its own `node_modules` and lockfile so the backend and frontend Docker builds,
> which copy the root lockfile, are unaffected by anything the docs depend on.

## Local Docker

`docker-compose.yml` builds the non-Railway Dockerfiles (`Dockerfile.backend`,
`Dockerfile.frontend`) and is for development only. It mounts source read-only for hot
reload and stores the database in a named `db-data` volume.

```bash
docker compose up --build
docker compose down        # add -v to wipe the database volume
```

## Backups

There is no automatic backup. The database is a single SQLite file on the Railway volume.

Before anything risky — a schema change, a bulk delete, end of semester — take a copy.
See [Semester reset → Backing up first](semester-reset.html#backing-up-first).

## Next

→ [Troubleshooting](troubleshooting.html): when something is not working.
