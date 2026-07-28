"""Turn `GET /admin/export?format=csv` into rounds the algorithm can chew on."""

from __future__ import annotations

import warnings
from dataclasses import dataclass

import pandas as pd

from expert_algorithm import Round

REQUIRED = ["pseudonym", "ground_truth", "user_vote"]
VALID_CHOICES = {"A", "B"}


@dataclass
class LoadReport:
    n_rows_raw: int
    n_rows_used: int
    n_rounds: int
    n_experts: int
    dropped_unresolved: int
    dropped_bad_choice: int
    dropped_duplicate: int
    ordering: str
    warnings: list[str]


def load_votes(
    path: str,
    min_participation: float = 0.0,
) -> tuple[list[Round], list[str], LoadReport]:
    """Read the export CSV and return (rounds, experts, report).

    `min_participation` keeps only experts who answered at least that fraction
    of the resolved questions -- use it for the robustness pass where every
    expert is close to fully present.
    """
    df = pd.read_csv(path, dtype=str, keep_default_na=False)
    n_raw = len(df)
    notes: list[str] = []

    missing = [c for c in REQUIRED if c not in df.columns]
    if missing:
        raise ValueError(f"CSV is missing required column(s): {', '.join(missing)}")

    for col in df.columns:
        df[col] = df[col].str.strip()

    # --- keep only resolved questions with usable votes ---------------------
    before = len(df)
    df = df[df["ground_truth"].isin(VALID_CHOICES)]
    dropped_unresolved = before - len(df)
    if dropped_unresolved:
        notes.append(
            f"dropped {dropped_unresolved} row(s) on unresolved questions "
            "(no ground truth yet)"
        )

    before = len(df)
    df = df[df["user_vote"].isin(VALID_CHOICES)]
    dropped_bad = before - len(df)
    if dropped_bad:
        notes.append(f"dropped {dropped_bad} row(s) with a vote that was not A or B")

    if df.empty:
        raise ValueError("no resolved votes left after filtering -- nothing to analyse")

    # --- identify and order the rounds --------------------------------------
    group_key = "question_id" if "question_id" in df.columns else "question_title"
    if group_key == "question_title":
        notes.append(
            "CSV has no question_id column; grouping by question_title. "
            "Titles are not guaranteed unique -- re-export from a backend that "
            "includes question_id."
        )

    if "deadline" in df.columns and df["deadline"].ne("").all():
        order_col, ordering = "deadline", "deadline"
    elif "question_id" in df.columns:
        order_col, ordering = "question_id", "question_id"
        notes.append("no deadline column; ordering rounds by question_id")
    elif "voted_at" in df.columns:
        order_col, ordering = "voted_at", "first vote timestamp (approximate)"
        warnings.warn(
            "Ordering rounds by earliest vote timestamp. This is a guess. "
            "Re-export with question_id and deadline for a reliable ordering.",
            stacklevel=2,
        )
        notes.append(
            "ordered rounds by earliest vote timestamp -- APPROXIMATE, verify the "
            "round order in the per-round table before trusting weight trajectories"
        )
    else:
        raise ValueError(
            "cannot establish round order: CSV has no deadline, question_id or voted_at"
        )

    # question_id sorts as a string here; pad numerics so 10 lands after 9.
    sort_series = df[order_col]
    if order_col == "question_id" and sort_series.str.fullmatch(r"\d+").all():
        sort_key = sort_series.astype(int)
    else:
        sort_key = sort_series
    df = df.assign(_sort=sort_key).sort_values(["_sort", group_key], kind="stable")

    # --- one vote per expert per round --------------------------------------
    before = len(df)
    df = df.drop_duplicates(subset=[group_key, "pseudonym"], keep="last")
    dropped_dupes = before - len(df)
    if dropped_dupes:
        notes.append(
            f"dropped {dropped_dupes} duplicate (question, pseudonym) row(s), kept the last"
        )

    # --- optional participation filter --------------------------------------
    n_rounds_total = df[group_key].nunique()
    experts = sorted(df["pseudonym"].unique())

    if min_participation > 0:
        counts = df.groupby("pseudonym")[group_key].nunique()
        keep = counts[counts >= min_participation * n_rounds_total].index
        removed = sorted(set(experts) - set(keep))
        if removed:
            notes.append(
                f"participation filter (>={min_participation:.0%}) removed "
                f"{len(removed)} of {len(experts)} experts"
            )
        df = df[df["pseudonym"].isin(keep)]
        experts = sorted(keep)
        if df.empty:
            raise ValueError(
                f"participation filter >={min_participation:.0%} removed every expert"
            )

    # --- build rounds --------------------------------------------------------
    rounds: list[Round] = []
    for qid, g in df.groupby(group_key, sort=False):
        truths = set(g["ground_truth"])
        if len(truths) > 1:
            notes.append(f"question {qid!r} has conflicting ground truths {truths}; skipped")
            continue
        label = g["question_title"].iloc[0] if "question_title" in g.columns else str(qid)
        rounds.append(
            Round(
                question_id=str(qid),
                label=str(label) or str(qid),
                truth=truths.pop(),
                votes=dict(zip(g["pseudonym"], g["user_vote"])),
            )
        )

    report = LoadReport(
        n_rows_raw=n_raw,
        n_rows_used=len(df),
        n_rounds=len(rounds),
        n_experts=len(experts),
        dropped_unresolved=dropped_unresolved,
        dropped_bad_choice=dropped_bad,
        dropped_duplicate=dropped_dupes,
        ordering=ordering,
        warnings=notes,
    )
    return rounds, experts, report
