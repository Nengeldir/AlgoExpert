# Operator handbook

This is the handbook for whoever is **running** the Expert Algorithm voting app — the TA
or assistant responsible for making sure questions appear each morning, resolve each
night, and produce clean data for the lecture.

It assumes you did not write the app and do not want to read TypeScript. Where something
genuinely requires a code change, the page says so and points at the file.

In the age of AI, feel free to use a chatbot or Claude Code to troubleshoot and ask for guidance.

## What the app does

Students register with a **pseudonym** and vote on one binary question per day
("will the SMI close higher?", "which video gains more views?"). Each question has a
ground truth that arrives later the same day. Every vote is scored right or wrong.

At the end of the course you export all votes as CSV and run the Expert Algorithm
(Weighted Majority) over them live in the lecture — the students *are* the experts.

> **Note:** Students can never see each other's votes, and the app never shows a
> leaderboard. This is not an oversight. The algorithm's whole point is aggregating
> *independent* predictions; if students can see the crowd they herd, the predictions
> stop being diverse, and the live analysis loses its punch. Keep it that way.

## What runs by itself, and what needs you

| | Who does it | How often |
|---|---|---|
| Create the daily SMI question | **Automatic** — cron hits `/admin/smi/daily` | Weekday mornings |
| Resolve the SMI question | **Automatic** — cron hits `/admin/smi/resolve` | Weekday evenings |
| Snapshot + resolve YouTube races | **Automatic** — cron hits `/admin/youtube/resolve` | Every 5 minutes |
| **Approve the YouTube question** | **You**, in the admin console | Each day you want one |
| Watch for stuck/unresolved questions | **You** | A glance every few days |
| Export votes for the lecture | **You** | Once, before the session |

The single recurring manual task is **approving a YouTube pair**. Everything else is
either automated or a once-a-semester setup step.

## Where to start

- Never run this app before? → [Getting started](getting-started.html)
- Taking over an app that is already live? → [Daily operations](daily-operations.html)
- Something is broken right now? → [Troubleshooting](troubleshooting.html)
- New semester, fresh cohort? → [Semester reset](semester-reset.html)
- Lecture is tomorrow? → [Lecture day](lecture-day.html)

## The one concept worth understanding

Every question follows the same daily shape, in Zurich wall-clock time:

```text
08:00  publish        question becomes visible, voting opens
12:00  voting closes  the measured window STARTS here
24:00  race ends      the measured window ends, question resolves
```

The voting window and the measured window **must never overlap**. If they did, a student
voting late would be observing the outcome rather than predicting it — they could simply
read off the answer.

[Question lifecycle](question-lifecycle.html) explains it properly. Read that page before
you change any schedule.

## How this handbook is maintained

The pages you are reading are built from markdown in `docs-site/content/` in the app
repository. Edit the markdown, run `npm run build`, redeploy. There is no CMS and no
database — see [Deployment](deployment.html#the-docs-site-itself).
