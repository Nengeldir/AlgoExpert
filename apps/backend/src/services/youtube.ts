const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3'

interface VideoListItem {
  id: string
  snippet: {
    title: string
    channelId: string
    channelTitle: string
    publishedAt: string
    liveBroadcastContent?: string
    thumbnails: { medium?: { url: string }; default?: { url: string } }
  }
  statistics: {
    viewCount?: string
  }
  contentDetails: {
    duration: string
  }
}

interface ChannelItem {
  id: string
  statistics: { subscriberCount?: string }
  contentDetails: { relatedPlaylists: { uploads?: string } }
}

interface PlaylistItem {
  contentDetails: { videoId: string; videoPublishedAt?: string }
}

export interface VideoCandidate {
  videoId: string
  videoTitle: string
  channelId: string
  channelTitle: string
  thumbnail: string
  subscribers: number
  viewCount: number
  publishedAt: string
}

export interface YoutubePair {
  videoA: VideoCandidate
  videoB: VideoCandidate
}

/**
 * The candidate pool is a hand-picked roster of channels rather than YouTube's trending charts.
 *
 * Trending was abandoned for two independent reasons:
 *
 *  1. Audience. `chart=mostPopular` returns what is popular with YouTube's median viewer —
 *     gaming, reaction content and influencer vlogs. This app's participants are largely 30+
 *     and not habitual YouTube users, so those pairs asked them to predict a race between two
 *     things they had no basis to reason about, which is a worse prediction task, not just a
 *     less relatable one.
 *  2. Availability. YouTube keeps retiring per-category trending charts — Education (27),
 *     Travel (19) and Nonprofits (29) all 404 as of Aug 2026, verified across the US, CH and DE
 *     regions. Education retiring is what made the chart route unfixable: it was exactly the
 *     category this audience wanted, and `search?videoCategoryId=27` without a `q` term returns
 *     zero results, so there is no substitute query for "the educational chart".
 *
 * A roster fixes both at once and is *cheaper* than the alternative: reading a channel's uploads
 * playlist costs 1 quota unit, against 100 for a `search` call. A full pass over this roster runs
 * ~38 units of the 10,000/day quota.
 *
 * The trade-off is editorial: this list, not an algorithm, decides what participants see. That is
 * deliberate — it is the only knob that reliably controls register — but it means the pool
 * inherits whatever bias the list has, so keep it broad across topic and language.
 *
 * Maintenance: entries are channel IDs because handles get renamed. To add one, resolve its
 * handle via `channels?part=snippet&forHandle=NAME`. A channel that stops uploading simply stops
 * contributing candidates; it costs one wasted quota unit per pass and needs no cleanup.
 */
