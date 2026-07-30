# Troubleshooting

Symptom first, then cause, then fix. If your problem is not here, the backend logs in
Railway are the next stop — every scheduled job logs what it did and why it skipped.

## No question appeared this morning

**Check in this order.**

**Is it a weekend or a Swiss public holiday?** The SMI job skips Saturday and Sunday
outright. Holidays are not detected in advance — a question *is* created, then deleted
later when no close data arrives.

**Did the cron job fire?** Look at cron-job.org's execution history for
`/admin/smi/daily`. A `403` means the token is wrong, `404` the URL, a timeout usually a
cold start on a sleeping container.

**Run it by hand and read the log:**

```bash
curl -X POST https://your-backend.up.railway.app/admin/smi/daily \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

The `log` array tells you exactly what happened:

| Log message | Meaning |
|---|---|
| `skipped — market is closed on weekends` | Working as intended |
| `question for <date> already exists` | It worked; the question is there |
| `skipped — voting for <date> already closed` | Cron fired after 12:00 Zurich. Check your schedule against the [DST table](cron-setup.html#the-daylight-saving-trap) |
| `no previous close available yet` | Data provider returned nothing usable |
| `yahoo failed: …` / `stooq failed: …` | See [SMI data providers](#smi-data-providers-failing) below |

If it is late morning and nothing works, click **Publish SMI Question** in the admin
console — same code, run immediately. It still refuses after 12:00.

## A question is stuck unresolved

**SMI:** resolution only attempts today's question after **18:00 Zurich**, and only once
the provider publishes the close. A question unresolved at 19:00 usually means the
provider is failing. Run `/admin/smi/resolve` by hand and read the log.

**YouTube:** the tick needs a baseline before it can resolve. If `race_start_views_a` was
never captured — because the API was down at 12:00, or the key was missing — the question
can never resolve automatically, since the resolve half requires a non-null baseline.

That case needs a manual decision: either resolve it yourself in the admin console using
public view counts, or delete it. There is no way to reconstruct a baseline after the
fact.

**Exact tie:** the log says `tie (ΔA=…, ΔB=…), skipping`. It retries every tick and
almost always separates within minutes. If it genuinely stays tied, resolve or delete
manually.

## SMI data providers failing

The app tries **Yahoo Finance** first, then **Stooq**, and gives up if both fail.

> **Note:** As of mid-2026, Stooq serves a browser-verification page to non-browser
> clients, so it usually yields zero rows. It is kept only in case that gate is lifted.
> In practice Yahoo is the only working provider.

Yahoo is keyless and may be blocked from some cloud egress IPs — a provider that works
from your laptop can fail from Railway. Test from the deployed backend, not locally.

This has been investigated at length. **Twelve Data, Alpha Vantage, and Financial
Modeling Prep were all evaluated and none of them serve SMI (`^SSMI`) closes on a free
tier** — do not spend time retesting them. The leftover
`FINANCIAL_MODELLING_PREP_API_KEY` in `.env.example` is a relic of that search and is
read by nothing.

If both providers are down for a day, the honest options are to resolve the question
manually from any public SMI quote, or delete it. Do not leave it pending — the analysis
skips unresolved questions, but a stale card confuses students.

## YouTube API quota exceeded

The YouTube Data API has a daily quota. Symptoms: `/admin/youtube/suggest` returns a
`502` mentioning quota, or the tick logs `baseline fetch incomplete` / `closing fetch
incomplete` repeatedly.

The quota resets at **midnight Pacific time**, which is mid-morning in Zurich — so a
quota exhausted during the day typically recovers before the next morning's suggestion
but *after* that night's resolution window.

If the 24:00 resolution was missed, the tick keeps retrying and will close the race as
soon as quota returns. The measured window ends up longer than twelve hours; because
`race_end_at` is recorded, you can see exactly how much longer. Both videos are read in
the same call, so the extra time does not favour either option.

To reduce consumption, regenerate suggestions less often — each **Regenerate** costs a
fresh set of API calls.

## Students cannot log in

**"Invalid credentials" for everyone, suddenly.** `JWT_SECRET` changed, which invalidates
every existing token. Students need to log in again; their accounts are intact.

**One student cannot log in.** Login accepts *either* pseudonym or email in the
`identifier` field. Have them try the other one. If neither works, they should use
password reset.

**Password reset emails not arriving.** Check `RESEND_API_KEY` is set on the backend —
without it, reset links are only logged to the console. Then check `CORS_ORIGIN`, since
it is also the base URL for the reset link; a wrong value produces emails with dead
links. Reset tokens expire after **one hour** and are single-use.

The forgot-password endpoint always returns a generic success, whether or not the email
matches an account. That is deliberate — it prevents anyone probing which emails are
registered — but it does mean "I got the confirmation" is not evidence the address was
correct.

## Nobody was emailed about today's question

Work down this list — the causes are ordered by how often they are the answer.

**Is the notification cron job configured?** `POST /admin/notifications/dispatch` is what
sends the announcements, and it is a separate job from the SMI and YouTube ones. Call it by
hand; the response tells you what it did:

```bash
curl -X POST https://your-backend.up.railway.app/admin/notifications/dispatch \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Is `RESEND_API_KEY` set?** Without it the dispatcher reports success and lists the
recipients in its `log` array without sending anything. Look for
`(not sent — RESEND_API_KEY unset)`.

**Was the question published more than 24 hours ago?** Those are marked as processed and
deliberately skipped — the log says `skipped — published more than 24 h ago`, and the
outcome carries `"skipped": "stale"`. An announcement that arrives after voting has nearly
closed is worse than none.

**Has voting already closed?** Only questions with `deadline > now` are announced. If the
cron has been down since before 12:00, today's question will never be emailed about.

**Did the students turn it off?** The Settings page has an *Email notifications* switch,
default on. Only accounts with it on receive announcements.

Note that `notified_at` is a per-*question* ledger, not per-recipient: someone who
registers after the announcement went out is not backfilled.

## A student says their vote is missing

**Did they actually submit?** Voting is one-shot: the API rejects a second vote with
`409 You have already voted on this question`. There is no edit. Check the votes panel
for that question in the admin console.

**Was the question deleted?** A public-holiday SMI question gets deleted along with its
votes. That is the usual explanation for history that is shorter than remembered.

**Did they miss the window?** Voting closes at 12:00 Zurich, not at midnight. Students
who assume "sometime today" miss it. This is worth saying explicitly in the first
lecture.

## CORS errors in the browser

The frontend is calling a backend that does not list its origin. Set `CORS_ORIGIN` on the
backend to the frontend's exact public URL — scheme included, no trailing slash — and
redeploy.

If the frontend is calling the *wrong* backend entirely, the cause is `VITE_API_URL`,
which is baked in at build time. Changing it requires a rebuild, not just a restart.

## Everything is gone after a deploy

The backend is running without its volume, so SQLite wrote to the container filesystem
and it vanished on redeploy.

Confirm the Railway volume is attached and mounted at `/data`, and that
`DATABASE_PATH=/data/app.db`. Data written to a non-volume path is not recoverable.

## Docker problems locally

**Health check keeps failing.** Run `docker compose logs backend`. If it started fine,
you are probably on a stale cached image — `docker compose up --build`.

**Port already in use.** Something else holds 3000 or 5173. Stop it, or change the ports
in `docker-compose.yml` and `.env`.

**`npm run dev` fails.** Node 20+ required (`node --version`), and `npm install` must
have been run at the repository root.

## Next

→ [Semester reset](semester-reset.html): starting clean for a new cohort.
