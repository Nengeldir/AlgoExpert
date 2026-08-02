"""Core of the Expert Algorithm exactly as presented in the lecture slides.

Slides: "Advanced Lecture: Learning from Experts", Bernd Gaertner, ETH Zuerich.

The learner is "Follow i": every round it picks expert i with probability
w_i / W and copies that expert's prediction. Its daily success rate p_t is
therefore the probability of being right, i.e. the share of the weight that
sits on the correct answer. Experts who were right get their weight grown by
the growth rate G (slides use G = 1, "double the weights of the experts that
got it right").

Everything in this module is pure: no file I/O, no plotting, no printing.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, field

Choice = str  # "A" or "B"


@dataclass(frozen=True)
class Round:
    """One question, after it has been resolved."""

    question_id: str
    label: str
    truth: Choice
    votes: dict[str, Choice]  # pseudonym -> "A" | "B"; absentees simply absent
    # pseudonym -> True if this was a real cast vote, False if filled in on the
    # expert's behalf (e.g. loader.py's 50/50 coin flip for a non-voter).
    # A pseudonym missing from this dict is assumed manual, so hand-built
    # Round()s in tests and scripts don't need to care about it.
    manual: dict[str, bool] = field(default_factory=dict)


@dataclass(frozen=True)
class RoundResult:
    """Everything observable about a single round."""

    index: int  # 1-based, chronological
    question_id: str
    label: str
    truth: Choice

    n_voters: int
    n_manual: int  # of n_voters, how many actually cast a vote (rest were filled)
    weight_participating: float  # W_t, restricted to those who voted
    weight_correct: float  # C_t

    p: float  # Follow-i success rate this round = C_t / W_t

    weighted_majority: Choice
    weighted_majority_correct: bool
    unweighted_majority: Choice
    unweighted_majority_correct: bool

    # Weight shares entering the round, over *all* experts (sums to 1).
    weight_shares: dict[str, float]


@dataclass(frozen=True)
class ExpertStats:
    pseudonym: str
    answered: int
    manual_answered: int  # of `answered`, how many were real votes (not filled)
    correct: int
    rate_over_all_rounds: float  # correct / D   <- the slides' definition
    rate_over_answered: float  # correct / answered
    final_weight_share: float


@dataclass
class Run:
    """Result of running the algorithm over all rounds at one growth rate."""

    growth_rate: float
    rounds: list[RoundResult]
    experts: list[str]
    final_weights: dict[str, float]
    expert_stats: list[ExpertStats]
    skipped: list[str] = field(default_factory=list)

    # ---- headline metrics -------------------------------------------------

    @property
    def n_rounds(self) -> int:
        return len(self.rounds)

    @property
    def n_experts(self) -> int:
        return len(self.experts)

    @property
    def follow_i_rate(self) -> float:
        """Overall success rate of "Follow i" = average of the daily rates."""
        return _mean(r.p for r in self.rounds)

    @property
    def weighted_majority_rate(self) -> float:
        return _mean(float(r.weighted_majority_correct) for r in self.rounds)

    @property
    def unweighted_majority_rate(self) -> float:
        """The slide-3 straw man: plain majority of the experts."""
        return _mean(float(r.unweighted_majority_correct) for r in self.rounds)

    @property
    def best_expert_rate(self) -> float:
        """Best expert in hindsight, correct / D (absences count against)."""
        return max((e.rate_over_all_rounds for e in self.expert_stats), default=0.0)

    @property
    def best_expert_rate_over_answered(self) -> float:
        """Best expert counting only rounds they actually answered."""
        return max((e.rate_over_answered for e in self.expert_stats), default=0.0)

    @property
    def mean_expert_rate(self) -> float:
        return _mean(e.rate_over_all_rounds for e in self.expert_stats)

    @property
    def median_expert_rate(self) -> float:
        rates = sorted(e.rate_over_all_rounds for e in self.expert_stats)
        if not rates:
            return 0.0
        mid = len(rates) // 2
        if len(rates) % 2:
            return rates[mid]
        return (rates[mid - 1] + rates[mid]) / 2

    @property
    def guarantee(self) -> float:
        """The slides' bound (slide 12):

            ln(1+G)/G * best expert's success rate  -  ln(E)/(D*G)

        Follow-i's overall success rate must come out at or above this.
        """
        return guarantee_bound(
            growth_rate=self.growth_rate,
            best_expert_rate=self.best_expert_rate,
            n_experts=self.n_experts,
            n_rounds=self.n_rounds,
        )

    @property
    def participation(self) -> float:
        """Fraction of (expert, round) cells that carry a vote, manual or filled.

        With loader.py's fill-in policy this is normally 100%: every known
        expert gets *some* vote every round, real or a 50/50 coin flip. Use
        `manual_participation` for the number that reflects actual engagement.
        """
        cells = self.n_experts * self.n_rounds
        if cells == 0:
            return 0.0
        return sum(r.n_voters for r in self.rounds) / cells

    @property
    def manual_participation(self) -> float:
        """Fraction of (expert, round) cells that carry a real, cast vote."""
        cells = self.n_experts * self.n_rounds
        if cells == 0:
            return 0.0
        return sum(r.n_manual for r in self.rounds) / cells


# ---------------------------------------------------------------------------
# The algorithm
# ---------------------------------------------------------------------------


def run_expert_algorithm(
    rounds: list[Round],
    growth_rate: float,
    experts: list[str] | None = None,
    tie_break: Choice = "A",
) -> Run:
    """Run "Follow i" over `rounds` at growth rate G.

    Weights start at 1 for everybody and are renormalised to sum to 1 after
    each round. Renormalising changes nothing that matters -- every quantity
    the algorithm reads is a ratio of weights -- but it keeps (1+G)^D from
    overflowing and makes the stored weights directly plottable as shares.

    Absentees (the "sleeping expert" case): an expert with no vote in a round
    contributes no weight to that round and has their weight left untouched.
    W_t is the weight of the *participants only*, so p_t stays an honest
    probability even when half the class skipped the question. This only
    matters if you hand-build `Round`s with gaps -- loader.py's normal
    pipeline fills every gap with a random 50/50 pick before it gets here, so
    there are no true absentees left; `Round.manual` records which votes were
    real so the fills can still be told apart afterwards.
    """
    if growth_rate <= 0:
        raise ValueError(f"growth rate G must be positive, got {growth_rate}")
    if tie_break not in ("A", "B"):
        raise ValueError(f"tie_break must be 'A' or 'B', got {tie_break!r}")

    if experts is None:
        experts = sorted({p for r in rounds for p in r.votes})
    else:
        experts = sorted(set(experts))

    if not experts:
        raise ValueError("no experts to run over")

    weights = {e: 1.0 / len(experts) for e in experts}
    known = set(experts)

    results: list[RoundResult] = []
    skipped: list[str] = []
    answered = {e: 0 for e in experts}
    manual_answered = {e: 0 for e in experts}
    correct_count = {e: 0 for e in experts}

    for rnd in rounds:
        votes = {p: c for p, c in rnd.votes.items() if p in known}
        if not votes:
            skipped.append(f"round {rnd.label!r}: no votes from the expert pool")
            continue

        w_participating = sum(weights[p] for p in votes)
        if w_participating <= 0:
            skipped.append(f"round {rnd.label!r}: participating weight collapsed to zero")
            continue

        w_correct = sum(weights[p] for p, c in votes.items() if c == rnd.truth)
        w_a = sum(weights[p] for p, c in votes.items() if c == "A")
        w_b = w_participating - w_a

        n_a = sum(1 for c in votes.values() if c == "A")
        n_b = len(votes) - n_a
        n_manual = sum(1 for p in votes if rnd.manual.get(p, True))

        weighted_majority = _argmax_choice(w_a, w_b, tie_break)
        unweighted_majority = _argmax_choice(n_a, n_b, tie_break)

        results.append(
            RoundResult(
                index=len(results) + 1,
                question_id=rnd.question_id,
                label=rnd.label,
                truth=rnd.truth,
                n_voters=len(votes),
                n_manual=n_manual,
                weight_participating=w_participating,
                weight_correct=w_correct,
                # p_t uses the weights *entering* the round, before the update.
                p=w_correct / w_participating,
                weighted_majority=weighted_majority,
                weighted_majority_correct=weighted_majority == rnd.truth,
                unweighted_majority=unweighted_majority,
                unweighted_majority_correct=unweighted_majority == rnd.truth,
                weight_shares=dict(weights),
            )
        )

        for p, c in votes.items():
            answered[p] += 1
            if rnd.manual.get(p, True):
                manual_answered[p] += 1
            if c == rnd.truth:
                correct_count[p] += 1
                weights[p] *= 1 + growth_rate

        total = sum(weights.values())
        if total > 0:
            weights = {e: w / total for e, w in weights.items()}

    n_rounds = len(results)
    stats = [
        ExpertStats(
            pseudonym=e,
            answered=answered[e],
            manual_answered=manual_answered[e],
            correct=correct_count[e],
            rate_over_all_rounds=correct_count[e] / n_rounds if n_rounds else 0.0,
            rate_over_answered=correct_count[e] / answered[e] if answered[e] else 0.0,
            final_weight_share=weights[e],
        )
        for e in experts
    ]
    stats.sort(key=lambda s: (-s.final_weight_share, s.pseudonym))

    return Run(
        growth_rate=growth_rate,
        rounds=results,
        experts=experts,
        final_weights=weights,
        expert_stats=stats,
        skipped=skipped,
    )


def guarantee_bound(
    growth_rate: float,
    best_expert_rate: float,
    n_experts: int,
    n_rounds: int,
) -> float:
    """Slide 12: ln(1+G)/G * best_rate - ln(E)/(D*G)."""
    if n_rounds == 0 or growth_rate <= 0:
        return float("-inf")
    fraction = math.log(1 + growth_rate) / growth_rate
    penalty = math.log(n_experts) / (n_rounds * growth_rate)
    return fraction * best_expert_rate - penalty


def sweep_growth_rate(
    rounds: list[Round],
    growth_rates: list[float],
    experts: list[str] | None = None,
    tie_break: Choice = "A",
) -> list[tuple[float, float, float]]:
    """Re-run the algorithm at each G.

    Returns (G, empirical Follow-i rate, theoretical bound) triples. The two
    curves peak in different places -- the bound is worst-case over all
    possible expert behaviour, the empirical curve is what this cohort
    actually did.
    """
    out = []
    for g in growth_rates:
        run = run_expert_algorithm(rounds, g, experts=experts, tie_break=tie_break)
        out.append((g, run.follow_i_rate, run.guarantee))
    return out


def simulate_follow_i(run: Run, n_trials: int = 10_000, seed: int = 0) -> dict[str, float]:
    """Actually draw an expert each round, instead of taking expectations.

    `follow_i_rate` is the expected success rate and is the number the slides
    quote. This simulates the realised rate so you can show the spread: a
    single run of the algorithm is a coin-flippy thing, and the class will ask.
    """
    if not run.rounds:
        return {"mean": 0.0, "p05": 0.0, "p50": 0.0, "p95": 0.0}

    rng = random.Random(seed)
    probs = [r.p for r in run.rounds]
    outcomes: list[float] = []

    for _ in range(n_trials):
        # Drawing an expert and checking their answer is the same coin flip as
        # drawing directly against p_t, since p_t *is* the weight on the truth.
        hits = sum(1 for p in probs if rng.random() < p)
        outcomes.append(hits / len(probs))

    outcomes.sort()
    return {
        "mean": _mean(outcomes),
        "p05": _quantile(outcomes, 0.05),
        "p50": _quantile(outcomes, 0.50),
        "p95": _quantile(outcomes, 0.95),
    }


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _argmax_choice(a: float, b: float, tie_break: Choice) -> Choice:
    if a > b:
        return "A"
    if b > a:
        return "B"
    return tie_break


def _mean(values) -> float:
    vals = list(values)
    return sum(vals) / len(vals) if vals else 0.0


def _quantile(sorted_values: list[float], q: float) -> float:
    if not sorted_values:
        return 0.0
    idx = min(len(sorted_values) - 1, max(0, int(round(q * (len(sorted_values) - 1)))))
    return sorted_values[idx]
