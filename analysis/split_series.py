"""Split the Expert Vote export into one CSV per question series (SMI / YouTube)."""
import sys
import pandas as pd

src = sys.argv[1]
df = pd.read_csv(src, dtype=str, keep_default_na=False, encoding="utf-8")
smi = df[df["question_title"].str.startswith("SMI")]
yt = df[df["question_title"].str.startswith("YouTube")]
assert len(smi) + len(yt) == len(df), "unclassified question titles"
smi.to_csv(src.replace("votes.csv", "votes_smi.csv"), index=False)
yt.to_csv(src.replace("votes.csv", "votes_youtube.csv"), index=False)
for name, part in (("SMI", smi), ("YouTube", yt)):
    resolved = part[part["ground_truth"].isin(["A", "B"])]
    print(f"{name}: {part['question_id'].nunique()} questions, {resolved['question_id'].nunique()} resolved, "
          f"{len(part)} votes, {part['pseudonym'].nunique()} pseudonyms")
