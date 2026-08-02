"""Run the Expert Algorithm over an exported vote CSV and write the report.

    curl -H "Authorization: Bearer $ADMIN_TOKEN" \
         "http://localhost:3000/admin/export?format=csv" -o votes.csv
    python run.py votes.csv

Outputs (into --outdir, default ./out):
    summary.txt        the headline numbers, ready to read out loud
    rounds.csv         per-round table -- also the accessible view of the charts
    experts.csv        per-expert record and final weight
    *.png              the charts
"""

from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

import plots
from expert_algorithm import run_expert_algorithm, simulate_follow_i, sweep_growth_rate
from loader import load_votes

# Pre-registered 2026-08-02, before the experiment opens (Sat 29 Aug - Thu 10 Sep,
# D = 13 daily rounds inclusive, E ~= 30 expected students), so nobody can accuse us
# of picking G after seeing how well it happened to predict the actual votes.
#
# G* = sqrt(2 * ln(E) / D)  -- the classical Hedge/multiplicative-weights optimal
# learning rate, a function of the round/expert counts alone, never of outcomes.
# It's the same rule that gives the slides' D=365, E=7 rule of thumb of ~10%
# (sqrt(2*ln(7)/365) = 0.103); here sqrt(2*ln(30)/13) = 0.7234.
#
# If actual D or E drift once the roster is final, recompute from the formula
# above -- both are structural counts fixed before anyone votes, not something
# derived from who turned out to be right. Do not replace this with whatever
# --sweep finds after the fact.
DEFAULT_GROWTH_RATE = 0.7234


