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

## The four jobs

All four use **method `POST`** and the header:

```text
Authorization: Bearer <your ADMIN_TOKEN>
```

Use the production `ADMIN_TOKEN` from your Railway environment variables, not the dev
default.

| Job | URL path | Schedule (UTC) | Meaning |
|---|---|---|---|
| SMI — create | `/admin/smi/daily` | `0 7 * * 1-5` | 08:00 CET, weekdays |
| SMI — resolve | `/admin/smi/resolve` | `30 16 * * 1-5` | 17:30 UTC = 18:30 CET, weekdays |
| YouTube — tick | `/admin/youtube/resolve` | `*/15 * * * *` | Every 15 minutes, all week |
| Notify — new questions | `/admin/notifications/dispatch` | `*/15 * * * *` | Every 15 minutes, all week |

Prefix each path with your backend's public URL, e.g.
`https://your-backend.up.railway.app/admin/smi/daily`.

> **Note:** The YouTube job drives **both** ends of the race — it snapshots baselines at
> 12:00 and resolves at 24:00. It is not "the resolve job" despite the URL. Running it
> every five minutes keeps the real measured window close to the nominal twelve hours.

> **Note:** The notification job is what emails participants that a question is open.
> Without it, questions still publish on time but nobody is told. It is a separate job
> because it has to fire *after* the 08:00 publish, not when the question was created.

YouTube question *creation* stays manual on purpose; see
[Admin console → The YouTube panel](admin-console.html#the-youtube-panel).

## Creating the jobs, step by step

cron-job.org accounts are free and personal — the jobs hold nothing but a URL and a token,
so a successor can recreate them in ten minutes on their own account. See
[Handover](handover.html#3-what-the-successor-recreates).

1. **Sign up** at [cron-job.org](https://cron-job.org) and confirm the address. Use one you
   will still read next semester; it is where failure alerts go.
2. **Console → CREATE CRONJOB.**
3. **Title** — name it for what it does, not for the URL: `SMI create`, `SMI resolve`,
   `YouTube tick`, `Notify`. In six months you will be reading this list while something is
   broken.
4. **URL** — the backend's public URL plus the path, e.g.
   `https://your-backend.up.railway.app/admin/smi/daily`. It must be `https`.
5. **Execution schedule** — pick the times from the table above. The editor is a grid of
   minutes/hours/days rather than a cron string; for the two five-minute jobs there is a
   ready-made *Every 5 minutes* option. **Set the time zone to `Europe/Zurich`** — see
   below.
6. **Advanced** — this section is collapsed by default and contains the two settings that
   actually matter:
   - **Request method:** `POST`. The default is `GET`, and every one of these endpoints
     will reject a `GET`.
   - **Headers:** add `Authorization` with value `Bearer <your ADMIN_TOKEN>`. One header,
     name and value in separate fields — do not paste the whole line into the name box.
7. **Notifications** — switch on *notify on failure* and *notify on disable*. Without them
   a broken job is invisible until a student asks why there was no question.
8. **Save**, and make sure the job is **enabled**.

Repeat for all four. Then verify — see [below](#verifying-the-jobs-work).

### Limits worth knowing

The free tier is generous but has three edges that produce confusing symptoms:

| Limit | Free tier | What it looks like when you hit it |
|---|---|---|
| Request timeout | 30 s | Job marked failed even though the endpoint did its work |
| Response size | 64 KB | Execution aborted — "output too large" |
| Consecutive failures | 25 | **The job is disabled automatically** |

The timeout is the realistic one. A Railway container that has scaled to zero needs a few
seconds to wake, and the SMI job then calls an external quote provider. If a job
intermittently reports a timeout but the question appears anyway, that is what happened —
the work committed, the response just arrived late.

> **Danger:** The auto-disable after 25 failures is the trap. Rotate `ADMIN_TOKEN` without
> updating the header and every job returns `403`; the five-minute jobs burn through 25
> failures in about two hours and switch themselves off. Re-enabling is a manual click, and
> the only symptom is that nothing happens the next morning.

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

The YouTube and notification ticks run every five minutes, so they are timezone-agnostic.

**On cron-job.org, set the job's time zone to `Europe/Zurich` and the problem disappears.**
Each job carries its own time zone (it defaults to UTC), and the service applies the
offset for you. Schedule the SMI jobs at **08:00** and **17:30** Zurich local and leave
them alone — they follow the country twice a year without you touching anything.

08:00 and 17:30 are both far from the 02:00–03:00 window where DST transitions cause a
local time to be skipped or repeated, so there is no edge case to reason about here.

### If your scheduler has no time zone setting

Run **both** UTC variants year-round: four SMI jobs instead of two, the winter pair and the
summer pair, all enabled. Every endpoint is idempotent, so the call that fires at the
"wrong" hour does nothing:

- `/admin/smi/daily` refuses to create a second question for the same day, and refuses
  entirely once voting has closed.
- `/admin/smi/resolve` only touches questions that are still unresolved, and waits until
  after 18:00 Zurich before attempting today's.

Duplicate calls are harmless. Twice-yearly manual edits are not, because they get
forgotten.

## Verifying the jobs work

Do this immediately after setup rather than discovering a problem a week in.

**1. Call each endpoint by hand.** All four return `200` with a `log` array describing
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

### `POST /admin/notifications/dispatch`

Finds questions that are visible (`published_at <= now`) and still open
(`deadline > now`) and have not been announced yet, then emails every participant who has
email notifications switched on — one message per recipient, so no participant sees
another's address. It records `questions.notified_at` afterwards, which is what makes
repeat calls harmless.

Two deliberate silences:

- A question **published more than 24 hours ago** is marked as processed and *not* emailed.
  This is what stops a first deployment, a restored backup, or a multi-day cron outage from
  blasting stale announcements.
- With no `RESEND_API_KEY` set, the intended recipients are written to the `log` array
  instead of being emailed. Useful locally; a silent failure in production.

```json
{
  "ok": true,
  "notified": [{ "question_id": 42, "title": "SMI: Higher close today?", "recipients": 31 }],
  "log": ["[notify] question 42 announced to 31 recipient(s)"]
}
```

If a send fails, `notified_at` stays `NULL` and the next tick retries that question.

## Cost note

The Railway backend config currently carries a comment telling you not to enable
scale-to-zero because of in-process timers. Those timers no longer exist — everything
moved to the cron endpoints described here. Scale-to-zero is compatible with this design;
the first cron call of the morning simply wakes the container.

If you enable it, allow for a cold start: the SMI job may take a few extra seconds, which
is harmless given the hour of slack before the 08:00 publish.

## Next

→ [Deployment](deployment.html): the services these jobs point at.
