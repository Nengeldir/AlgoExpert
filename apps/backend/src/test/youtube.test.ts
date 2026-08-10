import { describe, it, afterEach, expect, vi } from 'vitest'
import { fetchYoutubePair, parseIsoDurationSeconds, CURATED_CHANNELS } from '../services/youtube'

const LONG_FORM = 'PT12M30S'
const SHORT = 'PT48S'

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()

interface StubVideo {
  channel: string
  views: number
  duration?: string
  publishedAt?: string
  live?: string
  subscribers?: number
}

/**
 * Stub the three-call roster pipeline: channels.list → playlistItems.list → videos.list.
 *
 * `videos` is keyed by video id; each entry names the channel it belongs to. Any channel not
 * listed in `videos` still resolves but returns an empty uploads playlist.
 */
function mockYoutube(videos: Record<string, StubVideo>, opts: { deadPlaylists?: string[] } = {}) {
  const calls = { channels: 0, playlists: 0, videos: 0 }
  const batchSizes: number[] = []

  const byChannel = new Map<string, string[]>()
  for (const [videoId, v] of Object.entries(videos)) {
    byChannel.set(v.channel, [...(byChannel.get(v.channel) ?? []), videoId])
  }

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const params = new URL(url).searchParams

      if (url.includes('/channels?')) {
        calls.channels++
        const ids = params.get('id')!.split(',')
        batchSizes.push(ids.length)
        if (ids.length > 50) return { ok: false, status: 400, text: async () => 'invalidFilters' }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: ids.map((id) => ({
              id,
              statistics: {
                subscriberCount: String(
                  Object.values(videos).find((v) => v.channel === id)?.subscribers ?? 500_000,
                ),
              },
              contentDetails: { relatedPlaylists: { uploads: 'UU' + id.slice(2) } },
            })),
          }),
        }
      }

      if (url.includes('/playlistItems?')) {
        calls.playlists++
        const playlistId = params.get('playlistId')!
        const channelId = 'UC' + playlistId.slice(2)
        if (opts.deadPlaylists?.includes(channelId)) {
          return { ok: false, status: 404, text: async () => 'playlistNotFound' }
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: (byChannel.get(channelId) ?? []).map((videoId) => ({
              contentDetails: {
                videoId,
                videoPublishedAt: videos[videoId].publishedAt ?? hoursAgo(10),
              },
            })),
          }),
        }
      }

      // videos.list
      calls.videos++
      const ids = params.get('id')!.split(',')
      batchSizes.push(ids.length)
      if (ids.length > 50) return { ok: false, status: 400, text: async () => 'invalidFilters' }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          items: ids
            .filter((id) => videos[id])
            .map((id) => ({
              id,
              snippet: {
                title: `Title ${id}`,
                channelId: videos[id].channel,
                channelTitle: `Channel ${videos[id].channel}`,
                publishedAt: videos[id].publishedAt ?? hoursAgo(10),
                liveBroadcastContent: videos[id].live ?? 'none',
                thumbnails: { medium: { url: `https://img/${id}.jpg` } },
              },
              statistics: { viewCount: String(videos[id].views) },
              contentDetails: { duration: videos[id].duration ?? LONG_FORM },
            })),
        }),
      }
    }),
  )

  return { calls, batchSizes }
}

const chA = CURATED_CHANNELS[0].id
const chB = CURATED_CHANNELS[1].id
const chC = CURATED_CHANNELS[2].id

describe('parseIsoDurationSeconds', () => {
  it.each([
    ['PT48S', 48],
    ['PT3M', 180],
    ['PT12M30S', 750],
    ['PT1H2M3S', 3723],
    ['P1DT2H', 93600],
    ['P0D', 0], // live broadcast
    ['garbage', 0],
  ])('%s -> %i s', (iso, expected) => {
    expect(parseIsoDurationSeconds(iso)).toBe(expected)
  })
})

describe('CURATED_CHANNELS', () => {
  it('holds only well-formed, unique channel ids', () => {
    const ids = CURATED_CHANNELS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^UC[A-Za-z0-9_-]{22}$/)
  })
})

