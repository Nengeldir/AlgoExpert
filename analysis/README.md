# Expert Algorithm analysis

Implements the algorithm exactly as presented in the lecture slides
("Advanced Lecture: Learning from Experts", Bernd Gärtner), run over the votes
your students cast in the app.

## Quick start

```bash
pip install -r requirements.txt

curl -H "Authorization: Bearer $ADMIN_TOKEN" \
     "http://localhost:3000/admin/export?format=csv" -o votes.csv

python run.py votes.csv --sweep
```

Writes into `out/`: `summary.txt` (read it out loud), `rounds.csv`,
`experts.csv`, and five charts.

Verify the implementation first — this reproduces the slides' worked example
number for number:

```bash
python test_expert_algorithm.py     # 26 tests, or: pytest analysis
python run.py fixture_slides.csv    # -> 52.1% / 87.5% / 37.5%
```

## The algorithm

Every expert starts with weight 1. Each round:

1. `W` = total weight of the experts who **voted this round**
2. `C` = weight of those who voted for what turned out to be correct
3. **`p = C / W`** — "Follow *i*" picks expert *i* with probability `w_i/W`, so
   `p` is exactly its chance of being right that round
4. experts who were right get `w *= (1 + G)`; everyone else is untouched
5. weights are renormalised to sum to 1

The headline number is `mean(p)` over all rounds. `G = 1` is the slides'
"double the weights of the experts that got it right".

**Guarantee** (slide 12), checked on every run:

```
mean(p)  >=  ln(1+G)/G * best expert's rate  -  ln(E)/(D*G)
```

Over few rounds the `ln(E)/(D*G)` term can make this negative, i.e. it promises
nothing. That is a property of the bound, not a failure — the algorithm
routinely beats its guarantee long before the guarantee is worth quoting.
`summary.txt` says so explicitly when it happens.

## Absent students

Agreed with Bernd: a student who didn't vote isn't dropped from the round —
`loader.py` flips a coin for them (uniform 50/50) and records that as their
vote, tagged `manual=False` so it's always distinguishable from a real cast
vote (`manual=True`). `rounds.csv` carries `manual_voters` alongside `voters`,
`experts.csv` carries `manual_answered` alongside `answered`, and
`summary.txt` reports **manual participation** — the fraction of votes that
were real — separately from the (now normally 100%) coverage number. Use
`--fill-seed` to change or pin the coin flips across re-runs of the same
export.

Two things to report honestly:

- **A student's rate over "all rounds" now includes their coin flips.** Heavy
  absence pulls a student's rate towards 50%, which is by design (a filled
  vote is uninformative), but it means a low-`manual_answered` student's
  number is not really about their prediction skill.
- **Run the robustness pass.** `--min-participation 0.8` restricts to students
  who showed up for most questions — this filter is evaluated on real votes
  *before* the coin-flip fill, so it still measures actual engagement. If the
  headline survives, say so; if it doesn't, that is the finding.

## Choosing G

Don't hardcode 10 % — that was tuned for *D* = 365, *E* = 7. `--sweep` plots two
curves against G:

- **what this class got** — re-runs the algorithm at each G on the real votes
- **what the theorem guarantees** — the bound above

They peak in different places, because the bound is worst-case over *all*
possible expert behaviour while the empirical curve knows what your students
actually did. When the best expert is obvious a large G locks onto them much
faster than the bound gives it credit for. Worth showing; the gap between "what
is provable" and "what happened" is a lecture point in itself.

## Files

| File | |
|---|---|
| `expert_algorithm.py` | the algorithm. Pure functions, no I/O |
| `loader.py` | export CSV → rounds; filtering, ordering, participation |
| `plots.py` | charts (validated palette, light + dark) |
| `run.py` | CLI |
| `test_expert_algorithm.py` | pinned to the slides' worked example |
| `make_fixture.py` | regenerates `fixture_slides.csv` from the slide table |

## Options

```
-G, --growth-rate      weight growth rate (default 1.0 = doubling)
-o, --outdir           output directory (default ./out)
    --min-participation  keep experts answering >= this fraction (e.g. 0.8)
    --fill-seed         seed for the 50/50 coin flip filled in for non-voters
    --tie-break        which side a tied majority falls to (default A)
    --sweep            also sweep G and plot actual vs guaranteed
    --top              experts to name in the weight chart (default 6)
    --dark             render charts for a dark surface
    --no-plots         numbers only
```

## Round ordering

Rounds must run in chronological order or the weight trajectories are
meaningless. The loader orders by `deadline`, falling back to `question_id`,
falling back to earliest `voted_at` **with a warning**.

Exports from before the `question_id`/`deadline` columns were added only support
the last of those. If `summary.txt` reports
`round ordering: first vote timestamp (approximate)`, re-export from a current
backend before trusting anything.
