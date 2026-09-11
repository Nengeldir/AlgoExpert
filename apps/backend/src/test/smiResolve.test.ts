import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest'
import { initDb } from '../db/migrate'
import { resolveExpiredSmiQuestions } from '../services/smiService'

type Db = ReturnType<typeof initDb>

/**
 * The scenario that nearly lost a day of votes: the resolve job runs Friday 2026-09-11 at
 * 22:03 UTC. In Zurich that is already Saturday 00:03, so Friday's question is "past" —
 * but the provider has not published Friday's close yet. The old code read "past date,
 * no close" as "public holiday" and deleted the question with all its votes.
 */
const QUESTION_DATE = '2026-09-11' // Friday
const NOW = new Date('2026-09-11T22:03:00Z') // Saturday 00:03 in Zurich

const PREV_CLOSE = 12_000

function seedQuestion(db: Db, questionDate = QUESTION_DATE): number {
  const q = db
    .prepare(
      `INSERT INTO questions (title, description, option_a, option_b, deadline, published_at)
       VALUES ('SMI: Higher close today?', 'desc', 'Yes', 'No', ?, ?)`,
    )
    .run(`${questionDate}T10:00:00.000Z`, `${questionDate}T06:00:00.000Z`)
  db.prepare(
    `INSERT INTO smi_questions (question_date, question_id, prev_close, prev_date)
     VALUES (?, ?, ?, '2026-09-10')`,
  ).run(questionDate, q.lastInsertRowid, PREV_CLOSE)
  return Number(q.lastInsertRowid)
}

function seedVotes(db: Db, questionId: number, n: number) {
  for (let i = 0; i < n; i++) {
    const u = db
      .prepare(`INSERT INTO users (pseudonym, password_hash) VALUES (?, 'x')`)
      .run(`voter-${questionId}-${i}`)
    db.prepare(`INSERT INTO votes (user_id, question_id, choice) VALUES (?, ?, 'A')`).run(
      u.lastInsertRowid,
      questionId,
    )
  }
}

function seedPredictorRound(db: Db, questionId: number) {
  db.prepare(
    `INSERT INTO predictor_rounds
       (series, question_id, batch_key, round_index, committed_at, learning_rate,
        weights_json, votes_json, weight_a, weight_b, n_voters, n_manual,
        wm_prediction, mv_prediction)
     VALUES ('smi', ?, 'b', 7, '2026-09-11T10:00:00.000Z', 0.5, '{}', '{}', 1, 0, 0, 0, 'A', 'A')`,
  ).run(questionId)
}

/** Stub the Yahoo chart endpoint with one close per trading day (dates in YYYY-MM-DD). */
function mockFeed(closes: Record<string, number>) {
  const dates = Object.keys(closes).sort()
  // 10:00 Zurich on each day, so zurichDate() maps the timestamp back to the same date
  const timestamps = dates.map((d) => Math.floor(new Date(`${d}T08:00:00Z`).getTime() / 1000))
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        chart: {
          result: [
            {
              timestamp: timestamps,
              indicators: { quote: [{ close: dates.map((d) => closes[d]) }] },
            },
          ],
        },
      }),
    })),
  )
}

function questionExists(db: Db, id: number): boolean {
  return db.prepare('SELECT 1 FROM questions WHERE id = ?').get(id) !== undefined
}

function smiRowExists(db: Db, id: number): boolean {
  return db.prepare('SELECT 1 FROM smi_questions WHERE question_id = ?').get(id) !== undefined
}

function voteCount(db: Db, id: number): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM votes WHERE question_id = ?').get(id) as { n: number })
    .n
}

function groundTruth(db: Db, id: number): string | null {
  return (db.prepare('SELECT ground_truth FROM questions WHERE id = ?').get(id) as {
    ground_truth: string | null
  }).ground_truth
}

