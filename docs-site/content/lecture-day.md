# Lecture day

Turning a semester of votes into the live analysis. Budget half an hour the day before,
not ten minutes beforehand.

## The pipeline

```text
GET /admin/export?format=csv
        │
        ▼
    votes.csv
        │
        ▼
python analysis/run.py votes.csv --sweep
        │
        ▼
  out/summary.txt   headline numbers + the guarantee check
  out/rounds.csv    per-round table
  out/experts.csv   per-expert record and final weight
  out/*.png         weight trajectories, cumulative rates, G sweep, leaderboard
```

## Step 1 — export

From the admin console, click **Export CSV**. Or:

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  "https://your-backend.up.railway.app/admin/export?format=csv" -o votes.csv
```

Before going further, check the file: it should have one row per (student, question) pair
and a populated `ground_truth` column. Rows with an empty `ground_truth` are unresolved
questions — the analysis skips them, but a large number means something never resolved
and is worth investigating in [Troubleshooting](troubleshooting.html) first.

## Step 2 — verify the implementation

Do this before trusting any number. The analysis reproduces the lecture slides' worked
example exactly:

```bash
cd analysis
pip install -r requirements.txt
python test_expert_algorithm.py       # 26 tests
python run.py fixture_slides.csv      # -> 52.1% / 87.5% / 37.5%
```

Those three percentages are the slides' own figures. If they do not match, stop — do not
run your real data through a broken implementation.

## Step 3 — run it

```bash
python run.py votes.csv --sweep
```

Everything lands in `out/`. Read `summary.txt` first; it is written to be read aloud.

Useful options:

| Flag | Effect |
|---|---|
| `-G, --growth-rate` | Weight growth rate. Default `1.0` = the slides' "double the winners" |
| `--sweep` | Also sweep G and plot actual vs. guaranteed performance |
| `--min-participation` | Restrict to students who answered at least this fraction, e.g. `0.8` |
| `--dark` | Render charts for a dark projector background |
| `--top` | How many experts to name in the weight chart (default 6) |
| `--no-plots` | Numbers only |

## What the algorithm does

Each expert starts with weight 1. For every resolved question:

1. `W` = total weight of the experts who **voted this round**
2. `C` = weight of those who chose what turned out to be correct
3. **`p = C / W`** — the learner "Follow *i*" picks expert *i* with probability `w_i/W`
   and copies their answer, so `p` is exactly its probability of being right this round
4. everyone who was right has their weight grown by `(1 + G)`
5. everyone else — wrong or absent — is left untouched

The headline number is the mean of `p` over all rounds.

> **Note:** This is the **reward** variant from the course slides (grow the winners,
> randomized learner), not the penalty variant (`w *= β` on a mistake, deterministic
> weighted majority) common in the literature. They are closely related but produce
> different numbers. Do not mix them up mid-lecture.

## The guarantee, and when it says nothing

```text
mean(p)  >=  ln(1+G)/G * best expert's rate  -  ln(E)/(D*G)
```

for `E` experts over `D` questions. `run.py` checks it on every run.

Smaller `G` raises the achievable fraction — `ln(1+G)/G` is 69% at `G=1`, 95% at `G=0.1`,
over 99% at `G=0.01` — but inflates the `ln(E)/(D*G)` term, so it needs more rounds to
wash out. Over a lecture-sized `D` **the bound can come out negative and promise
nothing** while the algorithm comfortably beats it. `summary.txt` says so explicitly when
that happens.

That gap is itself a good lecture point: the bound is worst-case over all possible expert
behaviour, while the empirical curve knows what your students actually did.

## Absent students

A student who did not vote is not dropped from the round: the loader flips a coin for
them (uniform 50/50) and records that as their vote, tagged `manual=False` so it stays
distinguishable from a real cast vote (`manual=True`). `rounds.csv` carries
`manual_voters` next to `voters`, `experts.csv` carries `manual_answered` next to
`answered`, and `summary.txt` reports **manual participation** — the share of votes that
were real — separately from total coverage (normally 100%, since every gap gets filled).

Two things to report honestly, because someone will ask:

- **A student's rate over "all rounds" now includes their coin flips**, which pulls it
  towards 50% the more they were absent — that's the fill working as intended, but it
  means a student with few `manual_answered` rounds has a rate that says more about the
  coin than about them.
- **Run the robustness pass.** `--min-participation 0.8` restricts to students who showed
  up for most questions — evaluated on real votes, before the coin-flip fill. If the
  headline survives, say so. If it does not, *that is the finding* — present it either
  way.

## Round ordering

Rounds must run chronologically or the weight trajectories are meaningless. The loader
orders by `deadline`, falling back to `question_id`, falling back to earliest `voted_at`
**with a warning**.

If `summary.txt` reports `round ordering: first vote timestamp (approximate)`, your
export predates the `question_id`/`deadline` columns. Re-export from the current backend
before trusting anything.

## Before you present

- Do the students know their pseudonyms? The leaderboard chart names them, and that is
  the moment people care about.
- Have you decided whether to show the leaderboard at all? It is the first time vote data
  becomes public — deliberately withheld all semester to protect prediction diversity.
  Once shown, it is shown.
- Is the participation rate on a slide? The headline is not interpretable without it.
- Are charts rendered for your projector? `--dark` if the room runs dark.

## Where the details live

`analysis/README.md` in the repository is the full workflow, including how to choose `G`
and how to regenerate the slide fixture. `docs/algorithm.md` covers the theory and why
individual votes stay hidden.

## Next

→ [Reference](reference.html): endpoints, variables, tables, commands.
