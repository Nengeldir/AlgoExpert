import { describe, it, afterEach, expect, vi } from 'vitest'
import { fetchYoutubePair, parseIsoDurationSeconds } from '../services/youtube'

const NOT_FOUND_BODY = JSON.stringify({
  error: { code: 404, message: 'Requested entity was not found.', status: 'NOT_FOUND' },
})

const LONG_FORM = 'PT12M30S'
const SHORT = 'PT48S'

function video(id: string, channelId: string, views: number, duration = LONG_FORM) {
  return {
    id,
    snippet: {
      title: `Title ${id}`,
      channelId,
      channelTitle: `Channel ${channelId}`,
      publishedAt: '2026-08-08T06:00:00.000Z',
      thumbnails: { medium: { url: `https://img/${id}.jpg` } },
    },
    statistics: { viewCount: String(views) },
    contentDetails: { duration },
  }
}

/**
 * Stub fetch so the trending chart 404s for `deadCategories` (as YouTube does for
 * categories whose chart it has retired) and serves videos for the rest.
 */
function mockYoutube(
  deadCategories: string[],
  videosPerCategory = 2,
  durationFor: (categoryId: string, index: number) => string = () => LONG_FORM,
) {
  const channelBatchSizes: number[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.includes('/videos?')) {
        const categoryId = new URL(url).searchParams.get('videoCategoryId')!
        if (deadCategories.includes(categoryId)) {
          return { ok: false, status: 404, text: async () => NOT_FOUND_BODY }
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: Array.from({ length: videosPerCategory }, (_, i) =>
              video(
                `v${categoryId}_${i}`,
                `c${categoryId}_${i}`,
                100_000 + i,
                durationFor(categoryId, i),
              ),
            ),
          }),
        }
      }
      // channels?part=statistics — real API answers 400 above 50 ids
      const ids = new URL(url).searchParams.get('id')!.split(',')
      channelBatchSizes.push(ids.length)
      if (ids.length > 50) {
        return { ok: false, status: 400, text: async () => 'invalidFilters' }
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          items: ids.map((id) => ({ id, statistics: { subscriberCount: '500000' } })),
        }),
      }
    }),
  )
  return channelBatchSizes
}

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

describe('fetchYoutubePair', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('still returns a pair when one category chart has been retired', async () => {
    mockYoutube(['28'])

    const pair = await fetchYoutubePair('test-key')

    expect(pair.videoA.videoId).not.toBe(pair.videoB.videoId)
    expect(pair.videoA.videoId).not.toMatch(/^v28/)
    expect(pair.videoB.videoId).not.toMatch(/^v28/)
  })

  it('never picks a Short when long-form videos are available', async () => {
    // Two long-form videos in the pool, everything else a Short — including Shorts with
    // view counts far closer to each other, which the pairing would otherwise prefer.
    mockYoutube([], 10, (categoryId, i) => (categoryId === '25' && i < 2 ? LONG_FORM : SHORT))

    const pair = await fetchYoutubePair('test-key')

    expect([pair.videoA.videoId, pair.videoB.videoId].sort()).toEqual(['v25_0', 'v25_1'])
  })

  it('prefers a channel’s long-form video over its Short', async () => {
    // Same channel id for both entries in each category: the Short comes first in the
    // chart, so a filter running after the per-channel dedupe would lose the long-form one.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/videos?')) {
          const categoryId = new URL(url).searchParams.get('videoCategoryId')!
          return {
            ok: true,
            status: 200,
            json: async () => ({
              items: [
                video(`short_${categoryId}`, `chan_${categoryId}`, 100_000, SHORT),
                video(`long_${categoryId}`, `chan_${categoryId}`, 100_000, LONG_FORM),
              ],
            }),
          }
        }
        const ids = new URL(url).searchParams.get('id')!.split(',')
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: ids.map((id) => ({ id, statistics: { subscriberCount: '500000' } })),
          }),
        }
      }),
    )

    const pair = await fetchYoutubePair('test-key')

    expect(pair.videoA.videoId).toMatch(/^long_/)
    expect(pair.videoB.videoId).toMatch(/^long_/)
  })

  it('rejects when the chart is nothing but Shorts and live streams', async () => {
    mockYoutube([], 10, (_categoryId, i) => (i % 2 === 0 ? SHORT : 'P0D'))

    await expect(fetchYoutubePair('test-key')).rejects.toThrow(/only 0 non-Shorts videos \(of 30\)/)
  })

  it('batches channel lookups so the 50-id limit is never exceeded', async () => {
    const channelBatchSizes = mockYoutube([], 25)

    const pair = await fetchYoutubePair('test-key')

    expect(pair.videoA.subscribers).toBe(500_000)
    expect(channelBatchSizes.reduce((a, b) => a + b, 0)).toBe(75)
    expect(Math.max(...channelBatchSizes)).toBeLessThanOrEqual(50)
  })

  it('fails when every category chart has been retired', async () => {
    mockYoutube(['22', '25', '28'])

    await expect(fetchYoutubePair('test-key')).rejects.toThrow(/only 0 non-Shorts videos \(of 0\)/)
  })

  it('propagates non-404 errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 403, text: async () => 'quotaExceeded' })),
    )

    await expect(fetchYoutubePair('test-key')).rejects.toThrow(/YouTube API 403/)
  })
})