def parse_args(argv=None):
    p = argparse.ArgumentParser(
        description="Expert Algorithm analysis, per the lecture slides.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    p.add_argument("csv", help="vote export from GET /admin/export?format=csv")
    p.add_argument(
        "-G",
        "--growth-rate",
        type=float,
        default=DEFAULT_GROWTH_RATE,
        help="weight growth rate. Default is this run's pre-registered G "
        "(sqrt(2 ln E / D) for D=13, E=30, chosen before voting opened); "
        "1.0 = the slides' weight doubling",
    )
    p.add_argument("-o", "--outdir", default="out", help="where to write results")
    p.add_argument(
        "--min-participation",
        type=float,
        default=0.0,
        help="keep only experts who answered at least this fraction of questions "
        "(e.g. 0.8 for the robustness pass)",
    )
    p.add_argument(
        "--fill-seed",
        type=int,
        default=0,
        help="seed for the 50/50 coin flip filled in for experts who did not vote",
    )
    p.add_argument(
        "--tie-break",
        choices=["A", "B"],
        default="A",
        help="which side a tied majority vote falls to",
    )
    p.add_argument(
        "--sweep",
        action="store_true",
        help="also sweep G and plot actual vs guaranteed success rate",
    )
    p.add_argument("--sweep-max", type=float, default=2.0, help="upper end of the G sweep")
    p.add_argument("--top", type=int, default=6, help="experts to name in the weight chart")
    p.add_argument("--trials", type=int, default=10000, help="Follow-i simulation draws")
    p.add_argument("--seed", type=int, default=0, help="simulation seed")
    p.add_argument("--dark", action="store_true", help="render charts for a dark surface")
    p.add_argument("--no-plots", action="store_true", help="numbers only")
    return p.parse_args(argv)


def write_rounds_csv(run, path: Path) -> None:
    with path.open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(
            [
                "round", "question_id", "question", "ground_truth", "voters", "manual_voters",
                "follow_i_rate", "weighted_majority", "weighted_majority_correct",
                "plain_majority", "plain_majority_correct",
            ]
        )
        for r in run.rounds:
            w.writerow(
                [
                    r.index, r.question_id, r.label, r.truth, r.n_voters, r.n_manual,
                    f"{r.p:.6f}", r.weighted_majority, int(r.weighted_majority_correct),
                    r.unweighted_majority, int(r.unweighted_majority_correct),
                ]
            )


def write_experts_csv(run, path: Path) -> None:
    with path.open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(
            [
                "pseudonym", "answered", "manual_answered", "correct",
                "rate_over_all_rounds", "rate_over_answered", "final_weight_share",
            ]
        )
        for s in run.expert_stats:
            w.writerow(
                [
                    s.pseudonym, s.answered, s.manual_answered, s.correct,
                    f"{s.rate_over_all_rounds:.6f}",
                    f"{s.rate_over_answered:.6f}",
                    f"{s.final_weight_share:.8f}",
                ]
            )


def build_summary(run, report, sim, args) -> str:
    L: list[str] = []
    add = L.append

    add("=" * 66)
    add("  EXPERT ALGORITHM  --  'Follow i'")
    add("=" * 66)
    add("")
    add(f"  questions (D)        {run.n_rounds}")
    add(f"  experts (E)          {run.n_experts}")
    add(f"  growth rate (G)      {run.growth_rate:.0%}")
    add(f"  manual participation {run.manual_participation:.1%} of all (expert, question) pairs")
    if report.n_filled:
        add(
            f"  auto-filled (50/50)  {report.n_filled} pair(s), "
            f"{1 - run.manual_participation:.1%} of the total"
        )
    add(f"  round ordering       {report.ordering}")
    add("")
    add("-" * 66)
    add("  SUCCESS RATES")
    add("-" * 66)
    add("")
    add(f"  \"Follow i\"           {run.follow_i_rate:>7.1%}   <- the algorithm")
    add(f"  best expert          {run.best_expert_rate:>7.1%}   (in hindsight, correct/D)")
    add(f"  weighted majority    {run.weighted_majority_rate:>7.1%}")
    add(f"  plain majority       {run.unweighted_majority_rate:>7.1%}")
    add(f"  average expert       {run.mean_expert_rate:>7.1%}")
    add(f"  median expert        {run.median_expert_rate:>7.1%}")
    add(f"  coin flip            {0.5:>7.1%}")
    add("")
    gap = run.follow_i_rate - run.best_expert_rate
    add(f"  gap to best expert   {gap:>+7.1%} ({abs(gap) * run.n_rounds:.1f} questions over {run.n_rounds})")
    add("")
    add("-" * 66)
    add("  THE GUARANTEE   (slide 12)")
    add("-" * 66)
    add("")
    add("    success rate  >=  ln(1+G)/G * best expert  -  ln(E)/(D*G)")
    add("")
    add(f"  guaranteed at least  {run.guarantee:>7.1%}")
    add(f"  actually achieved    {run.follow_i_rate:>7.1%}")
    verdict = "HOLDS" if run.follow_i_rate >= run.guarantee else "VIOLATED -- investigate"
    add(f"  {verdict}")
    if run.guarantee < 0:
        add("")
        add("  The bound is negative, so it promises nothing here: with this few")
        add("  questions the ln(E)/(D*G) term still swamps it. Say so out loud --")
        add("  the algorithm can beat its guarantee long before the guarantee")
        add("  becomes worth quoting.")
    add("")
    if sim:
        add("-" * 66)
        add("  IF YOU ACTUALLY PLAYED IT   (the rate above is an expectation)")
        add("-" * 66)
        add("")
        add(f"  median outcome       {sim['p50']:>7.1%}")
        add(f"  90% of the time      {sim['p05']:.1%} to {sim['p95']:.1%}")
        add("")
    add("-" * 66)
    add("  TOP OF THE LEADERBOARD")
    add("-" * 66)
    add("")
    add(f"  {'expert':<24}{'weight':>9}{'right':>10}{'rate':>9}")
    for s in run.expert_stats[:10]:
        rate = f"{s.rate_over_all_rounds:.0%}"
        add(f"  {s.pseudonym[:23]:<24}{s.final_weight_share:>8.1%}"
            f"{f'{s.correct}/{s.answered}':>10}{rate:>9}")
    add("")

    if report.warnings or run.skipped:
        add("-" * 66)
        add("  NOTES")
        add("-" * 66)
        add("")
        for note in report.warnings:
            add(f"  - {note}")
        for note in run.skipped:
            add(f"  - {note}")
        add("")

    if run.manual_participation < 0.9:
        add(f"  Manual participation is {run.manual_participation:.0%}. The rest were filled")
        add("  in with a random 50/50 pick on the absent expert's behalf (see")
        add("  manual_voters / manual_answered in rounds.csv / experts.csv). Re-run")
        add("  with --min-participation 0.8 to confirm the story holds on the")
        add("  students who actually showed up.")
        add("")

    return "\n".join(L)


def main(argv=None) -> int:
    args = parse_args(argv)
    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)

    try:
        rounds, experts, report = load_votes(
            args.csv, min_participation=args.min_participation, fill_seed=args.fill_seed
        )
    except (ValueError, FileNotFoundError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    try:
        run = run_expert_algorithm(
            rounds, growth_rate=args.growth_rate, experts=experts, tie_break=args.tie_break
        )
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    if run.n_rounds == 0:
        print("error: no usable rounds after filtering", file=sys.stderr)
        return 1

    sim = simulate_follow_i(run, n_trials=args.trials, seed=args.seed) if args.trials else None

    summary = build_summary(run, report, sim, args)
    print(summary)
    (outdir / "summary.txt").write_text(summary, encoding="utf-8")

    write_rounds_csv(run, outdir / "rounds.csv")
    write_experts_csv(run, outdir / "experts.csv")
    written = ["summary.txt", "rounds.csv", "experts.csv"]

    if not args.no_plots:
        theme = plots.DARK if args.dark else plots.LIGHT
        plots.plot_daily_rates(run, outdir / "daily_rates.png", theme)
        plots.plot_cumulative_rates(run, outdir / "cumulative_rates.png", theme)
        plots.plot_weight_trajectories(run, outdir / "weights.png", args.top, theme)
        plots.plot_leaderboard(run, outdir / "leaderboard.png", theme=theme)
        written += ["daily_rates.png", "cumulative_rates.png", "weights.png", "leaderboard.png"]

        if args.sweep:
            grid = [round(0.01 + i * (args.sweep_max - 0.01) / 79, 4) for i in range(80)]
            sweep = sweep_growth_rate(rounds, grid, experts=experts, tie_break=args.tie_break)
            plots.plot_growth_sweep(sweep, outdir / "growth_sweep.png", theme)
            written.append("growth_sweep.png")

            best_g, best_rate, _ = max(sweep, key=lambda t: t[1])
            print(f"  best empirical G = {best_g:.0%}  ->  {best_rate:.1%}\n")

    print(f"wrote {len(written)} file(s) to {outdir.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