export const CURATED_CHANNELS: { id: string; name: string }[] = [
  // Swiss
  { id: 'UCdFkj0fA6VYJaty-v8_avvg', name: 'SRF Dokus & Reportagen' },
  { id: 'UCqdXpIZSamBceDmH8uOoTHA', name: 'SRF News & Hintergründe' },
  { id: 'UCO1uLCdX--uLXXDdJXJfpJA', name: 'SRF Wissen' },
  // German-language public broadcasters
  { id: 'UCLLibJTCy3sXjHLVaDimnpQ', name: 'ARTEde' },
  { id: 'UC7FeuS5wwfSR9IwOPkBV7SQ', name: 'ZDFinfo Dokus & Reportagen' },
  { id: 'UCTPAHk1b-h-WGQn9cfGlw2Q', name: 'NDR Doku' },
  { id: 'UCUuab1dctZzN5ZmRmQnTzkg', name: 'WDR Doku' },
  { id: 'UCK6jlnWA8t-XgUxwZJJHkQA', name: 'SWR Doku' },
  { id: 'UCeqKIgPQfNInOswGRWt48kQ', name: 'ZDFheute Nachrichten' },
  { id: 'UCwyiPnNlT8UABRmGmU0T9jg', name: 'phoenix' },
  { id: 'UCW39zufHfsuGgpLviKh297Q', name: 'DW Documentary' },
  { id: 'UCMIgOXM2JEQ2Pv2d0_PVfcg', name: 'DW Deutsch' },
  { id: 'UCA3mpqm67CpJ13YfA8qAnow', name: 'Terra X History' },
  { id: 'UC5E9-r42JlymhLPnDv2wHuA', name: 'Terra X Lesch & Co' },
  { id: 'UCHnmeuSOn1Hscizw6otqWrA', name: '3sat NANO' },
  { id: 'UC-NZazksH-lR-Mif-3DZL3g', name: 'ZDFbesseresser' },
  // German-language explainer / science
  { id: 'UCwRH985XgMYXQ6NxXDo8npw', name: 'Dinge Erklärt – Kurzgesagt' },
  { id: 'UCKGMHVipEvuZudhHD05FOYA', name: 'Simplicissimus' },
  { id: 'UCZHpIFMfoJJ_1QxNGLJTzyA', name: 'MrWissen2go' },
  { id: 'UCyHDQ5C6z1NDmJ4g6SerW8g', name: 'MAITHINK X' },
  { id: 'UC1Y7onDsPyfP-lu--SXF-ew', name: 'Quarks' },
  { id: 'UCEJDM_70A2EiRqZ41l6bZlg', name: '100SekundenPhysik' },
  { id: 'UCE2hJ9CYR57BYhk3TjGVG6w', name: 'Breaking Lab' },
  { id: 'UCesjlAoEgN_Sz_cKTvKEmmw', name: 'Doktor Whatson' },
  // German-language investigative
  { id: 'UCfa7jJFYnn3P5LdJXsFkrjw', name: 'STRG_F' },
  { id: 'UCLoWcRy-ZjA-Erh0p_VDLjQ', name: 'Y-Kollektiv' },
  { id: 'UC1w6pNGiiLdZgyNpXUnA4Zw', name: 'DER SPIEGEL' },
  // English-language explainer
  { id: 'UCLXo7UDZvByw2ixzpQCufnA', name: 'Vox' },
  { id: 'UCHnyfMqiRRG1u-2MsSQLbXA', name: 'Veritasium' },
  { id: 'UCP5tjEmvPItGyLhmjdwP7Ww', name: 'RealLifeLore' },
  { id: 'UCmGSJVG3mCRXVOP4yZrU1Dw', name: 'Johnny Harris' },
  { id: 'UCgNg3vwj3xt7QOrcIDaHdFg', name: 'PolyMatter' },
  { id: 'UCsXVk37bltHxD1rDPwtNM8Q', name: 'Kurzgesagt – In a Nutshell' },
]

// Shorts can run up to 3 minutes since Oct 2024, so anything at or under that is treated as
// one. They make terrible race questions: view counts are driven by opaque feed-push rather
// than by anything a voter can reason about, and they can add millions of views overnight.
const SHORTS_MAX_SECONDS = 180

// Only videos published within this window are eligible. A documentary posted a month ago has
// settled onto a flat view curve, so a 12 h race between two of them measures nothing but noise.
const RECENT_DAYS = 7

// If the roster is too quiet to fill a pair (holidays, a slow news week), widen the window once
// rather than falling back to trending — falling back would reintroduce exactly the off-register
// content the roster exists to exclude.
const FALLBACK_RECENT_DAYS = 21

// The race is decided by the *change* in views over 12 h, so a candidate has to be moving fast
// enough that the delta clears day-to-day jitter. At ~170 views/h a video gains ~2,000 over the
// window, which is comfortably above noise; below that the winner is close to a coin flip.
//
// This is average lifetime velocity (views ÷ age), not current velocity. Because view curves
// decay, it *overstates* how fast an older video is still moving — so the floor is lenient on
// the widened fallback window, never harsh, and must not be relaxed there to find candidates.
const MIN_VIEWS_PER_HOUR = 170

// How many of a channel's most recent uploads to inspect. 10 is enough to look past a Short or
// a livestream sitting at the top of the feed without paying for a second page.
const UPLOADS_PER_CHANNEL = 10

// channels.list and videos.list both accept at most 50 ids and answer 400 invalidFilters beyond.
const ID_BATCH = 50

async function ytFetch<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`YouTube API ${res.status}: ${body.slice(0, 300)}`)
  }
  return res.json() as Promise<T>
}

