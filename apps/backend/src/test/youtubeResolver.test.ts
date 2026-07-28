import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest'
import { initDb } from '../db/migrate'
import { resolveExpiredYoutubeQuestions } from '../services/youtubeResolver'

const VIDEO_A = 'vidA'
const VIDEO_B = 'vidB'

// Baselines captured when the pair was suggested
const BASE_A = 677_900
const BASE_B = 322_300

function seedRace(db: ReturnType<typeof initDb>, deadline: string) {
  const q = db
    .prepare(
      `INSERT INTO questions (title, description, option_a, option_b, deadline)
       VALUES ('YouTube 24 h Race', 'desc', 'A', 'B', ?)`,
    )
    .run(deadline)

  db.prepare(
    `INSERT INTO youtube_suggestions
       (suggested_date, video_a_id, video_a_title, video_a_channel, video_a_views,
        video_b_id, video_b_title, video_b_channel, video_b_views, approved, question_id)
     VALUES ('2026-07-27', ?, 'A title', 'A chan', ?, ?, 'B title', 'B chan', ?, 1, ?)`,
  ).run(VIDEO_A, BASE_A, VIDEO_B, BASE_B, q.lastInsertRowid)

  return Number(q.lastInsertRowid)
}

// Stub the YouTube statistics endpoint with the given current view counts
function mockViews(curA: number, curB: number) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        items: [
          { id: VIDEO_A, statistics: { viewCount: String(curA) } },
          { id: VIDEO_B, statistics: { viewCount: String(curB) } },
        ],
      }),
    })),
  )
}

describe('resolveExpiredYoutubeQuestions', () => {
  let db: ReturnType<typeof initDb>

  beforeEach(() => {
    db = initDb(':memory:')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    db.close()
  })

  it('picks up a question whose ISO deadline has passed earlier the same UTC day', async () => {
    // Regression: deadline is stored as "...T14:20:48.123Z" but datetime('now') yields
    // "... 14:52:01". Comparing them as raw text made 'T' > ' ' win, so the question was
    // invisible to the resolver until the UTC date itself rolled over.
    const deadline = new Date(Date.now() - 30 * 60 * 1000).toISOString()
    const id = seedRace(db, deadline)

    mockViews(BASE_A + 193_200, BASE_B + 342_925)

    const log: string[] = []
    await resolveExpiredYoutubeQuestions(db, 'test-key', (m) => log.push(m))

    const q = db.prepare('SELECT ground_truth FROM questions WHERE id = ?').get(id) as {
      ground_truth: string | null
    }
    expect(q.ground_truth).toBe('B')
  })

  it('compares view gain, not absolute view count', async () => {
    const id = seedRace(db, new Date(Date.now() - 60_000).toISOString())

    // A ends far ahead in absolute views (871k vs 665k) but gained less (+193k vs +343k)
    mockViews(871_100, 665_225)

    await resolveExpiredYoutubeQuestions(db, 'test-key', () => {})

    const q = db.prepare('SELECT ground_truth FROM questions WHERE id = ?').get(id) as {
      ground_truth: string | null
    }
    expect(q.ground_truth).toBe('B')
  })

  it('leaves a question alone while its deadline is still in the future', async () => {
    const id = seedRace(db, new Date(Date.now() + 60 * 60 * 1000).toISOString())

    mockViews(BASE_A + 1000, BASE_B + 5000)

    await resolveExpiredYoutubeQuestions(db, 'test-key', () => {})

    const q = db.prepare('SELECT ground_truth FROM questions WHERE id = ?').get(id) as {
      ground_truth: string | null
    }
    expect(q.ground_truth).toBeNull()
  })
})
