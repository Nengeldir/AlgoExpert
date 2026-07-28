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

Students who didn't vote are treated as **sleeping experts**: they contribute no
weight that round and their weight is not penalised. `W` counts participants
only, so `p` stays an honest probability even when half the class skipped.

The guarantee survives this. The chain still runs, because
`C = p·W_participating ≤ p·W_total`, so `W_{t+1} ≤ W_t(1 + G·p_t)` as required,
and the best expert's final weight is still `(1+G)^R`. What the renormalisation
*does* change is interpretation: `p` is the chance of being right *given someone
answered*, not the chance of having an answer to give at all.

Two things to report honestly:

- **Best expert** is `correct / D` by default — the slides' definition, where an
  absence counts against you. `experts.csv` also carries `rate_over_answered`.
  With patchy attendance these diverge a lot and someone will ask.
- **Run the robustness pass.** `--min-participation 0.8` restricts to students
  who showed up for most questions, where full participation is roughly true.
  If the headline survives, say so; if it doesn't, that is the finding.

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
