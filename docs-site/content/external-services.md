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
| Drawing a pair (`/admin/youtube/suggest`) | 1 × `channels.list` + 33 × `playlistItems.list` + ~3 × `videos.list` | **~38** |
| Opening a race (12:00) | 1 × `videos.list` | **1** |
| Closing a race (24:00) | 1 × `videos.list` | **1** |

That is around forty units on a busy day against an allowance of ten thousand — still two
orders of magnitude of headroom. Two design choices buy that margin:

- `services/youtube.ts` reads each curated channel's **uploads playlist**, which costs 1 unit
  per channel, rather than calling `search.list` at **100 units** per call (and capped at 100
  calls/day for new projects). Reading a 33-channel roster outright is a third of the price of
  a single search query.
- The five-minute race tick queries SQLite *first* and only touches the YouTube API when a
  race actually needs opening or closing. The 288 daily ticks are almost all free.

So if you ever see `403 quotaExceeded`, something is wrong — a runaway loop, or the key
being shared with another project — rather than normal use.

### Which videos can be drawn

Candidates come from a **hand-picked roster of channels** — `CURATED_CHANNELS` in
`services/youtube.ts` — not from YouTube's trending charts. Roughly 35 channels: Swiss and
German public-broadcaster documentary strands (SRF Dok, ARTE, ZDFinfo, NDR/WDR/SWR Doku,
phoenix, 3sat NANO, Terra X), German-language explainer and science channels (Quarks,
Simplicissimus, MrWissen2go, MAITHINK X, Dinge Erklärt), investigative reportage (STRG_F,
Y-Kollektiv, SPIEGEL TV) and English-language current affairs (Vox, The Economist, Channel 4
News, ABC News In-depth, CNA Insider, TLDR News, VisualPolitik).

Four filters sit between the roster and a suggestion:

- **Recency** — only uploads from the last 7 days (`RECENT_DAYS`), widening to 21 once if the
  roster has been too quiet to fill a pair. A documentary posted a month ago has settled onto a
  flat view curve, so racing two of them measures noise.
- **No Shorts.** Anything three minutes or under is dropped, Shorts having been allowed to
  run that long since Oct 2024. Live broadcasts and premieres are dropped too: a stream's view
  count is a concurrent-viewer artifact, not a total that can be raced.
- **Minimum pace** — at least ~170 views/hour (`MIN_VIEWS_PER_HOUR`), so the video gains
  roughly 2,000 views across the 12 h window and the winner is not decided by jitter.
- **One video per channel** — the newest qualifying upload, which has the steepest view curve.

Shorts are excluded because their view counts are driven by opaque feed-push rather than by
anything a voter can reason about, and they can take on millions of views overnight — a race
between two of them is closer to a coin flip than to a prediction.

#### Why a roster instead of trending

Trending was dropped for two independent reasons. **Audience:** `chart=mostPopular` returns
what is popular with YouTube's median viewer — gaming, reaction content, influencer vlogs —
and this app's participants are largely 30+ and not habitual YouTube users, so those pairs
asked them to predict a race between two things they had no basis to reason about.
**Availability:** YouTube keeps retiring per-category trending charts, and Education (27) —
exactly the category this audience wanted — is among the dead ones.

The trade-off is editorial: the roster, not an algorithm, decides what participants see. Keep
it broad across topic and language so the pool does not inherit a narrow bias.

#### How a pair is chosen

Two videos pair if their **view counts** are within 3× *and* their **views-per-hour** are within
3×. The first is about optics — the question text quotes both view counts, and "12k vs 900k"
looks decided before the race starts. The second is about the actual race: the 12 h window
measures the *change* in views, and views-per-hour estimates that directly.

There is deliberately **no subscriber-count gate**. It was only ever a crude proxy for expected
growth, and it priced out every cross-language pair — the English channels run an order of
magnitude larger by subscriber count than the Swiss and German ones, so any reasonable bound
rejected them however close the real race was. Two videos moving at a similar rate make a close
race whether their channels have 90k subscribers or 12M.

#### Adding channels: match cadence and scale, not just topic

The two failure modes are subtle, and both make a channel silently contribute nothing:

- **Too slow a cadence.** Only uploads inside the 7-day window count. Veritasium, Kurzgesagt,
  Johnny Harris and RealLifeLore post every 10–26 days, so they are usually absent entirely.
- **Wrong view scale.** Their videos land at 1–5M views against 10–250k for the German
  documentary strands, so no pair clears the 3× view-ratio gate even when they are present.

All four were on the original roster and effectively never appeared. The replacements were
picked by measuring both properties first: at least two long-form uploads per week, and a median
view count in the same 13k–190k band as the rest of the roster. Check a candidate before adding
it rather than trusting that a good channel will produce good questions.

#### Editing the roster

Entries are channel IDs rather than handles, because handles get renamed. To resolve a new one:

```bash
curl -s "https://www.googleapis.com/youtube/v3/channels?part=snippet&forHandle=ARTEde&key=$YOUTUBE_API_KEY" \
  | grep -o '"id": "[^"]*"' | head -1
```

If `forHandle` returns nothing, the handle is wrong — fall back to
`search?part=snippet&type=channel&q=<name>` (100 units) and read the `channelId` off the result.
A channel that stops uploading needs no cleanup; it simply stops contributing candidates at a
cost of one wasted quota unit per draw.

### `404 Requested entity was not found`

A single channel's uploads playlist failing is tolerated — the draw logs it and continues on
the rest of the roster. If `/admin/youtube/suggest` reports that too few videos qualified,
the roster is genuinely quiet (a holiday week) or the filters have become too strict; check
`RECENT_DAYS` and `MIN_VIEWS_PER_HOUR` before adding channels.

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