// contentDetails.duration is ISO-8601 ("PT4M13S"). Live broadcasts report "P0D", which this
// maps to 0 — so the Shorts filter drops them as well, which is what we want: a stream's
// view count is a concurrent-viewer artifact, not a comparable total.
export function parseIsoDurationSeconds(iso: string): number {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso)
  if (!m) return 0
  const [, days, hours, minutes, seconds] = m
  return +(days ?? 0) * 86400 + +(hours ?? 0) * 3600 + +(minutes ?? 0) * 60 + +(seconds ?? 0)
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

interface ChannelMeta {
  uploadsPlaylistId: string
  subscribers: number
}

/** Resolve each roster channel to its uploads playlist and subscriber count. */
async function fetchChannelMeta(apiKey: string): Promise<Map<string, ChannelMeta>> {
  const meta = new Map<string, ChannelMeta>()
  const responses = await Promise.all(
    chunk(
      CURATED_CHANNELS.map((c) => c.id),
      ID_BATCH,
    ).map((batch) =>
      ytFetch<{ items?: ChannelItem[] }>(
        `${YOUTUBE_API_BASE}/channels?part=statistics,contentDetails&id=${batch.join(',')}&key=${apiKey}`,
      ),
    ),
  )

  for (const resp of responses) {
    for (const ch of resp.items ?? []) {
      const uploads = ch.contentDetails?.relatedPlaylists?.uploads
      // A channel with no uploads playlist (deleted or fully private) contributes nothing.
      if (!uploads) continue
      meta.set(ch.id, {
        uploadsPlaylistId: uploads,
        subscribers: parseInt(ch.statistics.subscriberCount ?? '0', 10),
      })
    }
  }
  return meta
}

/** Recent video ids across the roster, newest-first per channel. */
async function fetchRecentVideoIds(
  apiKey: string,
  meta: Map<string, ChannelMeta>,
  since: number,
): Promise<string[]> {
  const perChannel = await Promise.all(
    [...meta.values()].map(async ({ uploadsPlaylistId }) => {
      try {
        const resp = await ytFetch<{ items?: PlaylistItem[] }>(
          `${YOUTUBE_API_BASE}/playlistItems?part=contentDetails&playlistId=${uploadsPlaylistId}` +
            `&maxResults=${UPLOADS_PER_CHANNEL}&key=${apiKey}`,
        )
        return (resp.items ?? [])
          .filter((it) => Date.parse(it.contentDetails.videoPublishedAt ?? '') >= since)
          .map((it) => it.contentDetails.videoId)
      } catch {
        // One unreadable playlist must not sink the whole suggestion — the roster is large
        // enough that losing a channel is invisible.
        return []
      }
    }),
  )
  return perChannel.flat()
}

/** Hydrate ids into candidates, dropping Shorts, livestreams and videos too slow to race. */
async function fetchCandidates(
  apiKey: string,
  videoIds: string[],
  meta: Map<string, ChannelMeta>,
): Promise<VideoCandidate[]> {
  const responses = await Promise.all(
    chunk(videoIds, ID_BATCH).map((batch) =>
      ytFetch<{ items?: VideoListItem[] }>(
        `${YOUTUBE_API_BASE}/videos?part=snippet,statistics,contentDetails&id=${batch.join(',')}&key=${apiKey}`,
      ),
    ),
  )

  const now = Date.now()
  const candidates: VideoCandidate[] = []
  for (const resp of responses) {
    for (const item of resp.items ?? []) {
      if (parseIsoDurationSeconds(item.contentDetails.duration) <= SHORTS_MAX_SECONDS) continue
      // Upcoming premieres and active livestreams report a view count that is not comparable
      // to an on-demand total, and a premiere has no views to race with at all.
      if (item.snippet.liveBroadcastContent && item.snippet.liveBroadcastContent !== 'none')
        continue

      const channel = meta.get(item.snippet.channelId)
      if (!channel) continue

      const viewCount = parseInt(item.statistics.viewCount ?? '0', 10)
      const ageHours = Math.max((now - Date.parse(item.snippet.publishedAt)) / 3_600_000, 1)
      if (viewCount / ageHours < MIN_VIEWS_PER_HOUR) continue

      candidates.push({
        videoId: item.id,
        videoTitle: item.snippet.title,
        channelId: item.snippet.channelId,
        channelTitle: item.snippet.channelTitle,
        thumbnail:
          item.snippet.thumbnails.medium?.url ?? item.snippet.thumbnails.default?.url ?? '',
        subscribers: channel.subscribers,
        viewCount,
        publishedAt: item.snippet.publishedAt,
      })
    }
  }
  return candidates
}

