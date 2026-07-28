"""Pin the implementation to the worked example in the lecture slides.

Every expected number below is read straight off the slides, not off our own
output. If these pass, the update ordering and the p_t definition are right.

Run: python test_expert_algorithm.py     (or: pytest analysis)
"""

from __future__ import annotations

import math
from pathlib import Path

from expert_algorithm import (
    Round,
    guarantee_bound,
    run_expert_algorithm,
    simulate_follow_i,
    sweep_growth_rate,
)
from loader import load_votes

FIXTURE = Path(__file__).parent / "fixture_slides.csv"
CLOSE = 1e-9


def approx(a: float, b: float, tol: float = 1e-6) -> bool:
    return abs(a - b) <= tol


def slides_run():
    rounds, experts, _ = load_votes(str(FIXTURE))
    return run_expert_algorithm(rounds, growth_rate=1.0, experts=experts)


# ---------------------------------------------------------------------------


def test_fixture_shape():
    rounds, experts, report = load_votes(str(FIXTURE))
    assert len(rounds) == 8, "slides run for 8 days"
    assert len(experts) == 7, "slides have 7 experts"
    assert report.ordering == "deadline"
    assert report.n_rows_used == 56


def test_daily_success_rates_match_slide_4():
    """p_t = 57%, 36%, 33%, 30%, 54%, 60%, 75%, 71%."""
    run = slides_run()
    expected = [4 / 7, 4 / 11, 5 / 15, 6 / 20, 14 / 26, 24 / 40, 48 / 64, 80 / 112]
    got = [r.p for r in run.rounds]
    for i, (g, e) in enumerate(zip(got, expected), 1):
        assert approx(g, e, CLOSE), f"day {i}: p={g:.4f}, slides say {e:.4f}"


def test_total_weight_matches_slide_6():
    """W = 7, 11, 15, 20, 26, 40, 64, 112, 192.

    We renormalise weights every round, so reconstruct the slides' running
    total from the growth factors: W_{t+1} = W_t * (1 + G * p_t). That this
    lands exactly on 192 is the whole "fancy inequality" chain.
    """
    run = slides_run()
    expected = [7, 11, 15, 20, 26, 40, 64, 112, 192]

    w = float(run.n_experts)
    got = [w]
    for r in run.rounds:
        w *= 1 + run.growth_rate * r.p
        got.append(w)

    for i, (g, e) in enumerate(zip(got, expected)):
        assert approx(g, e, 1e-6), f"W after day {i}: {g:.4f}, slides say {e}"


def test_overall_follow_i_rate_is_52_1_percent():
    run = slides_run()
    assert approx(run.follow_i_rate, 0.521393, 1e-5), run.follow_i_rate
    assert f"{run.follow_i_rate:.1%}" == "52.1%"


def test_majority_rate_is_37_5_percent():
    """Slide 5: the Majority straw man manages only 37.5%."""
    run = slides_run()
    assert approx(run.unweighted_majority_rate, 0.375, CLOSE)


def test_best_expert_is_expert_4_at_87_5_percent():
    run = slides_run()
    assert approx(run.best_expert_rate, 0.875, CLOSE)
    best = max(run.expert_stats, key=lambda s: s.rate_over_all_rounds)
    assert best.pseudonym == "Expert 4"


def test_every_expert_rate_matches_slide_36():
    expected = {
        "Expert 1": 0.500,
        "Expert 2": 0.250,
        "Expert 3": 0.250,
        "Expert 4": 0.875,
        "Expert 5": 0.500,
        "Expert 6": 0.375,
        "Expert 7": 0.500,
    }
    run = slides_run()
    for s in run.expert_stats:
        assert approx(s.rate_over_all_rounds, expected[s.pseudonym], CLOSE), s


def test_final_weight_shares_match_slide_4():
    """Final column: Expert 4 ends on 128/192 = 66.7% of all the weight."""
    run = slides_run()
    expected = {
        "Expert 1": 16 / 192,
        "Expert 2": 4 / 192,
        "Expert 3": 4 / 192,
        "Expert 4": 128 / 192,
        "Expert 5": 16 / 192,
        "Expert 6": 8 / 192,
        "Expert 7": 16 / 192,
    }
    for name, share in expected.items():
        assert approx(run.final_weights[name], share, 1e-9), name
    assert approx(sum(run.final_weights.values()), 1.0, 1e-9)


