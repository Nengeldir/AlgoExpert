const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3'

interface VideoListItem {
  id: string
  snippet: {
    title: string
    channelId: string
    channelTitle: string
    publishedAt: string
    thumbnails: { medium?: { url: string }; default?: { url: string } }
  }
  statistics: {
    viewCount?: string
  }
}

interface ChannelItem {
  id: string
  statistics: { subscriberCount?: string }
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

async function ytFetch<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`YouTube API ${res.status}: ${body.slice(0, 300)}`)
  }
  return res.json() as Promise<T>
}

// Unfiltered chart=mostPopular skews heavily toward gaming/music/reaction content, which
// doesn't land with the 30+, non-gamer audience this app targets. Restricting to these
// category IDs (Film & Animation, News & Politics, Education) keeps the pool relevant
// without needing the 100-quota-unit search endpoint.
const TARGET_CATEGORY_IDS = ['1', '25', '27']

async function fetchCategoryVideos(apiKey: string, categoryId: string): Promise<VideoListItem[]> {
  const videosUrl =
    `${YOUTUBE_API_BASE}/videos?part=snippet,statistics` +
    `&chart=mostPopular&maxResults=25&regionCode=US&videoCategoryId=${categoryId}&key=${apiKey}`

  const resp = await ytFetch<{ items?: VideoListItem[] }>(videosUrl)
  return resp.items ?? []
}

export async function fetchYoutubePair(apiKey: string): Promise<YoutubePair> {
  // chart=mostPopular (vs. search) is the reliable way to get active videos — 1 quota unit
  // per category vs 100 for search, and trending videos are actively accumulating views
  const perCategory = await Promise.all(
    TARGET_CATEGORY_IDS.map((id) => fetchCategoryVideos(apiKey, id)),
  )
  const items = perCategory.flat()

  if (items.length < 2) {
    throw new Error(
      `YouTube trending returned only ${items.length} videos across the education/news/film categories.`,
    )
  }

  // One video per channel
  const seen = new Set<string>()
  const unique = items.filter((item) => {
    if (seen.has(item.snippet.channelId)) return false
    seen.add(item.snippet.channelId)
    return true
  })

  // Fetch subscriber counts for the unique channels
  const channelIds = unique.map((i) => i.snippet.channelId).join(',')
  const channelsUrl = `${YOUTUBE_API_BASE}/channels?part=statistics&id=${channelIds}&key=${apiKey}`

  const channelsResp = await ytFetch<{ items?: ChannelItem[] }>(channelsUrl)
  const channelStats = new Map<string, number>()
  for (const ch of channelsResp.items ?? []) {
    if (ch.statistics.subscriberCount) {
      channelStats.set(ch.id, parseInt(ch.statistics.subscriberCount, 10))
    }
  }

  const candidates: VideoCandidate[] = []
  for (const item of unique) {
    const subscribers = channelStats.get(item.snippet.channelId)
    if (subscribers == null) continue
    candidates.push({
      videoId: item.id,
      videoTitle: item.snippet.title,
      channelId: item.snippet.channelId,
      channelTitle: item.snippet.channelTitle,
      thumbnail: item.snippet.thumbnails.medium?.url ?? item.snippet.thumbnails.default?.url ?? '',
      subscribers,
      viewCount: parseInt(item.statistics.viewCount ?? '0', 10),
      publishedAt: item.snippet.publishedAt,
    })
  }

  if (candidates.length < 2) {
    throw new Error(`Only ${candidates.length} channel(s) had subscriber data.`)
  }

  // Collect all pairs where both the channels (subscriber count) and the videos' current
  // traction (view count) are comparable — a lopsided view count makes the 24 h race
  // trivially predictable.
  const SUBSCRIBER_RATIO_THRESHOLD = 4
  const VIEW_RATIO_THRESHOLD = 2
  // Among acceptable pairs, only the closest few by view count are considered, so a
  // regeneration still varies but never lands on the loosest match the threshold allows.
  const CLOSEST_PAIR_POOL = 8

  const ratio = (a: number, b: number) => Math.max(a, b) / Math.max(Math.min(a, b), 1)

  const acceptablePairs: { pair: [VideoCandidate, VideoCandidate]; viewRatio: number }[] = []
  for (let i = 0; i < candidates.length - 1; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const viewRatio = ratio(candidates[i].viewCount, candidates[j].viewCount)
      if (
        ratio(candidates[i].subscribers, candidates[j].subscribers) <= SUBSCRIBER_RATIO_THRESHOLD &&
        viewRatio <= VIEW_RATIO_THRESHOLD
      ) {
        acceptablePairs.push({ pair: [candidates[i], candidates[j]], viewRatio })
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
  let fallback: [VideoCandidate, VideoCandidate] = [candidates[0], candidates[1]]
  let closest = Infinity
  for (let i = 0; i < candidates.length - 1; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const r = ratio(candidates[i].viewCount, candidates[j].viewCount)
      if (r < closest) {
        closest = r
        fallback = [candidates[i], candidates[j]]
      }
    }
  }

  return { videoA: fallback[0], videoB: fallback[1] }
}
