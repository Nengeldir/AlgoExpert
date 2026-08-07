# Handover

For the assistant who is leaving, and the one arriving. [Semester
reset](semester-reset.html) covers wiping the *data* between cohorts; this page covers
moving the *accounts* when the person changes.

Do these in order. Steps 1 and 2 involve someone else's approval and a 24-hour clock;
everything after that is unblocked work the successor can do alone.

## Production inventory

Fill this in and hand it over alongside the handbook. It is the thing that is always
missing.

| Asset | Where | Value |
|---|---|---|
| Repository | GitHub | _(fill in)_ |
| Railway project | Railway | _(fill in)_ |
| Backend URL | Railway | `https://algoexpert-backend-production.up.railway.app` |
| Frontend URL | Railway | _(fill in)_ |
| Docs URL | Railway | _(fill in)_ |
| Custom domain | Infomaniak | _(fill in)_ |
| `ADMIN_TOKEN` | Railway variables | Never write it here — hand it over separately |
| Cron jobs | cron-job.org | 4 jobs, see [Cron setup](cron-setup.html) |
| YouTube key | Google Cloud | Project name, not the key |
| Email | Resend | Team name and verified domain |

> **Danger:** Do not commit the admin token, the JWT secret, or any API key to the
> repository — including into this table. Hand secrets over in person, or through a
> password manager, and rotate them afterwards regardless.

## 1. The Railway project

This is the only asset that holds irreplaceable state: the SQLite database on the `/data`
volume. Everything else can be rebuilt from the repository in an afternoon.

Two ways forward.

### Option A — transfer the project (recommended)

The project moves whole: services, variables, volume, custom domains, deploy history. No
downtime, no redeploy, no DNS change.

**Requirements:** both accounts need an active **Hobby or Pro plan** — Railway will not
transfer a project into or out of a free/trial account. Hobby is $5/month, and the
successor pays for the project's usage from the moment they accept.

1. The successor creates a Railway account and subscribes to Hobby.
2. You: *Project Settings → Members* → invite them by email.
3. Once they have joined, click the **three dots** next to their name → **Transfer
   Ownership**.
4. They receive a confirmation email and have **24 hours** to accept. Miss the window and
   you start over.

**What does not transfer:** account credits. They are tied to the account, not the
project — spend or write off anything you have left before transferring.

After they accept, verify rather than assume:

```bash
curl -s https://algoexpert-backend-production.up.railway.app/health
# {"status":"ok"}
```

Then check that the `/data` volume is still attached (*backend service → Variables →*
`DATABASE_PATH=/data/app.db`, and *Settings → Volumes*) and that the question list at
`/admin/questions` still shows the semester's history. A project whose volume detached
looks perfectly healthy and has an empty database.

### Option B — redeploy from scratch

Right choice if the successor is starting a new course rather than continuing yours, or if
neither of you wants a paid plan on the other's account.

