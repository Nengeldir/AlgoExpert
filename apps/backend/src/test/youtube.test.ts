import { describe, it, afterEach, expect, vi } from 'vitest'
import { fetchYoutubePair } from '../services/youtube'

const NOT_FOUND_BODY = JSON.stringify({
  error: { code: 404, message: 'Requested entity was not found.', status: 'NOT_FOUND' },
})

function video(id: string, channelId: string, views: number) {
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
  }
}

/**
 * Stub fetch so the trending chart 404s for `deadCategories` (as YouTube does for
 * categories whose chart it has retired) and serves videos for the rest.
 */
function mockYoutube(deadCategories: string[], videosPerCategory = 2) {
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
              video(`v${categoryId}_${i}`, `c${categoryId}_${i}`, 100_000 + i),
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

  it('batches channel lookups so the 50-id limit is never exceeded', async () => {
    const channelBatchSizes = mockYoutube([], 25)

    const pair = await fetchYoutubePair('test-key')

    expect(pair.videoA.subscribers).toBe(500_000)
    expect(channelBatchSizes.reduce((a, b) => a + b, 0)).toBe(75)
    expect(Math.max(...channelBatchSizes)).toBeLessThanOrEqual(50)
  })

  it('fails when every category chart has been retired', async () => {
    mockYoutube(['1', '25', '28'])

    await expect(fetchYoutubePair('test-key')).rejects.toThrow(/only 0 videos/)
  })

  it('propagates non-404 errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 403, text: async () => 'quotaExceeded' })),
    )

    await expect(fetchYoutubePair('test-key')).rejects.toThrow(/YouTube API 403/)
  })
})
