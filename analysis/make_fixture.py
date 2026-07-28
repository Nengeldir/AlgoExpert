"""Regenerate fixture_slides.csv -- the worked example from the lecture slides.

Transcribed from the final table on slide 4 (the "Weighted Approach" page,
after all 8 days are filled in). Up-arrow is option A, down-arrow is option B.

Run: python make_fixture.py
"""

from __future__ import annotations

import csv
from pathlib import Path

# Day:                1    2    3    4    5    6    7    8
TRUTH = "AAABABBA"

EXPERTS = {
    "Expert 1": "AABAAABB",
    "Expert 2": "BABABBAB",
    "Expert 3": "BBAAAAAB",
    "Expert 4": "ABABABBA",
    "Expert 5": "ABBBBABA",
    "Expert 6": "ABAABBAB",
    "Expert 7": "BABABBBA",
}

OUT = Path(__file__).parent / "fixture_slides.csv"


def main() -> None:
    rows = []
    for day in range(8):
        truth = TRUTH[day]
        for expert, votes in EXPERTS.items():
            vote = votes[day]
            rows.append(
                {
                    "question_id": day + 1,
                    "deadline": f"2026-03-{day + 2:02d}T17:30:00.000Z",
                    "pseudonym": expert,
                    "question_title": f"Day {day + 1}: will the SMI close up or down?",
                    "option_a": "Up",
                    "option_b": "Down",
                    "ground_truth": truth,
                    "user_vote": vote,
                    "is_correct": int(vote == truth),
                    "voted_at": f"2026-03-{day + 2:02d}T08:15:00.000Z",
                }
            )

    with OUT.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(rows[0]), quoting=csv.QUOTE_ALL)
        writer.writeheader()
        writer.writerows(rows)

    print(f"wrote {len(rows)} rows to {OUT}")


if __name__ == "__main__":
    main()
