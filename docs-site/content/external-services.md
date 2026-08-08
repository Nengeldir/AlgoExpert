# External services

The app depends on three third-party accounts and one generated keypair. None of them are
hard to create — the reason this page exists is that they are usually created *once*, by
someone who then leaves, and the next person has no idea which account holds what.

| Service | Powers | Env var | Cost | If it lapses |
|---|---|---|---|---|
| [Google Cloud](https://console.cloud.google.com) | YouTube race questions | `YOUTUBE_API_KEY` | Free | YouTube endpoints return `503`; SMI unaffected |
| [Resend](https://resend.com) | Password resets, new-question emails | `RESEND_API_KEY`, `EMAIL_FROM` | Free tier | Emails silently stop; voting still works |
| [cron-job.org](https://cron-job.org) | Every scheduled action | — (holds `ADMIN_TOKEN`) | Free | Nothing happens automatically at all |
| VAPID keypair | Browser push notifications | `VAPID_*` | — | Push sends are skipped and logged |

**All of these can live on a personal account.** They hold no student data — the API keys
are write-nothing credentials for public data, and cron-job.org only stores a URL and a
bearer token. The two things that genuinely must be institutional are the Railway project
(it holds the database) and the domain; those are covered in
[Handover](handover.html).

> **Warning:** cron-job.org is the exception worth thinking about. It stores your
> production `ADMIN_TOKEN` in a third-party account. That token reads every vote and can
> delete every question. If you hand cron-job.org to a successor, rotate the token
> afterwards — see [Semester reset → Rotate the secrets](semester-reset.html#rotate-the-secrets).

## YouTube Data API key

Needed by `/admin/youtube/suggest` (drawing a pair) and `/admin/youtube/resolve` (both
ends of the race). No billing account, no credit card, no verification.

1. Open the [Google Cloud Console](https://console.cloud.google.com) and sign in with any
   Google account.
2. **Create a project** — the project picker in the top bar → *New project*. Name it
   something you will recognise in a year, e.g. `expert-vote`.
3. **Enable the API.** *APIs & Services → Library*, search for **YouTube Data API v3**,
   open it, click **Enable**. This step is the one people skip; without it the key exists
   but every call returns `403 accessNotConfigured`.
4. **Create the key.** *APIs & Services → Credentials → Create credentials → API key*.
   Copy the value.
5. **Restrict it.** On the key's edit page, under *API restrictions*, choose **Restrict
   key** and select only **YouTube Data API v3**. Leave *Application restrictions* set to
   **None**.
6. Paste it into the Railway backend service as `YOUTUBE_API_KEY` and redeploy.

> **Note:** Leaving *Application restrictions* at **None** is deliberate, not laziness.
> HTTP-referrer restrictions only work for browser calls, and this key is used server-side;
> IP restrictions need a stable egress IP, which a Railway container does not have. The API
> restriction is the meaningful one — a leaked key can read public YouTube statistics and
> nothing else. Rotate it if it leaks; do not try to lock it to an IP.

### Quota

A new project gets **10,000 units per day**, resetting at midnight US Pacific time. What
this app actually spends:

| Action | Calls | Units |
|---|---|---|
| Drawing a pair (`/admin/youtube/suggest`) | 3 × `videos.list` + 2 × `channels.list` | **5** |
| Opening a race (12:00) | 1 × `videos.list` | **1** |
| Closing a race (24:00) | 1 × `videos.list` | **1** |

That is under twenty units on a busy day against an allowance of ten thousand — three
orders of magnitude of headroom. Two design choices buy that margin:

- `services/youtube.ts` draws candidates from `chart=mostPopular` rather than
  `search.list`. Search costs **100 units** per call and is capped at 100 calls/day for
  new projects; the trending chart costs 1 — and costs the same 1 whether it returns 25
  results or the maximum 50, which is why it asks for 50.
- The five-minute race tick queries SQLite *first* and only touches the YouTube API when a
  race actually needs opening or closing. The 288 daily ticks are almost all free.

So if you ever see `403 quotaExceeded`, something is wrong — a runaway loop, or the key
being shared with another project — rather than normal use.

### Which videos can be drawn

Two filters sit between the trending chart and a suggestion, both in
`TARGET_CATEGORY_IDS` / `SHORTS_MAX_SECONDS` (`services/youtube.ts`):

- **Only three categories** — People & Blogs, News & Politics, Science & Technology.
- **No Shorts.** Anything three minutes or under is dropped, Shorts having been allowed to
  run that long since Oct 2024. Live broadcasts report a duration of `P0D` and are dropped
  by the same rule, deliberately: a stream's view count is a concurrent-viewer artifact, not
  a total that can be raced.

Shorts are excluded because their view counts are driven by opaque feed-push rather than by
anything a voter can reason about, and they can take on millions of views overnight — a race
between two of them is closer to a coin flip than to a prediction. The category list follows
from that: measured over the top 50 in Aug 2026, Film & Animation, Comedy, Entertainment,
Howto & Style and Pets were **100% Shorts**, so drawing from them spends a quota unit to
return nothing. If a future measurement shows the three remaining categories drying up, swap
in whichever ones still carry long-form rather than relaxing the duration filter.

### `404 Requested entity was not found`

YouTube retires the trending chart for individual categories without notice — Education
(27) and Travel (19) both stopped answering in August 2026. Drawing a pair now skips any
category that 404s and builds the pair from whichever categories still respond, so a
single retirement no longer breaks `/admin/youtube/suggest`. If you see the suggestion
complain that too few videos came back, all three categories in `TARGET_CATEGORY_IDS`
(`services/youtube.ts`) have gone dark and need replacing — probe a candidate with:

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  "https://www.googleapis.com/youtube/v3/videos?part=snippet&chart=mostPopular&maxResults=1&regionCode=US&videoCategoryId=26&key=$YOUTUBE_API_KEY"
```

## Resend

Transactional email: password-reset links and the new-question announcement. Sign up at
[resend.com](https://resend.com) with any address.

### The free tier, and why it matters here

| Limit | Free plan |
|---|---|
| Emails per month | 3,000 |
| **Emails per day** | **100** |
| Verified domains | 1 |
| Log retention | 30 days |

The daily cap is the binding one. `dispatchNewQuestionEmails` sends **one message per
recipient** — it must, because a single email with 40 addresses in `to` would expose every
participant's address to every other participant. So one announcement to a cohort of 40
costs 40 emails.

Do the arithmetic before the semester rather than during it:

```text
students × questions announced per day  +  password resets
   40    ×             2                +        ~5          = 85 emails/day
```

A cohort of 40 with both an SMI and a YouTube question each day sits just under the cap. A
cohort of 60 does not. If you expect to exceed it, either upgrade, or have students switch
off email notifications in Settings and rely on [web push](#the-vapid-keypair) instead.

> **Warning:** Resend does not queue over the cap — it rejects. A rejected send leaves
> `questions.notified_at` NULL, so the next cron tick retries the same question and hits
> the same wall. Nobody gets told, and nothing in the app surfaces the failure. Check the
> Resend dashboard's log if announcements stop arriving.

### Verify a domain — this is not optional in production

Out of the box `.env.example` ships `EMAIL_FROM=Expert Vote <onboarding@resend.dev>`.
That shared testing domain **can only send to the email address on your own Resend
account**. Every send to a student returns `403 validation_error`. It is fine for local
development and completely broken in production.

To send to real recipients you must verify a domain you control:

1. Resend dashboard → **Domains → Add Domain**. Use a subdomain, e.g.
   `mail.yourdomain.ch` — that keeps the app's sending reputation separate from any other
   mail on the domain.
2. Resend shows three records. Add them in the Infomaniak DNS zone
   (*Domains → your domain → DNS zone*):

   | Type | Name | Purpose |
   |---|---|---|
   | `MX` | `send` | Bounce and complaint handling, priority `10` |
   | `TXT` | `send` | SPF — authorises Resend to send as you |
   | `TXT` | `resend._domainkey` | DKIM — signs the mail |

   Infomaniak wants the name **without** the domain suffix: type `send`, not
   `send.yourdomain.ch`.
3. Click **Verify**. It usually takes minutes; DNS can take up to 72 hours.
4. Set `EMAIL_FROM` on the Railway backend to an address on that domain, e.g.
   `Expert Vote <noreply@mail.yourdomain.ch>`, and redeploy.

Consider adding a `DMARC` record afterwards. It is not required to send, but it improves
the odds that a university mail filter puts the announcement in the inbox rather than the
spam folder.

### The API key

*API Keys → Create API Key*, permission **Sending access**. It is shown once. Store it as
`RESEND_API_KEY` on the Railway backend.

> **Note:** With `RESEND_API_KEY` unset the app does not crash — it writes the reset links
> and intended recipients to the backend log instead. Convenient locally, invisible in
> production. If students report that reset emails never arrive, check that the variable is
> actually set before debugging anything else.

### Handing Resend over

Three options, in descending order of tidiness:

1. **Invite the successor to your team** (*Settings → Team*, role **Admin**) and remove
   yourself afterwards. Keeps the verified domain, the DNS records, and the sending
   history intact.
2. **Move the domain to their team** using Resend's *Domain Claim*: they add the domain in
   their own account, prove ownership with a TXT record, and Resend releases it from
   yours. If the domain has recent sending activity you may need to ask Resend support to
   release it.
3. **Start fresh.** They create their own account and re-verify the domain. Costs one DNS
   edit and loses nothing but the 30-day log.

Whichever you choose, the API key does **not** travel — keys are per-team and shown once.
The successor generates a new one and updates `RESEND_API_KEY`.

## The VAPID keypair

Not an account — two strings identifying this app to browser push services. Generate once:

```bash
npx web-push generate-vapid-keys
```

Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (a `mailto:` address) on
the Railway backend.

> **Warning:** These are the one credential you should **not** rotate at handover.
> Subscriptions students' browsers created are bound to the public key. Change it and every
> existing subscription becomes undeliverable — the rows stay in `push_subscriptions`, the
> sends fail, and nobody is notified. Rotate only if the private key leaks, and accept that
> students will have to re-enable push in Settings.

Push is deliberately additive to email, not a replacement: it opts in per browser rather
than per account, and iOS Safari's support is patchier than Android or desktop.

## Next

→ [Troubleshooting](troubleshooting.html): when something is not working.
