# Daily operations

What a normal day looks like, what needs your attention, and how to tell quickly that
nothing is stuck.

## A normal weekday

All times are **Europe/Zurich wall-clock**. The app handles the CET/CEST switch itself;
the cron scheduler does not (see [Cron setup](cron-setup.html#the-daylight-saving-trap)).

| Time | What happens | Triggered by |
|---|---|---|
| ~07:00–08:00 | SMI question row created, published at 08:00 | Cron → `/admin/smi/daily` |
| 08:00 | Questions become visible to students, voting opens | `published_at` filter |
| 12:00 | Voting closes. Measured windows start | `deadline` on the question |
| 12:00–12:05 | YouTube baseline view counts snapshotted | Cron → `/admin/youtube/resolve` |
| 17:30 | SMI market close |  |
| 18:00+ | SMI question resolves once the close is published | Cron → `/admin/smi/resolve` |
| 24:00 | YouTube race window ends |  |
| 00:00–00:05 | YouTube question resolves, votes scored | Cron → `/admin/youtube/resolve` |

Note that `/admin/youtube/resolve` appears twice. It is a **tick**, not a one-shot
resolve: each call opens any race that has started and closes any that has ended. Both
halves are idempotent, which is why it can safely run every five minutes.

## Your one recurring task: approve a YouTube pair

YouTube questions are **not** created automatically — a human should look at the pair
first, because the API occasionally returns something unsuitable.

1. Go to `/admin/login`, paste the admin token.
2. Click **YouTube Suggestion**, then **Generate Suggestion**.
3. Look at the two videos. If the pair is bad, click **Regenerate**.
4. Click **Approve** to publish it.

> **Note:** Approving is decoupled from the schedule. You should approve a pair between 07:00 - 8:00, so that it becomes visible to the students at 8:00.

One suggestion exists per day. Once approved it cannot be regenerated for that day.

## The daily health check

A ten-second glance at the admin dashboard answers "is anything stuck?".

Open `/admin/questions` and look at the top few cards:

- **Today's SMI question exists** and has a sensible previous close in its description.
- **Yesterday's questions are resolved** — resolved cards show the ground truth rather
  than the "Resolve" buttons.
- **Vote counts are non-zero** and roughly the size of your cohort.

If yesterday's question is still unresolved this morning, go to
[Troubleshooting](troubleshooting.html) — do not resolve it by hand yet, because the
automatic resolver may still succeed and manual resolution is irreversible.

## What "resolved" means

Resolving does two things in a single transaction: it sets `ground_truth` on the
question, and it scores every vote by setting `is_correct` to 1 or 0.

Scores are computed **once, at resolve time**, not recalculated on the fly. That is why
resolution is effectively permanent: there is no supported "unresolve" and the API
rejects a second resolve with `409 Question already resolved`. The only way back is
deleting the question, which also deletes its votes.

## Students who do not vote

A missing vote is not treated as wrong, but it is not left out of the round either: the
analysis flips a coin on the student's behalf (uniform 50/50) and records that as their
vote for that round, tagged as a fill rather than a real vote.

This matters for how you talk to the class: the fill is recorded separately from real
votes at every level of the export, so "manual participation" — the share of votes that
were actually cast — is a number worth reporting alongside the headline result, distinct
from the (now normally 100%) coverage number. See [Lecture day](lecture-day.html).

## Things you should not do

- **Do not resolve a question early** unless it is genuinely broken. The admin console
  offers "Resolve early" while voting is still open; using it scores everyone who has
  voted so far and locks out the rest.
- **Do not change the 08:00 / 12:00 / 24:00 anchors** without reading
  [Question lifecycle](question-lifecycle.html). Overlapping the voting and measured
  windows silently corrupts the experiment.
- **Do not expose vote data to students** mid-course, including "just the totals".
  Heterogeneity is the asset.

## Next

→ [Question lifecycle](question-lifecycle.html): why the timing is what it is.
