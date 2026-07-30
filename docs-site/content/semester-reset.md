# Semester reset

Handing the app to the next cohort. Do this once, between courses.

## Backing up first

The database is one SQLite file. There is no automatic backup and deletion is
irreversible, so take a copy before anything else.

**From Railway**, open a shell on the backend service and copy the file out, or use the
export endpoint — which is usually enough, since the votes are the part with research
value:

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  "https://your-backend.up.railway.app/admin/export?format=csv" -o votes-2026-spring.csv
```

**Locally with Docker:**

```bash
docker compose cp backend:/data/app.db ./backup-2026-spring.db
```

Keep both: the CSV is what the analysis consumes, the `.db` file is the complete record
including users and unresolved questions.

> **Warning:** The export contains pseudonyms and every individual vote. Pseudonymous is
> not anonymous — if you hold the mapping from pseudonyms to students, treat the export
> as personal data and store it accordingly. Email addresses are not in the export, but
> they are in the database file.

## What to reset

Decide deliberately; these are separable.

| | Keep | Wipe |
|---|---|---|
| **Questions and votes** | Never — they are last semester's | Yes, always |
| **User accounts** | Only if the same students continue | Usually yes |
| **`ADMIN_TOKEN`** | — | Yes, if the previous TA is leaving |
| **`JWT_SECRET`** | — | Rotate to log everyone out |
| **API keys** | Yes, unless they were personal | — |

## Full wipe

The bluntest and cleanest approach: delete the database file and let the app recreate it
empty on next start.

**Railway:** delete and reattach the volume, or open a shell and remove
`/data/app.db` plus its `-wal` and `-shm` siblings, then restart the service. The schema
is created automatically on boot by `initDb`.

**Local Docker:**

```bash
docker compose down -v          # -v removes the db-data volume
docker compose up --build -d
docker compose exec backend npm run seed    # optional test data
```

**Local, no Docker:**

```bash
rm -f apps/backend/data/app.db
npm run seed
```

## Partial reset: keep accounts, drop questions

If the same students continue, deleting each question from the admin console removes its
votes too, leaving users intact. Fine for a handful of questions, tedious for a
semester's worth.

For a bulk clear, open the database and run:

```sql
DELETE FROM votes;
DELETE FROM smi_questions;
DELETE FROM youtube_suggestions;
DELETE FROM questions;
```

Order matters — votes and the two source tables reference `questions`.

> **Danger:** There is no undo. Take the backup from the top of this page first, and
> verify you can read it before deleting anything.

## Rotate the secrets

In the Railway backend service's Variables tab:

- **`ADMIN_TOKEN`** — the previous TA's admin access dies the moment you change this.
  Generate something long and random; it is a password, not an identifier.
- **`JWT_SECRET`** — changing it invalidates every student session. Harmless when you
  have just wiped the accounts anyway.

Then update the `Authorization` header on all four cron jobs to the new admin token, or
they will start returning `403`. This is the step most likely to be forgotten.

## Checklist for the new semester

1. Backup taken and verified readable.
2. Database wiped.
3. `ADMIN_TOKEN` and `JWT_SECRET` rotated.
4. Cron jobs updated with the new token and **verified firing** — see
   [Cron setup → Verifying](cron-setup.html#verifying-the-jobs-work).
5. Cron schedules checked against the current [CET/CEST
   season](cron-setup.html#the-daylight-saving-trap).
6. `YOUTUBE_API_KEY` still valid and within quota.
7. `RESEND_API_KEY` still valid, and a test password reset actually arrives.
8. Register a test account end-to-end: vote, resolve, check History.
9. Hand over this handbook and the admin token to whoever is taking over.

## Generating a good secret

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

```powershell
-join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Max 256) })
```

## Next

→ [Lecture day](lecture-day.html): turning a semester of votes into the live session.
