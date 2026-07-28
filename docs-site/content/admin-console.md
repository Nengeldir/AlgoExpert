# Admin console

The web UI at `/admin`. Everything here is also available over HTTP — see
[Reference → Admin endpoints](reference.html#admin-endpoints) — but the console is
faster for day-to-day work.

## Signing in

Go to **`/admin/login`** and paste the admin token. There is no username.

The token is stored in your browser and sent as `Authorization: Bearer <token>` on every
admin request. Logging out clears it. `/admin` redirects to `/admin/questions`.

> **Warning:** Anyone with the token has full access: read every vote, resolve any
> question, delete any question along with its votes. There is no audit log and no
> per-user accounts. Rotating `ADMIN_TOKEN` in the environment immediately invalidates
> every existing admin session.

## The toolbar

Across the top of the dashboard:

| Control | What it does |
|---|---|
| **+ New Question** | Opens a form to create a question by hand |
| **YouTube Suggestion** | Opens the daily YouTube pair panel |
| **Publish SMI Question** | Runs the SMI daily job right now, instead of waiting for cron |
| **Export CSV** | Downloads every vote as `votes.csv` |
| **Export JSON** | Same data as JSON |

**Publish SMI Question** is the manual trigger for the same code the morning cron job
runs. It is safe to click twice — the job refuses to create a second question for the
same day. It also refuses if voting for today has already closed, since an unvotable
question helps nobody.

## Creating a question by hand

Use this for one-off questions ("will it snow in Zurich on Monday?").

You supply a title, description, the two option labels, and a **deadline**. Manual
questions get no `published_at`, so they are visible immediately, and no measured
window — you resolve them yourself when the answer is known.

Set the deadline before the outcome becomes observable. The app will not enforce this
for you on a manual question; the fairness rule from
[Question lifecycle](question-lifecycle.html) is yours to uphold here.

## The YouTube panel

Click **YouTube Suggestion**, then:

- **Generate Suggestion** — fetches a video pair from the YouTube API and caches it as
  today's suggestion.
- **Regenerate** — discards the cached pair and fetches a new one. Only available before
  approval.
- **Approve** — publishes the pair as a question on the fixed daily anchors.

One suggestion per day, keyed by date. Once approved, that day is done; regenerating is
no longer possible.

The panel shows each video's title, channel, thumbnail, subscriber count, publish date
and current views. Use them to sanity-check the pair — reject anything with wildly
mismatched scale, since a race between a 40M-view video and a 400-view video is not an
interesting prediction.

> **Note:** If the panel errors with "YOUTUBE_API_KEY is not configured", the backend is
> missing its key. If it errors with a quota message, see
> [Troubleshooting](troubleshooting.html#youtube-api-quota-exceeded).

## Question cards

Each question in the list shows its id, title, status badge, vote count, both options,
deadline and creation date.

### Resolving

Unresolved questions show **A is correct** / **B is correct**. Clicking one sets the
ground truth and scores every vote immediately.

While voting is still open the label reads **Resolve early** — a deliberate warning.
Resolving early locks out everyone who has not yet voted.

Resolution cannot be undone. A second attempt returns `409 Question already resolved`.
If you resolved wrongly, your only option is to delete the question and recreate it,
losing all its votes.

### Viewing votes

**Show votes** expands a per-question panel listing each pseudonym, their choice, whether
they were right, and when they voted, plus a summary of the A/B split.

This is the admin view only. Students never see it — `/api/questions` and `/api/history`
join votes for the authenticated user alone.

### Deleting

**Delete** asks for confirmation, then removes the question, all of its votes, and any
YouTube suggestion row that published it. Removing the suggestion row is what lets you
fetch a fresh pair for that date.

Deletion is permanent and there is no backup unless you made one. See
[Semester reset](semester-reset.html#backing-up-first).

## Exporting

**Export CSV** downloads every vote across every question, with these columns:

```text
question_id, deadline, pseudonym, question_title, option_a, option_b,
ground_truth, user_vote, is_correct, voted_at
```

`question_id` and `deadline` are there so the analysis can order rounds chronologically.
This matters more than it sounds — grouping by title alone sorts alphabetically, putting
"Day 10" before "Day 2" and silently scrambling every weight trajectory.

Unresolved questions still appear, with empty `ground_truth` and `is_correct`. The
analysis loader skips them.

## Next

→ [Cron setup](cron-setup.html): wiring up the jobs that do the rest.
