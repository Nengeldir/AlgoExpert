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

export async function fetchYoutubePair(apiKey: string): Promise<YoutubePair> {
  // chart=mostPopular is the reliable way to get active videos — no conflicting filters,
  // 1 quota unit vs 100 for search, and trending videos are actively accumulating views
  const videosUrl =
    `${YOUTUBE_API_BASE}/videos?part=snippet,statistics` +
    `&chart=mostPopular&maxResults=50&regionCode=US&key=${apiKey}`

  const videosResp = await ytFetch<{ items?: VideoListItem[] }>(videosUrl)
  const items = videosResp.items ?? []

  if (items.length < 2) {
    throw new Error(`YouTube trending returned only ${items.length} videos.`)
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

  // Sort by subscriber count then collect all adjacent pairs within a 4× subscriber ratio.
  // Picking randomly from this pool gives variety across regenerations while keeping channels comparable.
  candidates.sort((a, b) => a.subscribers - b.subscribers)

  const RATIO_THRESHOLD = 4
  const acceptablePairs: [VideoCandidate, VideoCandidate][] = []

  for (let i = 0; i < candidates.length - 1; i++) {
    const ratio = candidates[i + 1].subscribers / Math.max(candidates[i].subscribers, 1)
    if (ratio <= RATIO_THRESHOLD) {
      acceptablePairs.push([candidates[i], candidates[i + 1]])
    }
  }

  // Fall back to all adjacent pairs if the threshold filtered everything out
  const pool =
    acceptablePairs.length > 0
      ? acceptablePairs
      : candidates
          .slice(0, -1)
          .map((c, i) => [c, candidates[i + 1]] as [VideoCandidate, VideoCandidate])

  const [bestA, bestB] = pool[Math.floor(Math.random() * pool.length)]

  return { videoA: bestA, videoB: bestB }
}