def test_follow_i_beats_majority_but_not_best_expert():
    """Slide 5's conclusion, stated as an ordering."""
    run = slides_run()
    assert run.unweighted_majority_rate < run.follow_i_rate < run.best_expert_rate


def test_guarantee_holds_on_the_fixture():
    run = slides_run()
    assert run.follow_i_rate >= run.guarantee, (run.follow_i_rate, run.guarantee)


def test_guarantee_bound_constants_match_slide_12():
    """ln(1+G)/G is 0.693 / 0.953 / 0.995 at G = 100% / 10% / 1%."""
    for g, expected in [(1.0, 0.693), (0.10, 0.953), (0.01, 0.995)]:
        got = math.log(1 + g) / g
        assert approx(got, expected, 5e-4), (g, got, expected)

    # With E=1 the ln(E)/DG penalty vanishes and only the fraction survives.
    assert approx(guarantee_bound(1.0, 1.0, n_experts=1, n_rounds=10), math.log(2), CLOSE)


def test_smaller_G_raises_the_bound_once_D_is_large():
    """Slide 12, first half: the achievable fraction ln(1+G)/G rises as G falls
    (69% -> 95% -> 99%), so with enough days a smaller G promises more."""
    big_d = dict(best_expert_rate=0.9, n_experts=7, n_rounds=5000)
    assert (
        guarantee_bound(0.01, **big_d)
        > guarantee_bound(0.10, **big_d)
        > guarantee_bound(1.00, **big_d)
    )


def test_smaller_G_hurts_the_bound_when_D_is_small():
    """Slide 12, second half: the price is the ln(E)/DG "performance killer".
    Over a handful of questions a small G is actively bad."""
    small_d = dict(best_expert_rate=0.9, n_experts=7, n_rounds=12)
    assert guarantee_bound(0.01, **small_d) < guarantee_bound(1.00, **small_d)


def test_empirical_optimum_need_not_match_the_bound_optimum():
    """Worth knowing before you quote a G in the lecture: the bound is
    worst-case over all possible expert behaviour. When the best expert is
    obvious, a large G finds them faster than the bound gives it credit for,
    so the two curves peak in different places. `run.py --sweep` plots both.
    """
    rounds = [
        Round(str(i), f"q{i}", "A", {"Oracle": "A", "Noise": "A" if i % 2 else "B"})
        for i in range(400)
    ]
    coarse = run_expert_algorithm(rounds, growth_rate=1.0)
    fine = run_expert_algorithm(rounds, growth_rate=0.10)

    assert coarse.follow_i_rate > fine.follow_i_rate  # empirical prefers big G
    assert coarse.guarantee < fine.guarantee  # the bound prefers small G
    for run in (coarse, fine):
        assert run.follow_i_rate >= run.guarantee  # both still honour it


# ---------------------------------------------------------------------------
# behaviour that the slides do not cover but our data needs
# ---------------------------------------------------------------------------


def test_absent_experts_are_neither_penalised_nor_counted():
    rounds = [
        Round("1", "q1", "A", {"Present": "A", "Absent": "B"}),
        Round("2", "q2", "A", {"Present": "B"}),  # Absent sits this one out
    ]
    run = run_expert_algorithm(rounds, growth_rate=1.0)

    # Round 2: only Present votes, and they are wrong, so p must be 0 --
    # not 0.5, which is what would happen if Absent's weight leaked in.
    assert approx(run.rounds[1].p, 0.0, CLOSE)
    assert run.rounds[1].n_voters == 1

    absent = next(s for s in run.expert_stats if s.pseudonym == "Absent")
    assert absent.answered == 1
    assert absent.rate_over_all_rounds == 0.0  # 0 correct / 2 rounds
    assert absent.rate_over_answered == 0.0


def test_rate_over_answered_ignores_absences():
    rounds = [
        Round("1", "q1", "A", {"Selective": "A", "Always": "A"}),
        Round("2", "q2", "A", {"Always": "B"}),
    ]
    run = run_expert_algorithm(rounds, growth_rate=1.0)
    selective = next(s for s in run.expert_stats if s.pseudonym == "Selective")
    assert selective.rate_over_all_rounds == 0.5  # 1 correct / 2 rounds
    assert selective.rate_over_answered == 1.0  # 1 correct / 1 answered


