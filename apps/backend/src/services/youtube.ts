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
  /** Average views per hour since publication — the pairing signal, not persisted. */
  viewsPerHour: number
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
 * ~56 units of the 10,000/day quota, so it can grow a lot further before cost is a consideration.
 *
 * The trade-off is editorial: this list, not an algorithm, decides what participants see. That is
 * deliberate — it is the only knob that reliably controls register — but it means the pool
 * inherits whatever bias the list has, so keep it broad across topic and language.
 *
 * Two kinds of channel are kept off deliberately, both of which would otherwise pass the numeric
 * bar: advocacy outlets and think tanks (whose editorial line is the product rather than an
 * incidental slant), and high-volume scripted content mills. Neither is a quality judgment the
 * filters can make, so it has to live here.
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
  { id: 'UCNNEMxGKV1LsKZRt4vaIbvw', name: 'ZDF MAGAZIN ROYALE' },
  { id: 'UCpHHy2MtCnrGaE7mirEhRvg', name: 'Terra Xplore' },

  // English-language current affairs and documentary.
  //
  // Chosen for *cadence and scale*, not just topic. The obvious picks — Veritasium, Kurzgesagt,
  // Johnny Harris, RealLifeLore — are dead weight here on both counts: they upload every 10–26
  // days, so they are usually absent from a 7-day window entirely, and when they do land their
  // videos sit at 1–5M views against 10–250k for the German documentary strands, so no pair
  // clears the view-ratio gate. Everything below was measured (Aug 2026) to upload at least
  // every ~10 days and to sit in the same 13k–350k band as the German channels.
  //
  // English news broadcasters are included where their German equivalents were not: the German
  // side already carries three daily news sources (SRF News, ZDFheute, phoenix), so more German
  // news would crowd the pool rather than widen it.
  { id: 'UCLXo7UDZvByw2ixzpQCufnA', name: 'Vox' },
  { id: 'UCxcrzzhQDj5zKJbXfIscCtg', name: 'ABC News In-depth' },
  { id: 'UCTrQ7HXWRRxr7OsOtodr2_w', name: 'Channel 4 News' },
  { id: 'UC_Lnb8ZHqqgLbp-7hltuT9w', name: 'CNA Insider' },
  { id: 'UC-eegKVWEgBCa4OzjnK_PtA', name: 'TLDR News EU' },
  { id: 'UCSMqateX8OA2s1wsOR2EgJA', name: 'TLDR News' },
  { id: 'UC0p5jTq6Xx_DosDFxVXnWaQ', name: 'The Economist' },
  { id: 'UCT3v6vL2H5HK4loLMc8pmCw', name: 'VisualPolitik EN' },
  { id: 'UCknLrEdhRCp1aegoMqRaCZg', name: 'DW News' },
  { id: 'UC16niRr50-MSBwiO3YDb3RA', name: 'BBC News' },
  { id: 'UCoMdktPbSTixAyNGwb-UYkQ', name: 'Sky News' },
  { id: 'UC6ZFN9Tx6xh-skXCuRHCDpQ', name: 'PBS NewsHour' },
  { id: 'UCZaT_X_mc0BI-djXOlfhqWQ', name: 'VICE News' },
  // English-language science and economics explainer
  { id: 'UCZYTClx2T1of7BRZ86-8fow', name: 'SciShow' },
  { id: 'UCciQ8wFcVoIIMi-lfu8-cjQ', name: 'Anton Petrov' },
  { id: 'UC1yNl2E66ZzKApQdRuTQ4tw', name: 'Sabine Hossenfelder' },
  { id: 'UCYNbYGl89UUowy8oXkipC-Q', name: 'Dr. Becky' },
  { id: 'UCoxcjq-8xIDTYp3uz647V5A', name: 'Numberphile' },
  { id: 'UC1LpsuAUaKoMzzJSEt5WImw', name: 'Asianometry' },
  { id: 'UCZ4AMrDcNrfy3X6nsU8-rPg', name: 'Economics Explained' },
  { id: 'UCCKpicnIwBP3VPxBAZWDeNA', name: 'Money & Macro' },
  { id: 'UCb72Gn5LXaLEcsOuPKGfQOg', name: 'DW Planet A' },
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
      const viewsPerHour = viewCount / ageHours
      if (viewsPerHour < MIN_VIEWS_PER_HOUR) continue

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
        viewsPerHour,
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

  // Two gates, each answering a different question.
  //
  // VIEW_RATIO is about what the voter *sees*: the question text quotes both view counts, and a
  // pair reading "12k vs 900k" looks decided before the race starts, whatever the true odds.
  //
  // VELOCITY_RATIO is about what the race actually *measures* — the change in views over 12 h.
  // Average views/hour estimates that directly. This replaced a subscriber-ratio gate, which was
  // only ever a crude proxy for the same thing and priced out every cross-language pair: the
  // English channels are an order of magnitude larger by subscriber count than the Swiss and
  // German ones, so a 10× subscriber bound rejected them no matter how close the actual race was.
  // Two videos moving at a similar rate make a close race whether their channels are 90k subs or
  // 12M, and that is the only property worth gating on.
  const VIEW_RATIO_THRESHOLD = 3
  const VELOCITY_RATIO_THRESHOLD = 3
  // Among acceptable pairs, only the closest are considered, so a regeneration still varies but
  // never lands on the loosest match the thresholds allow.
  //
  // Sized by measurement, because closeness costs almost nothing here: on a typical pool (312
  // acceptable pairs, 46 channels) widening 15 → 40 moved the worst velocity ratio in the pool
  // from 1.05 to only 1.16, while the channels reachable at all went from 19 to 36. Below ~40
  // the same handful of near-identical pairs win every regeneration and the suggestions visibly
  // repeat. On a quiet day there may be fewer than 40 pairs in total, which is harmless — the
  // slice just takes what exists.
  const CLOSEST_PAIR_POOL = 40

  const ratio = (a: number, b: number) => Math.max(a, b) / Math.max(Math.min(a, b), 1)

  const acceptablePairs: { pair: [VideoCandidate, VideoCandidate]; velocityRatio: number }[] = []
  for (let i = 0; i < unique.length - 1; i++) {
    for (let j = i + 1; j < unique.length; j++) {
      const velocityRatio = ratio(unique[i].viewsPerHour, unique[j].viewsPerHour)
      if (
        ratio(unique[i].viewCount, unique[j].viewCount) <= VIEW_RATIO_THRESHOLD &&
        velocityRatio <= VELOCITY_RATIO_THRESHOLD
      ) {
        acceptablePairs.push({ pair: [unique[i], unique[j]], velocityRatio })
      }
    }
  }

  if (acceptablePairs.length > 0) {
    acceptablePairs.sort((a, b) => a.velocityRatio - b.velocityRatio)
    const pool = acceptablePairs.slice(0, CLOSEST_PAIR_POOL)
    const [bestA, bestB] = pool[Math.floor(Math.random() * pool.length)].pair
    return { videoA: bestA, videoB: bestB }
  }

  // No pair satisfied both thresholds — fall back to the closest race available, ranked on
  // velocity for the same reason the gate above uses it: it is what the 12 h window measures.
  let fallback: [VideoCandidate, VideoCandidate] = [unique[0], unique[1]]
  let closest = Infinity
  for (let i = 0; i < unique.length - 1; i++) {
    for (let j = i + 1; j < unique.length; j++) {
      const r = ratio(unique[i].viewsPerHour, unique[j].viewsPerHour)
      if (r < closest) {
        closest = r
        fallback = [unique[i], unique[j]]
      }
    }
  }

  return { videoA: fallback[0], videoB: fallback[1] }
}
