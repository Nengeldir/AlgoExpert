import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest'
import { initDb } from '../db/migrate'
import { runYoutubeRaceTick } from '../services/youtubeResolver'

const VIDEO_A = 'vidA'
const VIDEO_B = 'vidB'

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE

interface RaceTimes {
  raceStartsAt: string
  raceEndsAt: string
}

function seedRace(db: ReturnType<typeof initDb>, times: RaceTimes) {
  const q = db
    .prepare(
      `INSERT INTO questions
         (title, description, option_a, option_b, deadline, published_at, race_starts_at, race_ends_at, option_a_views, option_b_views)
       VALUES ('YouTube 12 h Race', 'desc', 'A', 'B', ?, ?, ?, ?, 677900, 322300)`,
    )
    .run(times.raceStartsAt, times.raceStartsAt, times.raceStartsAt, times.raceEndsAt)

  db.prepare(
    `INSERT INTO youtube_suggestions
       (suggested_date, video_a_id, video_a_title, video_a_channel, video_a_views,
        video_b_id, video_b_title, video_b_channel, video_b_views, approved, question_id)
     VALUES ('2026-07-27', ?, 'A title', 'A chan', 677900, ?, 'B title', 'B chan', 322300, 1, ?)`,
  ).run(VIDEO_A, VIDEO_B, q.lastInsertRowid)

  return Number(q.lastInsertRowid)
}

/** Stub the YouTube statistics endpoint, returning a new pair of counts on each call. */
function mockViewSequence(...pairs: [number, number][]) {
  let call = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const [a, b] = pairs[Math.min(call++, pairs.length - 1)]
      return {
        ok: true,
        json: async () => ({
          items: [
            { id: VIDEO_A, statistics: { viewCount: String(a) } },
            { id: VIDEO_B, statistics: { viewCount: String(b) } },
          ],
        }),
      }
    }),
  )
}

function readQuestion(db: ReturnType<typeof initDb>, id: number) {
  return db.prepare('SELECT ground_truth FROM questions WHERE id = ?').get(id) as {
    ground_truth: string | null
  }
}

function readSuggestion(db: ReturnType<typeof initDb>) {
  return db
    .prepare(
      `SELECT race_start_views_a, race_start_views_b, race_start_at,
              race_end_views_a, race_end_views_b, race_end_at
       FROM youtube_suggestions`,
    )
    .get() as Record<string, number | string | null>
}

describe('runYoutubeRaceTick', () => {
  let db: ReturnType<typeof initDb>

  beforeEach(() => {
    db = initDb(':memory:')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    db.close()
  })

  it('takes no baseline while voting is still open', async () => {
    const id = seedRace(db, {
      raceStartsAt: new Date(Date.now() + HOUR).toISOString(),
      raceEndsAt: new Date(Date.now() + 13 * HOUR).toISOString(),
    })
    mockViewSequence([700_000, 400_000])

    await runYoutubeRaceTick(db, 'test-key', () => {})

    // The measurement window must not start before voting closes
    expect(readSuggestion(db).race_start_views_a).toBeNull()
    expect(readQuestion(db, id).ground_truth).toBeNull()
  })

  it('snapshots the baseline once voting closes, without resolving yet', async () => {
    const id = seedRace(db, {
      raceStartsAt: new Date(Date.now() - MINUTE).toISOString(),
      raceEndsAt: new Date(Date.now() + 12 * HOUR).toISOString(),
    })
    mockViewSequence([700_000, 400_000])

    await runYoutubeRaceTick(db, 'test-key', () => {})

    const s = readSuggestion(db)
    expect(s.race_start_views_a).toBe(700_000)
    expect(s.race_start_views_b).toBe(400_000)
    expect(s.race_start_at).not.toBeNull()
    expect(readQuestion(db, id).ground_truth).toBeNull()
  })

  it('does not re-snapshot the baseline on a later tick', async () => {
    seedRace(db, {
      raceStartsAt: new Date(Date.now() - MINUTE).toISOString(),
      raceEndsAt: new Date(Date.now() + 12 * HOUR).toISOString(),
    })
    mockViewSequence([700_000, 400_000], [999_999, 999_999])

    await runYoutubeRaceTick(db, 'test-key', () => {})
    await runYoutubeRaceTick(db, 'test-key', () => {})

    expect(readSuggestion(db).race_start_views_a).toBe(700_000)
  })

  it('resolves on gain measured across the window, not absolute view count', async () => {
    const id = seedRace(db, {
      raceStartsAt: new Date(Date.now() - MINUTE).toISOString(),
      raceEndsAt: new Date(Date.now() + 12 * HOUR).toISOString(),
    })
    // Baseline, then the closing counts: A ends far ahead in absolute views
    // (871k vs 665k) but gained less over the window (+193k vs +343k)
    mockViewSequence([677_900, 322_300], [871_100, 665_225])

    await runYoutubeRaceTick(db, 'test-key', () => {})

    // Move the finish line into the past so the next tick closes the race
    db.prepare('UPDATE questions SET race_ends_at = ? WHERE id = ?').run(
      new Date(Date.now() - 1000).toISOString(),
      id,
    )
    await runYoutubeRaceTick(db, 'test-key', () => {})

    expect(readQuestion(db, id).ground_truth).toBe('B')
    const s = readSuggestion(db)
    expect(s.race_end_views_a).toBe(871_100)
    expect(s.race_end_views_b).toBe(665_225)
    expect(s.race_end_at).not.toBeNull()
  })

  it('scores votes against the resolved winner', async () => {
    const id = seedRace(db, {
      raceStartsAt: new Date(Date.now() - 13 * HOUR).toISOString(),
      raceEndsAt: new Date(Date.now() - MINUTE).toISOString(),
    })
    db.prepare(
      `INSERT INTO users (id, pseudonym, password_hash) VALUES (1, 'alice', 'x'), (2, 'bob', 'x')`,
    ).run()
    db.prepare(
      `INSERT INTO votes (user_id, question_id, choice) VALUES (1, ?, 'A'), (2, ?, 'B')`,
    ).run(id, id)

    mockViewSequence([677_900, 322_300], [871_100, 665_225])

    // First tick captures the baseline, second closes the race
    await runYoutubeRaceTick(db, 'test-key', () => {})
    await runYoutubeRaceTick(db, 'test-key', () => {})

    const votes = db.prepare('SELECT user_id, is_correct FROM votes ORDER BY user_id').all() as {
      user_id: number
      is_correct: number
    }[]
    expect(votes).toEqual([
      { user_id: 1, is_correct: 0 },
      { user_id: 2, is_correct: 1 },
    ])
  })

  it('will not resolve a race whose baseline was never captured', async () => {
    const id = seedRace(db, {
      raceStartsAt: new Date(Date.now() - 13 * HOUR).toISOString(),
      raceEndsAt: new Date(Date.now() - MINUTE).toISOString(),
    })
    // Baseline fetch fails, closing fetch would succeed — resolving anyway would silently
    // measure from the suggestion-time views instead of the real window start
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 503 })),
    )

    const log: string[] = []
    await runYoutubeRaceTick(db, 'test-key', (m) => log.push(m))

    expect(readQuestion(db, id).ground_truth).toBeNull()
    expect(log.join('\n')).toContain('baseline failed')
  })
})