describe('resolveExpiredSmiQuestions — holiday cleanup', () => {
  let db: Db
  let log: string[]

  beforeEach(() => {
    db = initDb(':memory:')
    log = []
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    db.close()
  })

  it('waits when the feed has not caught up to the question date yet (provider delay)', async () => {
    const id = seedQuestion(db)
    seedVotes(db, id, 43)
    // Friday's close is not published yet; the feed ends on Thursday.
    mockFeed({ '2026-09-09': 11_950, '2026-09-10': PREV_CLOSE })

    await resolveExpiredSmiQuestions(db, (m) => log.push(m), NOW)

    expect(questionExists(db, id)).toBe(true)
    expect(smiRowExists(db, id)).toBe(true)
    expect(voteCount(db, id)).toBe(43)
    expect(groundTruth(db, id)).toBeNull()
    expect(log.join('\n')).toMatch(/waiting for the provider/)
    expect(log.join('\n')).not.toMatch(/removing/)
  })

  it('resolves normally once the delayed close arrives', async () => {
    const id = seedQuestion(db)
    seedVotes(db, id, 2)
    mockFeed({ '2026-09-10': PREV_CLOSE, '2026-09-11': PREV_CLOSE + 50 })

    await resolveExpiredSmiQuestions(db, (m) => log.push(m), NOW)

    expect(groundTruth(db, id)).toBe('A')
    expect(voteCount(db, id)).toBe(2)
    expect(
      db.prepare('SELECT COUNT(*) AS n FROM votes WHERE question_id = ? AND is_correct = 1').get(id),
    ).toEqual({ n: 2 })
  })

  it('never deletes a question that has votes, even when the feed shows a later trading day', async () => {
    const id = seedQuestion(db)
    seedVotes(db, id, 3)
    // Feed skips 09-11 entirely and already has Monday: looks like a genuine holiday.
    mockFeed({ '2026-09-10': PREV_CLOSE, '2026-09-14': PREV_CLOSE + 10 })

    await resolveExpiredSmiQuestions(db, (m) => log.push(m), new Date('2026-09-14T17:30:00Z'))

    expect(questionExists(db, id)).toBe(true)
    expect(smiRowExists(db, id)).toBe(true)
    expect(voteCount(db, id)).toBe(3)
    expect(groundTruth(db, id)).toBeNull()
    const text = log.join('\n')
    expect(text).toMatch(/3 vote\(s\)/)
    expect(text).toMatch(new RegExp(`POST /admin/questions/${id}/resolve`))
    expect(text).toMatch(new RegExp(`DELETE /admin/questions/${id}`))
    expect(text).not.toMatch(/removing/)
  })

  it('never deletes a question the predictor has committed a round for', async () => {
    const id = seedQuestion(db)
    seedPredictorRound(db, id)
    mockFeed({ '2026-09-10': PREV_CLOSE, '2026-09-14': PREV_CLOSE + 10 })

    await resolveExpiredSmiQuestions(db, (m) => log.push(m), new Date('2026-09-14T17:30:00Z'))

    expect(questionExists(db, id)).toBe(true)
    expect(smiRowExists(db, id)).toBe(true)
    expect(
      db.prepare('SELECT 1 FROM predictor_rounds WHERE question_id = ?').get(id),
    ).toBeDefined()
    expect(log.join('\n')).toMatch(/predictor round 7/)
    expect(log.join('\n')).not.toMatch(/removing/)
  })

  it('still removes an untouched question on a genuine holiday', async () => {
    const id = seedQuestion(db)
    mockFeed({ '2026-09-10': PREV_CLOSE, '2026-09-14': PREV_CLOSE + 10 })

    await resolveExpiredSmiQuestions(db, (m) => log.push(m), new Date('2026-09-14T17:30:00Z'))

    expect(questionExists(db, id)).toBe(false)
    expect(smiRowExists(db, id)).toBe(false)
    expect(log.join('\n')).toMatch(/removing/)
  })

  it('does not treat an empty feed as a holiday', async () => {
    const id = seedQuestion(db)
    // fetchRecentCloses throws on zero rows from every provider → resolution is skipped
    mockFeed({})

    await resolveExpiredSmiQuestions(db, (m) => log.push(m), NOW)

    expect(questionExists(db, id)).toBe(true)
    expect(log.join('\n')).toMatch(/fetch error during resolution/)
  })
})
