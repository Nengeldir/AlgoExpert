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

Students who did not vote are treated as **abstaining** ("sleeping experts"):

- their weight is **not** penalised for the missed round
- they contribute zero weight to that round, and `W` counts participants only

**Rationale**: penalising absence would rank students by participation rather
than prediction quality. A student who votes only when confident should not be
punished for selective participation.

The guarantee survives this, because `C = p·W_participating ≤ p·W_total` keeps
`W_{t+1} ≤ W_t(1 + G·p_t)` intact. What changes is interpretation: `p` becomes
the chance of being right *given someone answered*. Report the participation
rate alongside the headline, and re-run restricted to students with high
attendance as a robustness check.

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
  out/rounds.csv    per-round table
  out/experts.csv   per-expert record and final weight
  out/*.png         weight trajectories, cumulative rates, G sweep, leaderboard
```

`question_id` and `deadline` exist so the analysis can order rounds
chronologically. Grouping by `question_title` alone sorts alphabetically
("Day 10" before "Day 2"), which silently scrambles every weight trajectory.

See [`analysis/README.md`](../analysis/README.md) for the full workflow. The
implementation is pinned to the slides' worked example by
`analysis/test_expert_algorithm.py` — 8 days, 7 experts, and the same 52.1 % /
87.5 % / 37.5 % the slides arrive at.
