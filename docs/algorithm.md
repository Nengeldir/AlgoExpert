# Expert Algorithm (Weighted Majority)

## What it is

The Expert Algorithm (also called the **Weighted Majority Algorithm**) is an online learning method where a set of "experts" (here: students) make binary predictions each round, and a learner aggregates their predictions using weights that evolve over time.

**Reference**: Littlestone & Warmuth (1994), "The Weighted Majority Algorithm", *Information and Computation*.
The course handout (Bernd's slides) contains the specific variant used in this course.

## How it works

1. Each student starts with weight `w_i = 1`.
2. Before each question resolves, the aggregated prediction is the **weighted majority vote**:
   - `prediction = A` if `Σ w_i [vote_i = A] ≥ Σ w_i [vote_i = B]`
3. After the ground truth is revealed:
   - Students who voted **wrong** have their weight multiplied by a penalty factor `β ∈ (0, 1)` (e.g., `β = 0.5`).
   - Students who voted **correctly** keep their weight unchanged.
4. Repeat for the next question.

The algorithm guarantees that its total number of mistakes is not much worse than the best individual expert, even without knowing in advance which expert is best.

## Why we hide individual votes

The app deliberately **does not show other users' votes or rankings** until the live lecture session. This is essential because:

- If students can see each other's votes, they may herd (copy the crowd), destroying the **diversity** of predictions.
- The algorithm's power comes from aggregating **independent, heterogeneous** beliefs.
- Weights are revealed only during the live analysis — this is the dramatic moment of the lecture.

## How app data flows into the analysis

```
GET /admin/export?format=csv
      │
      ▼  columns: pseudonym, question_title, option_a, option_b,
                  ground_truth, user_vote, is_correct, voted_at
      │
      ▼
analysis/weighted_majority.ipynb  (or R script)
      │
      ▼
For each round t = 1..T:
  - Read votes and ground_truth from CSV
  - Compute weighted majority prediction
  - Update weights: w_i *= β  if user_vote[i] ≠ ground_truth
      │
      ▼
Plot: weight evolution, mistake counts, algorithm vs. best expert
```

A sample Python snippet:

```python
import pandas as pd

df = pd.read_csv('votes.csv')
beta = 0.5

users = df['pseudonym'].unique()
weights = {u: 1.0 for u in users}

for question_title, group in df.groupby('question_title'):
    # Weighted majority vote
    w_a = sum(weights[r.pseudonym] for _, r in group.iterrows() if r.user_vote == 'A')
    w_b = sum(weights[r.pseudonym] for _, r in group.iterrows() if r.user_vote == 'B')
    algo_prediction = 'A' if w_a >= w_b else 'B'
    ground_truth = group['ground_truth'].iloc[0]

    print(f"{question_title}: algo={algo_prediction}, truth={ground_truth}")

    # Update weights
    for _, row in group.iterrows():
        if row.user_vote != ground_truth:
            weights[row.pseudonym] *= beta
```

## Policy for missing votes

Students who did **not** vote on a question (deadline passed without a vote) are treated as **abstaining**:
- Their weight is **not penalized** for the missed round.
- They contribute zero weight to the aggregated prediction for that round.
- The CSV export will have no row for them on that question — the analysis script must handle sparse data.

**Rationale**: Penalizing absence would distort weights based on participation rather than prediction quality. A student who only votes when confident should not be punished for selective participation.

This is consistent with the "sleeping expert" variant of the algorithm, where experts can abstain.