1. They follow [Deployment → First deploy, in order](deployment.html#first-deploy-in-order)
   in their own Railway account.
2. You take a backup — see [Semester reset → Backing up
   first](semester-reset.html#backing-up-first) — and hand over the `.db` file and the CSV
   export. The CSV is what the analysis consumes; the `.db` is the complete record.
3. If they want the old data live, they copy the `.db` onto the new volume and restart.
   Otherwise the app creates an empty schema on first boot and they start clean.
4. The public URLs change, so `CORS_ORIGIN`, `VITE_API_URL`, the four cron job URLs, and
   the domain's DNS records all need updating.

> **Warning:** `VITE_API_URL` is baked in at **build time**. Setting it after the frontend
> has deployed does nothing — set it, then redeploy, or the new frontend will keep calling
> the old backend.

## 2. The domain

The domain is registered at [Infomaniak](https://www.infomaniak.com). Moving it to the
successor's Infomaniak account is an **internal Organisation-to-Organisation transfer** —
not a registrar transfer. There is no EPP/auth code, no 60-day lock, no DNS change, and no
interruption to the service.

### How it is wired

Railway serves the custom domain; Infomaniak only holds DNS.

| Record | Name | Points at | Why |
|---|---|---|---|
| `CNAME` | the subdomain, e.g. `app` | the service's `*.up.railway.app` hostname | Routes traffic |
| `TXT` | as shown by Railway | as shown by Railway | Proves ownership |

Both are required. **If the `TXT` record is missing, the domain returns `404` even after
the `CNAME` resolves correctly** — Railway will not serve a domain it has not verified.
Railway issues the Let's Encrypt certificate automatically once verification passes,
usually within the hour.

> **Note:** Infomaniak does **not** support `ALIAS` or `ANAME` records, and DNS forbids a
> `CNAME` at the zone apex. So the bare domain (`yourdomain.ch`) cannot point at Railway
> directly. Use a subdomain — `app.`, `api.`, `docs.` — and, if you want the bare domain to
> work, add a **web redirection** from the root to the subdomain in the Infomaniak domain
> manager. This is a property of the registrar, not a mistake in the setup; do not spend an
> afternoon looking for the ALIAS option.

### Transferring it between Infomaniak accounts

You must be an **Administrator or Legal Representative** of the Organisation that holds
the domain; the receiver needs administrative rights on theirs.

**You:**

1. Open the [product transfers
   page](https://manager.infomaniak.com/v3/ng/admin3/accounts/transfers/list) in the
   Infomaniak Manager.
2. **Transfer products** → select the domain → accept the conditions → **Transfer**.
3. Choose how to deliver it: copy the transfer link, email it, or pick the destination
   Organisation directly if you can already see it.

**Them:**

1. Log into the Manager for the receiving Organisation.
2. Open the transfer link, select the destination Organisation, accept the conditions,
   click **Receive the product**.

**What is lost in the transfer:** users who currently have access (they lose it), work
groups and any rights granted through them, and the invoice history — invoices stay with
the original Organisation. The DNS zone, the records, and the registration itself all move
intact.

> **Note:** Moving the product between Organisations is not the same as changing the
> **registrant** (the legal owner contact on the WHOIS record). If the successor also needs
> to become the registrant, that is a separate operation in the domain's settings and
> triggers its own validation email. For a course handover, moving the product is usually
> enough.

### The alternatives

- **Keep it yourself and add them as a user** on your Organisation. Fine for a term, but
  it means the domain silently depends on your account continuing to exist.
- **Leave Infomaniak entirely** — that is a real registrar transfer: request the transfer
  code (*domain → Transfer code*), hand it to the new registrar, wait out the standard
  transfer window. Only worth it if the successor already has a registrar they prefer.
- **Drop the domain** and use the `*.up.railway.app` URLs. Free and instant, but then
  `CORS_ORIGIN`, `VITE_API_URL`, the cron URLs, and the Resend `EMAIL_FROM` all have to
  change, and every bookmark and QR code from the previous semester dies.

## 3. What the successor recreates

These take about twenty minutes in total and do not need anything from you except the
knowledge that they exist.

| Service | What to do | Where |
|---|---|---|
| Google Cloud / YouTube key | Create fresh on their own Google account | [External services](external-services.html#youtube-data-api-key) |
| cron-job.org | Create an account, recreate the four jobs | [Cron setup](cron-setup.html#creating-the-jobs-step-by-step) |
| Resend | Join your team, claim the domain, or start fresh | [External services](external-services.html#handing-resend-over) |
| VAPID keypair | **Do not regenerate** — keep the existing values | [External services](external-services.html#the-vapid-keypair) |

Delete your own YouTube key and cron-job.org jobs once theirs are confirmed working. Two
sets of cron jobs hitting the same endpoints is harmless — every endpoint is idempotent —
but it doubles the noise and leaves your account holding a live admin token.

## 4. Rotate the secrets

Do this **after** the transfer, not before, or you will lock the successor out of a project
they have not received yet.

- **`ADMIN_TOKEN`** — your admin access dies the moment it changes. Then update the
  `Authorization` header on all four cron jobs, or they start returning `403`. This is the
  single most forgotten step of the whole handover.
- **`JWT_SECRET`** — logs every student out. Harmless if the accounts are being wiped
  anyway.
- **`YOUTUBE_API_KEY`, `RESEND_API_KEY`** — replaced with the successor's own.
- **`VAPID_*`** — leave alone.

See [Semester reset → Generating a good
secret](semester-reset.html#generating-a-good-secret) for the one-liners.

> **Danger:** cron-job.org disables a job automatically after **25 consecutive failures**.
> Rotate the admin token without updating the jobs and they will fail silently for a couple
> of hours, then switch themselves off. Re-enabling them is a manual click that nobody
> knows to make, because the symptom is simply that no question appeared this morning.

## Handover checklist

1. Backup taken, and **verified readable** — not just downloaded.
2. Railway project transferred and accepted, or redeployed and confirmed serving.
3. `/health` returns `ok`, the `/data` volume is attached, and past questions are visible.
4. Domain transferred; `CNAME` and `TXT` still resolve; HTTPS still valid.
5. Successor's YouTube key set and `/admin/youtube/suggest` returns a pair.
6. Successor's cron jobs created, and each one **fired successfully at least once** — see
   [Cron setup → Verifying](cron-setup.html#verifying-the-jobs-work).
7. Email sending confirmed with a real password reset to a real address.
8. `ADMIN_TOKEN` and `JWT_SECRET` rotated, and the cron jobs updated with the new token.
9. Your old cron jobs and API keys deleted.
10. Inventory table above filled in and handed over, secrets shared out-of-band.
11. Successor has registered a test account, voted, and resolved a question end to end.

## Next

→ [Lecture day](lecture-day.html): turning a semester of votes into the live session.
