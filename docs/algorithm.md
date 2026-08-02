# Expert Algorithm ("Follow i")

## What it is

An online learning method where a set of "experts" (here: students) make binary
predictions each round, and a learner aggregates them using weights that evolve
over time. It reaches almost the success rate of the **best expert in
hindsight**, without knowing in advance who that is.

**Reference**: the course handout (Bernd Gärtner's slides, "Advanced Lecture:
Learning from Experts"). The method is the *Multiplicative Weight Update*
method; see also Littlestone & Warmuth (1994) and Arora, Hazan & Kale (2012).

> The implementation follows the **slides**, which use the reward variant
> (grow the winners) and a randomized learner. This differs from the penalty
> variant (`w *= β` on a mistake, deterministic weighted majority) found in much
> of the literature — the two are closely related but produce different numbers,
> so don't mix them.

## How it works

Each expert starts with weight `w_i = 1`. For each resolved question:

1. `W` = total weight of the experts who **voted this round**
2. `C` = weight of those who chose what turned out to be the ground truth
3. **`p = C / W`** — the learner "Follow *i*" picks expert *i* with probability
   `w_i / W` and copies their answer, so `p` is precisely its probability of
   being right this round
4. every expert who was right has their weight grown: `w_i *= (1 + G)`
5. everyone else — wrong or absent — is left untouched

The overall success rate of the algorithm is the average of the daily `p`
values. The growth rate `G` is a free parameter; `G = 1` is the slides' "double
the weights of the experts that got it right".

### The guarantee

```
success rate of "Follow i"  >=  ln(1+G)/G * best expert's success rate  -  ln(E)/(D*G)
```

for `E` experts over `D` questions. Smaller `G` raises the achievable fraction
(`ln(1+G)/G` is 69 % at `G=1`, 95 % at `G=0.1`, >99 % at `G=0.01`) but inflates
the `ln(E)/(D*G)` term, so it takes more questions to wash out. Over a
lecture-sized `D` the bound can be negative and promise nothing while the
algorithm comfortably beats it.

## Why we hide individual votes

The app deliberately **does not show other users' votes or rankings** until the
live lecture session:

- if students can see each other's votes they may herd, destroying the
  **diversity** of predictions
- the algorithm's power comes from aggregating **independent, heterogeneous**
  beliefs
- weights are revealed only during the live analysis — the dramatic moment of
  the lecture

## Policy for missing votes

Agreed with Bernd: a student who did not vote is not dropped from the round.
`analysis/loader.py` flips a coin on their behalf (uniform 50/50 over A/B) and
files the result as their vote for that round, so `W` and `C` cover every
known expert, every round, with no true absentees left by the time
`run_expert_algorithm` sees the data.

Every vote is tagged so the fill can always be told apart from the real
thing: `Round.manual[pseudonym]` is `True` for a vote the student actually
cast and `False` for a coin flip filled in on their behalf. This propagates
through the whole pipeline — `RoundResult.n_manual`, `ExpertStats.
manual_answered`, `Run.manual_participation` — and into `rounds.csv`
(`manual_voters`) and `experts.csv` (`manual_answered`), so a filled vote is
never silently indistinguishable from a real one in the exported data.

**Rationale**: this keeps the class's colloquial framing — "if you don't
vote, the algorithm votes for you" — and sidesteps the awkwardness of
`rate_over_all_rounds` vs. `rate_over_answered` diverging for students with
patchy attendance, since after filling everyone has answered every round.
What it costs is prediction quality: a coin flip is uninformative by
construction, so a student with several absences has their true skill diluted
towards 50% in every rate computed over *all* rounds. Use `manual_answered`
/ `manual_participation` to see how much of a given number rests on real
votes versus filled ones, and treat a low manual-participation run the same
way as before — as a prompt to re-run with `--min-participation 0.8` and
check the headline still holds on students who actually showed up.

The guarantee survives this unchanged: filled votes are still real entries in
`votes`, so `W_t` is still the weight of everyone who "voted" (manually or
not) and the same `W_{t+1} ≤ W_t(1 + G·p_t)` chain applies — the fill just
changes what the underlying `p_t` is estimating.

`run_expert_algorithm` itself still supports true absence (a pseudonym simply
missing from `Round.votes`, contributing no weight and left unpenalised) for
callers that build `Round`s by hand rather than through the loader — see
`analysis/test_expert_algorithm.py`. That primitive is what the loader's fill
step is applied on top of, not a second, competing policy.

## How app data flows into the analysis

```
GET /admin/export?format=csv
      │
      ▼  columns: question_id, deadline, pseudonym, question_title,
                  option_a, option_b, ground_truth, user_vote, is_correct, voted_at
      │
      ▼
analysis/run.py votes.csv --sweep
      │
      ▼
  out/summary.txt   headline numbers + the guarantee check
  out/rounds.csv    per-round table, incl. how many of that round's votes were real (`manual_voters`)
  out/experts.csv   per-expert record and final weight, incl. how many were real votes (`manual_answered`)
  out/*.png         weight trajectories, cumulative rates, G sweep, leaderboard
```

`question_id` and `deadline` exist so the analysis can order rounds
chronologically. Grouping by `question_title` alone sorts alphabetically
("Day 10" before "Day 2"), which silently scrambles every weight trajectory.

See [`analysis/README.md`](../analysis/README.md) for the full workflow. The
implementation is pinned to the slides' worked example by
`analysis/test_expert_algorithm.py` — 8 days, 7 experts, and the same 52.1 % /
87.5 % / 37.5 % the slides arrive at.