describe('fetchYoutubePair', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns a pair drawn from the curated roster', async () => {
    mockYoutube({
      v1: { channel: chA, views: 50_000 },
      v2: { channel: chB, views: 55_000 },
    })

    const pair = await fetchYoutubePair('test-key')

    expect([pair.videoA.videoId, pair.videoB.videoId].sort()).toEqual(['v1', 'v2'])
    expect(CURATED_CHANNELS.map((c) => c.id)).toContain(pair.videoA.channelId)
    expect(CURATED_CHANNELS.map((c) => c.id)).toContain(pair.videoB.channelId)
  })

  it('never picks a Short when long-form videos are available', async () => {
    // The Shorts have far closer view counts, which the pairing would otherwise prefer.
    mockYoutube({
      short1: { channel: chA, views: 90_000, duration: SHORT },
      short2: { channel: chB, views: 90_001, duration: SHORT },
      long1: { channel: chA, views: 40_000, publishedAt: hoursAgo(20) },
      long2: { channel: chC, views: 70_000 },
    })

    const pair = await fetchYoutubePair('test-key')

    expect([pair.videoA.videoId, pair.videoB.videoId].sort()).toEqual(['long1', 'long2'])
  })

  it('prefers a channel’s long-form upload over a newer Short from the same channel', async () => {
    mockYoutube({
      newShort: { channel: chA, views: 100_000, duration: SHORT, publishedAt: hoursAgo(1) },
      olderLong: { channel: chA, views: 60_000, publishedAt: hoursAgo(30) },
      other: { channel: chB, views: 60_000 },
    })

    const pair = await fetchYoutubePair('test-key')

    expect([pair.videoA.videoId, pair.videoB.videoId].sort()).toEqual(['olderLong', 'other'])
  })

  it('skips livestreams and premieres', async () => {
    mockYoutube({
      stream: { channel: chA, views: 80_000, live: 'live' },
      premiere: { channel: chB, views: 80_000, live: 'upcoming' },
      ondemand1: { channel: chC, views: 30_000 },
      ondemand2: { channel: CURATED_CHANNELS[3].id, views: 32_000 },
    })

    const pair = await fetchYoutubePair('test-key')

    expect([pair.videoA.videoId, pair.videoB.videoId].sort()).toEqual(['ondemand1', 'ondemand2'])
  })

  it('drops videos moving too slowly to produce a meaningful 12 h delta', async () => {
    // 500 views over 100 h is 5 views/h — the race would be decided by noise.
    mockYoutube({
      stale: { channel: chA, views: 500, publishedAt: hoursAgo(100) },
      fast1: { channel: chB, views: 40_000, publishedAt: hoursAgo(10) },
      fast2: { channel: chC, views: 45_000, publishedAt: hoursAgo(10) },
    })

    const pair = await fetchYoutubePair('test-key')

    expect([pair.videoA.videoId, pair.videoB.videoId]).not.toContain('stale')
  })

  it('ignores uploads older than the recency window', async () => {
    mockYoutube({
      ancient: { channel: chA, views: 5_000_000, publishedAt: hoursAgo(24 * 40) },
      fresh1: { channel: chB, views: 40_000 },
      fresh2: { channel: chC, views: 45_000 },
    })

    const pair = await fetchYoutubePair('test-key')

    expect([pair.videoA.videoId, pair.videoB.videoId].sort()).toEqual(['fresh1', 'fresh2'])
  })

  it('widens the window rather than failing when the roster has been quiet', async () => {
    // Nothing inside 7 days; two qualifying uploads inside the 21-day fallback. They need
    // large totals to clear the velocity floor at that age — which is the point: an older
    // video only qualifies if it is still genuinely busy.
    mockYoutube({
      old1: { channel: chA, views: 2_000_000, publishedAt: hoursAgo(24 * 12) },
      old2: { channel: chB, views: 2_400_000, publishedAt: hoursAgo(24 * 14) },
    })

    const pair = await fetchYoutubePair('test-key')

    expect([pair.videoA.videoId, pair.videoB.videoId].sort()).toEqual(['old1', 'old2'])
  })

  it('survives a channel whose uploads playlist is unreadable', async () => {
    mockYoutube(
      {
        dead: { channel: chA, views: 40_000 },
        alive1: { channel: chB, views: 40_000 },
        alive2: { channel: chC, views: 45_000 },
      },
      { deadPlaylists: [chA] },
    )

    const pair = await fetchYoutubePair('test-key')

    expect([pair.videoA.videoId, pair.videoB.videoId].sort()).toEqual(['alive1', 'alive2'])
  })

  it('batches channel and video lookups so the 50-id limit is never exceeded', async () => {
    const videos: Record<string, StubVideo> = {}
    for (const [i, c] of CURATED_CHANNELS.entries()) {
      videos[`v${i}`] = { channel: c.id, views: 40_000 + i * 100 }
    }
    const { batchSizes, calls } = mockYoutube(videos)

    const pair = await fetchYoutubePair('test-key')

    expect(pair.videoA.videoId).not.toBe(pair.videoB.videoId)
    expect(Math.max(...batchSizes)).toBeLessThanOrEqual(50)
    // One playlist read per roster channel — the cheap path this design exists for.
    expect(calls.playlists).toBe(CURATED_CHANNELS.length)
  })

  it('rejects when nothing on the roster qualifies', async () => {
    mockYoutube({
      s1: { channel: chA, views: 90_000, duration: SHORT },
      s2: { channel: chB, views: 90_000, duration: SHORT },
    })

    await expect(fetchYoutubePair('test-key')).rejects.toThrow(
      /Only 0 curated video\(s\) qualified/,
    )
  })

  it('propagates non-404 errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 403, text: async () => 'quotaExceeded' })),
    )

    await expect(fetchYoutubePair('test-key')).rejects.toThrow(/YouTube API 403/)
  })
})
