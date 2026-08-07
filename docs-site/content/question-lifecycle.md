# Question lifecycle

This page explains the timing rules. It is the one piece of design you should understand
before changing anything, because breaking it does not produce an error — it produces
data that looks fine and means nothing.

## The daily shape

Every question, whatever its source, follows the same anchors in Europe/Zurich time:

```text
08:00  publish        question becomes visible, voting opens
12:00  voting closes  measurement window STARTS here
24:00  race ends      measurement window ends, question resolves
```

These live in one file, `apps/backend/src/services/schedule.ts`, as `PUBLISH_HOUR`,
`VOTING_CLOSE_HOUR` and `RACE_END_HOUR`.

## The rule: the windows must not overlap

**Voting closes before the measured window opens.** Always.

If you run the YouTube race for a full
24 hours while voting stayed open the whole time. A student voting at hour 23 had
already watched 96% of the thing being measured — they were not predicting, they were
reading off the answer.

That is bad twice over:

1. **It inflates accuracy** for late voters in a way that has nothing to do with skill.
2. **It destroys heterogeneity.** Late voters converge on the observable answer, so the
   diversity the Expert Algorithm depends on collapses. The lecture result gets duller
   the more people exploit it.

So the measured window starts *at* the voting deadline. A voter can know everything up
to 12:00 and nothing after it, which is exactly what "predicting" should mean.

## What this forces in the code

The rule is not a comment — it dictates several implementation choices that look odd in
isolation.

**The YouTube baseline is captured when voting closes, not when the pair is suggested.**
`youtube_suggestions.race_start_views_a/b` is filled by a cron tick at 12:00. The
view counts stored at suggestion time (`video_a_views`) are display context only —
they are shown in the question text so students have a sense of scale, and they are
never used to score anything.

**`/admin/youtube/resolve` is a tick, not a resolve.** Each call does two idempotent
things: snapshot the baseline for races whose `race_starts_at` has passed, and close out
races whose `race_ends_at` has passed. That is why it runs every five minutes rather
than once a day.

**Both boundary snapshots record when they were actually taken** — `race_start_at` and
`race_end_at`, alongside the view counts. So the true window length is auditable rather
than assumed. Cron job problems lengthens the window but cannot favour one option, because both
videos are read in a single API call.

**Questions approved ahead of their slot stay hidden.** `GET /api/questions` filters on
`published_at <= now`, so approving at 07:00 does not leak the question before 08:00.

**The "new question" email is a cron tick too**, for the same reason: it fires when the
question becomes visible, not when it was created. Announcing at creation time would leak
a question ahead of its slot, and would also arrive at whatever hour you happened to click
**Approve**. `POST /admin/notifications/dispatch` runs every five minutes, uses the same
`published_at <= now AND deadline > now` window as the student-facing endpoint, and records
`questions.notified_at` so nobody is emailed twice.

## The SMI question and its residual leak

SMI voting closes at **12:00**, not at the 17:30 market close. That keeps the
12:00–17:30 stretch of the trading day — the part that decides most of the outcome —
unobservable to voters.

> **Warning:** There is a known, deliberate residual leak. Voters can still see
> 09:00–12:00 trading, roughly 35% of the measured day. 

This is worth stating out loud in the lecture rather than hiding: it is a real,
quantified limitation of the experiment, and "how much did the leak matter?" is itself
a decent discussion question.

## Ground truth by source

| Source | Option A | Option B | Decided by |
|---|---|---|---|
| SMI | Higher close | Flat or lower close | Today's close vs. previous close |
| YouTube | Video A gained more views | Video B gained more views | Δviews over the 12:00–24:00 window |
| Manual | Whatever you wrote | Whatever you wrote | You, in the admin console |

The SMI comparison is strict: A wins only if `today > previous`. An exactly flat close
resolves to B.

YouTube ties are **not** resolved. If both videos gained exactly the same number of
views the tick logs the tie and leaves the question pending, retrying on the next run.
In practice the counts diverge within minutes; if a question is genuinely stuck on a tie
you can resolve or delete it manually.

## Weekends and holidays

The SMI job skips Saturday and Sunday outright. Public holidays are handled after the
fact: if a past SMI question never gets close data, the resolver concludes the market
was shut and **deletes the question and its votes**.

That deletion is intentional — a question with no possible ground truth would otherwise
sit unresolved forever and pollute the export. But it does mean a student's vote can
disappear. If someone asks why their history is shorter than they remember, a holiday is
the likely explanation.

## The timestamp trap

If you ever write SQL against this database, know this:

> **Danger:** Timestamps are ISO-8601 strings. **Never** compare them against
> `datetime('now')`. SQLite compares TEXT lexicographically, and ISO's `T` (0x54) sorts
> above the space (0x20) that `datetime('now')` emits — so `deadline < datetime('now')`
> stays *false* until the UTC date rolls over. Bind `new Date().toISOString()` as a
> parameter instead.

This has bitten the project before. It fails silently and only near midnight, which is
the worst combination.

## Next

→ [Admin console](admin-console.html): the controls you actually click.