export async function fetchYoutubePair(apiKey: string): Promise<YoutubePair> {
  const meta = await fetchChannelMeta(apiKey)
  if (meta.size === 0) {
    throw new Error('No curated channel could be resolved — check YOUTUBE_API_KEY and quota.')
  }

  let candidates: VideoCandidate[] = []
  let windowDays = RECENT_DAYS
  for (const days of [RECENT_DAYS, FALLBACK_RECENT_DAYS]) {
    windowDays = days
    const ids = await fetchRecentVideoIds(apiKey, meta, Date.now() - days * 86_400_000)
    if (ids.length === 0) continue
    candidates = await fetchCandidates(apiKey, ids, meta)
    if (candidates.length >= 2) break
  }

  if (candidates.length < 2) {
    throw new Error(
      `Only ${candidates.length} curated video(s) qualified in the last ${windowDays} days ` +
        `across ${meta.size} channels (need long-form, non-live, ≥${MIN_VIEWS_PER_HOUR} views/h).`,
    )
  }

  // One video per channel — keep each channel's newest qualifying upload, since it has the
  // steepest view curve and so the most headroom to move during the race.
  const newestPerChannel = new Map<string, VideoCandidate>()
  for (const c of candidates) {
    const held = newestPerChannel.get(c.channelId)
    if (!held || Date.parse(c.publishedAt) > Date.parse(held.publishedAt)) {
      newestPerChannel.set(c.channelId, c)
    }
  }
  const unique = [...newestPerChannel.values()]

  if (unique.length < 2) {
    throw new Error(`Only ${unique.length} curated channel(s) had a qualifying video.`)
  }

  // Pair on comparable channel reach and comparable current traction: a lopsided view count
  // makes the race trivially predictable. Both thresholds are looser than they were under the
  // trending pool — with a curated roster the ratios no longer double as a quality filter, so
  // tight bounds bought nothing but a thinner, more repetitive set of pairs.
  const SUBSCRIBER_RATIO_THRESHOLD = 10
  const VIEW_RATIO_THRESHOLD = 3
  // Among acceptable pairs, only the closest few by view count are considered, so a
  // regeneration still varies but never lands on the loosest match the threshold allows.
  const CLOSEST_PAIR_POOL = 15

  const ratio = (a: number, b: number) => Math.max(a, b) / Math.max(Math.min(a, b), 1)

  const acceptablePairs: { pair: [VideoCandidate, VideoCandidate]; viewRatio: number }[] = []
  for (let i = 0; i < unique.length - 1; i++) {
    for (let j = i + 1; j < unique.length; j++) {
      const viewRatio = ratio(unique[i].viewCount, unique[j].viewCount)
      if (
        ratio(unique[i].subscribers, unique[j].subscribers) <= SUBSCRIBER_RATIO_THRESHOLD &&
        viewRatio <= VIEW_RATIO_THRESHOLD
      ) {
        acceptablePairs.push({ pair: [unique[i], unique[j]], viewRatio })
      }
    }
  }

  if (acceptablePairs.length > 0) {
    acceptablePairs.sort((a, b) => a.viewRatio - b.viewRatio)
    const pool = acceptablePairs.slice(0, CLOSEST_PAIR_POOL)
    const [bestA, bestB] = pool[Math.floor(Math.random() * pool.length)].pair
    return { videoA: bestA, videoB: bestB }
  }

  // No pair satisfied both thresholds — fall back to the pair with the closest view counts
  let fallback: [VideoCandidate, VideoCandidate] = [unique[0], unique[1]]
  let closest = Infinity
  for (let i = 0; i < unique.length - 1; i++) {
    for (let j = i + 1; j < unique.length; j++) {
      const r = ratio(unique[i].viewCount, unique[j].viewCount)
      if (r < closest) {
        closest = r
        fallback = [unique[i], unique[j]]
      }
    }
  }

  return { videoA: fallback[0], videoB: fallback[1] }
}
