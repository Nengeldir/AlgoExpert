# The live predictor

The Expert Algorithm running against the class in real time, at **`/admin/predictor`**.

Every time voting closes, the predictor takes the votes that were cast, weights them by how
right each student has been so far, and commits its own A/B answer. When the ground truth
arrives it scores itself and re-weights. The view shows how that aggregate compares to the
students it is built from.

It is admin-only and deliberately so — the weights are the reveal material for the lecture,
and showing them to participants mid-window would let them herd.

## Two predictors: SMI and YouTube

Guessing the stock index and guessing a video race are different skills, so the page runs
**one predictor per question series**. The SMI / YouTube switch at the top of the page
flips between them; each has its own expert pool, its own weights, its own round count and
its own guarantee check, and nothing a student does on one series affects their weight on
the other. One-off manual questions belong to neither and are never predicted. The tick
drives both series in one call.

## What you have to do

**Set up one cron job**, then nothing. See [Cron setup](cron-setup.html).

| Job | URL | Schedule |
|-----|-----|----------|
| Predictor tick | `/admin/predictor/tick` | `*/5 * * * *` |

The tick does two things, both idempotent:

1. **Commits** a prediction for any question whose deadline has passed and that has not been
   predicted yet.
2. **Scores** any prediction whose question has since resolved.

Calling it twice changes nothing, so a tight schedule only shortens the delay between voting
closing and the prediction being recorded. The **Run tick now** button on the page does the
same thing by hand if you want to see the effect immediately.

## The window

The predictor only looks at questions whose voting closes between **28 August and 11
September 2026**. Anything outside that is ignored entirely, so leftover test questions from
before the semester cannot contaminate the run.

Planned horizons are **9 SMI questions** (trading days) and **11 YouTube questions** (every
day). Nothing breaks if the real number differs; the count on the page just reads "N rounds
scored of 9 planned" for the series you are looking at.

To change the window, set `PREDICTOR_SEASON_START` and `PREDICTOR_SEASON_END` (both
`YYYY-MM-DD`) before the first prediction is committed. See [Semester
reset](semester-reset.html).

## Reading the page

**The stat row.** The predictor's own record, then the benchmarks: the best student in
hindsight, the randomized "Follow i" learner, the plain unweighted majority, and the class
average. The one that matters is the gap to the best expert — the algorithm is supposed to
land near it *without having known in advance who it would be*.

**Cumulative success rate.** The same numbers as a trajectory. Hover any round for the exact
figures. The dotted rule at 50% is the coin flip; anything below it is worse than guessing.

**Does the guarantee hold?** Two bounds, because there are two learners:

- *Follow i* gets the Hedge loss bound — it is randomized, so its loss is a fraction.
- *Weighted Majority* gets the Littlestone–Warmuth mistake bound — it commits a single A/B,
  so its loss is a whole mistake.

A **✗ violated** badge means a bug, not a refuted theorem. Report it rather than explaining
it away.

Early in the window the page will say the bound is **true but not yet informative**. That is
honest and expected: with a couple of dozen rounds the regret term is a large fraction of the
horizon. Say it out loud in the lecture — the algorithm beats its guarantee long before the
guarantee is worth quoting.

**Where the weight went.** One row per student, one column per round, darker = more weight.
Everyone starts equal and the algorithm concentrates on whoever keeps being right. This is
the picture worth showing the class.

**Round ledger.** Every prediction, in order. A row appears when voting closes, so a round
that has not resolved yet shows a prediction with an empty truth column — which is the point:
the predictor committed before it could know.

## Why it is so strict about not changing things

The whole guarantee rests on the predictor committing *before* the truth is known, using only
past results, with its parameters chosen in advance. Two consequences you will run into:

- **Parameters freeze on the first prediction.** After that, `POST /admin/predictor/season`
  returns 409 for everything except a longer run: a body with only `window_end` and/or
  `t_planned`, each at or beyond the current value, is still accepted, because extending the
  horizon touches neither the rate, the seed nor the frozen pool. Change the learning rate
  *before* the first commit or not at all.
- **A predicted question cannot be deleted.** `DELETE /admin/questions/:id` returns 409 with
  the round number. Delete a bad question *before* its deadline — after that, its result is
  part of the run's history.

The expert pool is frozen the first time voting closes: everyone with an account at that
moment is an expert for the whole window. Students who register later vote normally and their
answers count for them, but they are not in the predictor — the cohort size feeds the learning
rate and every bound, so it must not drift.

## Students who did not vote

A missing vote is not an absence. The predictor flips a coin on that student's behalf and uses
it, which is the class policy agreed for the analysis — "if you don't vote, the algorithm votes
for you".

The flip is seeded, so it is identical every time the page is loaded or the run is replayed. The
ledger records which votes were real: the **Votes** column reads `real/total`, and the stat row
shows the overall share. If that share is low, say so when presenting — a coin flip is an
uninformative expert and it drags the aggregate toward 50%.

## Does this agree with the Python analysis?

Yes, and it is tested. `analysis/expert_algorithm.py` uses the slides' convention (grow the
winners by `1+G`); the live predictor uses the handout's (shrink the losers by `e^-η`). They are
the same algorithm with `η = ln(1+G)`, and a test replays the shared fixture through both and
asserts every round matches.

The page shows both rates — `η` and the slides' `G` — in the config chips, so you can quote
either without converting by hand.