def test_weights_survive_many_rounds_without_overflow():
    """(1+G)^D overflows float64 near D=1024 if you never renormalise."""
    rounds = [
        Round(str(i), f"q{i}", "A", {"Steady": "A", "Wrong": "B"}) for i in range(5000)
    ]
    run = run_expert_algorithm(rounds, growth_rate=1.0)
    assert math.isfinite(run.final_weights["Steady"])
    assert approx(sum(run.final_weights.values()), 1.0, 1e-9)
    assert run.follow_i_rate > 0.99


def test_tie_break_is_explicit_and_respected():
    rounds = [Round("1", "q1", "B", {"X": "A", "Y": "B"})]
    assert run_expert_algorithm(rounds, 1.0, tie_break="A").rounds[0].weighted_majority == "A"
    assert run_expert_algorithm(rounds, 1.0, tie_break="B").rounds[0].weighted_majority == "B"


def test_round_with_no_voters_is_skipped_not_crashed():
    rounds = [
        Round("1", "q1", "A", {"X": "A"}),
        Round("2", "nobody voted", "A", {}),
    ]
    run = run_expert_algorithm(rounds, growth_rate=1.0)
    assert run.n_rounds == 1
    assert len(run.skipped) == 1


def test_non_positive_growth_rate_is_rejected():
    rounds = [Round("1", "q1", "A", {"X": "A"})]
    for bad in (0.0, -0.5):
        try:
            run_expert_algorithm(rounds, growth_rate=bad)
        except ValueError:
            continue
        raise AssertionError(f"G={bad} should have been rejected")


def test_sweep_returns_one_row_per_growth_rate():
    rounds, experts, _ = load_votes(str(FIXTURE))
    grid = [0.05, 0.5, 1.0, 2.0]
    out = sweep_growth_rate(rounds, grid, experts=experts)
    assert [g for g, _, _ in out] == grid
    for g, empirical, bound in out:
        assert empirical >= bound, f"guarantee violated at G={g}"


def test_simulation_centres_on_the_expected_rate():
    run = slides_run()
    sim = simulate_follow_i(run, n_trials=4000, seed=7)
    assert approx(sim["mean"], run.follow_i_rate, 0.02)
    assert sim["p05"] < sim["p50"] < sim["p95"]


def test_simulation_is_reproducible():
    run = slides_run()
    assert simulate_follow_i(run, 500, seed=3) == simulate_follow_i(run, 500, seed=3)


# ---------------------------------------------------------------------------
# loader
# ---------------------------------------------------------------------------


def test_rounds_are_ordered_chronologically_not_alphabetically(tmp_path=None):
    """The trap: pandas groupby sorts by key, so 'Day 10' lands before 'Day 2'."""
    import tempfile

    csv = (
        "question_id,deadline,pseudonym,question_title,ground_truth,user_vote\n"
        "2,2026-03-02T00:00:00Z,Ann,Day 2,A,A\n"
        "10,2026-03-10T00:00:00Z,Ann,Day 10,B,B\n"
        "1,2026-03-01T00:00:00Z,Ann,Day 1,A,A\n"
    )
    with tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False) as fh:
        fh.write(csv)
        path = fh.name

    rounds, _, report = load_votes(path)
    assert [r.label for r in rounds] == ["Day 1", "Day 2", "Day 10"]
    assert report.ordering == "deadline"


def test_unresolved_questions_are_dropped():
    import tempfile

    csv = (
        "question_id,deadline,pseudonym,question_title,ground_truth,user_vote\n"
        "1,2026-03-01T00:00:00Z,Ann,Day 1,A,A\n"
        "2,2026-03-02T00:00:00Z,Ann,Day 2,,B\n"
    )
    with tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False) as fh:
        fh.write(csv)
        path = fh.name

    rounds, _, report = load_votes(path)
    assert len(rounds) == 1
    assert report.dropped_unresolved == 1


def test_participation_filter_drops_sparse_experts():
    rounds, experts, report = load_votes(str(FIXTURE), min_participation=0.8)
    assert len(experts) == 7  # everyone in the fixture is fully present
    assert report.n_experts == 7


# ---------------------------------------------------------------------------


def main() -> int:
    tests = [(n, f) for n, f in sorted(globals().items()) if n.startswith("test_")]
    failures = []
    for name, fn in tests:
        try:
            fn()
        except Exception as exc:  # noqa: BLE001 - this is the test runner
            failures.append((name, exc))
            print(f"FAIL  {name}\n        {type(exc).__name__}: {exc}")
        else:
            print(f"ok    {name}")

    print(f"\n{len(tests) - len(failures)}/{len(tests)} passed")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
