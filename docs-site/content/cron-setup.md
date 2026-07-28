# Cron setup

Question creation and resolution are driven by **external HTTP cron jobs**, not by timers
inside the app. This is a once-per-deployment setup task.

## Why external cron

The backend runs no `setInterval` and no in-process scheduler. Everything time-driven is
an idempotent HTTP endpoint that something else calls.

That choice buys two things: the container can sleep between requests without stopping
the schedule, and every scheduled action becomes a URL you can hit yourself when
debugging. The cost is one more service to configure — this page.

[cron-job.org](https://cron-job.org) is free and sufficient. Any scheduler that can send
an authenticated POST works equally well.

## The three jobs

All three use **method `POST`** and the header:

```text
Authorization: Bearer <your ADMIN_TOKEN>
```

Use the production `ADMIN_TOKEN` from your Railway environment variables, not the dev
default.

| Job | URL path | Schedule (UTC) | Meaning |
|---|---|---|---|
| SMI — create | `/admin/smi/daily` | `0 7 * * 1-5` | 08:00 CET, weekdays |
| SMI — resolve | `/admin/smi/resolve` | `30 16 * * 1-5` | 17:30 UTC = 18:30 CET, weekdays |
| YouTube — tick | `/admin/youtube/resolve` | `*/5 * * * *` | Every 5 minutes, all week |

Prefix each path with your backend's public URL, e.g.
`https://your-backend.up.railway.app/admin/smi/daily`.

> **Note:** The YouTube job drives **both** ends of the race — it snapshots baselines at
> 12:00 and resolves at 24:00. It is not "the resolve job" despite the URL. Running it
> every five minutes keeps the real measured window close to the nominal twelve hours.

YouTube question *creation* stays manual on purpose; see
[Admin console → The YouTube panel](admin-console.html#the-youtube-panel).

## The daylight saving trap

Switzerland uses **CET (UTC+1)** in winter and **CEST (UTC+2)** from late March to late
October. Cron schedules are in UTC and do not follow that. The app's internal anchors
*do* — `schedule.ts` probes the Zurich offset for the specific date — so only the
external cron times drift.

The SMI jobs are the ones affected:

| | Winter (CET) | Summer (CEST) |
|---|---|---|
| SMI — create | `0 7 * * 1-5` | `0 6 * * 1-5` |
| SMI — resolve | `30 16 * * 1-5` | `30 15 * * 1-5` |

The YouTube tick runs every five minutes, so it is timezone-agnostic.

**The simplest fix is to run both variants year-round.** Create four SMI jobs instead of
two — the winter pair and the summer pair — and leave them all enabled. Every endpoint is
idempotent, so the call that fires at the "wrong" hour does nothing:

- `/admin/smi/daily` refuses to create a second question for the same day, and refuses
  entirely once voting has closed.
- `/admin/smi/resolve` only touches questions that are still unresolved, and waits until
  after 18:00 Zurich before attempting today's.

Duplicate calls are harmless. Twice-yearly manual edits are not, because they get
forgotten.

## Verifying the jobs work

Do this immediately after setup rather than discovering a problem a week in.

**1. Call each endpoint by hand.** All three return `200` with a `log` array describing
what they did:

```bash
curl -X POST https://your-backend.up.railway.app/admin/smi/daily \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

```json
{ "ok": true, "log": ["[smi] created question 42 for 2026-07-28 (prev close 12043.51 on 2026-07-27)"] }
```

An empty `log` usually means "nothing to do", which is a valid outcome — the question
already existed, or it is the weekend.

**2. Check cron-job.org's execution history** the next morning. It records the status
code of every run. A run of `403` means the token is wrong; `404` means the URL is wrong.

**3. Check the dashboard** at `/admin/questions` — today's SMI question should be there.

## What each endpoint does

### `POST /admin/smi/daily`

Skips weekends. Skips if a question already exists for today. Skips if today's 12:00
voting deadline has already passed. Otherwise fetches recent SMI closes, takes the most
recent one *before* today as the reference, and creates the question published at 08:00
with a 12:00 deadline.

### `POST /admin/smi/resolve`

Finds unresolved SMI questions. For today's question it waits until after 18:00 Zurich.
Compares the day's close to the stored previous close: strictly higher resolves A,
otherwise B. If a **past** question still has no close data it assumes a public holiday
and deletes the question and its votes.

### `POST /admin/youtube/resolve`

Two idempotent halves. First, any question whose `race_starts_at` has passed and has no
baseline yet gets its two view counts snapshotted. Second, any question whose
`race_ends_at` has passed and *has* a baseline gets closed: fetch current views, compare
the deltas, resolve to the larger. Exact ties are skipped and retried next tick.

Both halves need `YOUTUBE_API_KEY`; without it the endpoint returns `503`.

## Cost note

The Railway backend config currently carries a comment telling you not to enable
scale-to-zero because of in-process timers. Those timers no longer exist — everything
moved to the cron endpoints described here. Scale-to-zero is compatible with this design;
the first cron call of the morning simply wakes the container.

If you enable it, allow for a cold start: the SMI job may take a few extra seconds, which
is harmless given the hour of slack before the 08:00 publish.

## Next

→ [Deployment](deployment.html): the services these jobs point at.
