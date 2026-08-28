import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildTestApp, ADMIN_TOKEN, setAdminToken } from './helpers'
import {
  buildPredictorView,
  ensureSeason,
  replayWeights,
  seasonPool,
  tickPredictor,
} from '../services/predictor'

// 12:00 Europe/Zurich in CEST is 10:00 UTC — the deadline anchor for a question that day.
const DAY_1_CLOSE = '2026-08-28T10:00:00.000Z'
const DAY_2_CLOSE = '2026-08-31T10:00:00.000Z'
const AFTER_DAY_1 = new Date('2026-08-28T12:00:00.000Z')
const AFTER_DAY_2 = new Date('2026-08-31T12:00:00.000Z')

let app: FastifyInstance

function addUser(pseudonym: string, createdAt = '2026-08-01T00:00:00.000Z'): number {
  return app.db
    .prepare('INSERT INTO users (pseudonym, email, password_hash, created_at) VALUES (?, ?, ?, ?)')
    .run(pseudonym, `${pseudonym}@example.com`, 'x', createdAt).lastInsertRowid as number
}

function addQuestion(deadline: string, title = 'Q'): number {
  return app.db
    .prepare(
      `INSERT INTO questions (title, description, option_a, option_b, deadline, published_at)
       VALUES (?, 'd', 'Up', 'Down', ?, ?)`,
    )
    .run(title, deadline, '2026-08-28T06:00:00.000Z').lastInsertRowid as number
}

function addVote(userId: number, questionId: number, choice: 'A' | 'B'): void {
  app.db
    .prepare(
      `INSERT INTO votes (user_id, question_id, choice, voted_at) VALUES (?, ?, ?, '2026-08-28T09:00:00.000Z')`,
    )
    .run(userId, questionId, choice)
}

function resolve(questionId: number, truth: 'A' | 'B'): void {
  app.db
    .prepare(`UPDATE questions SET ground_truth = ?, resolved_at = ? WHERE id = ?`)
    .run(truth, '2026-08-28T22:00:00.000Z', questionId)
}

const silent = () => {}

beforeEach(async () => {
  process.env.PREDICTOR_SEASON_START = '2026-08-28'
  process.env.PREDICTOR_SEASON_END = '2026-09-11'
  process.env.PREDICTOR_T_PLANNED = '26'
  process.env.PREDICTOR_FILL_SEED = '20260828'
  delete process.env.PREDICTOR_RATE_MODE
  setAdminToken(ADMIN_TOKEN)

  app = buildTestApp()
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

describe('season configuration', () => {
  it('defaults to the 28 Aug – 11 Sep window with the anytime rate', () => {
    const season = ensureSeason(app.db)

    expect(season.window_start).toBe('2026-08-28T06:00:00.000Z') // 08:00 CEST
    expect(season.window_end).toBe('2026-09-11T22:00:00.000Z') // 24:00 CEST
    expect(season.rate_mode).toBe('anytime')
    expect(season.t_planned).toBe(26)
    expect(season.n_experts).toBeNull() // pool not frozen until voting first closes
  })

  it('can be changed before the first prediction and not after', async () => {
    const before = await app.inject({
      method: 'POST',
      url: '/admin/predictor/season',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      payload: { rate_mode: 'fixed', learning_rate: 0.8 },
    })
    expect(before.statusCode).toBe(200)
    expect(before.json().season.rate_mode).toBe('fixed')

    const user = addUser('Ada')
    const q = addQuestion(DAY_1_CLOSE)
    addVote(user, q, 'A')
    tickPredictor(app.db, silent, AFTER_DAY_1)

    const after = await app.inject({
      method: 'POST',
      url: '/admin/predictor/season',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      payload: { learning_rate: 0.1 },
    })
    expect(after.statusCode).toBe(409)
    expect(after.json().error).toMatch(/frozen/i)
  })
})

describe('committing predictions', () => {
  it('waits for the deadline — an open question is never predicted', () => {
    const user = addUser('Ada')
    const q = addQuestion(DAY_1_CLOSE)
    addVote(user, q, 'A')

    const outcome = tickPredictor(app.db, silent, new Date('2026-08-28T09:00:00.000Z'))

    expect(outcome.committed).toHaveLength(0)
    expect(buildPredictorView(app.db).rounds).toHaveLength(0)
  })

  it('commits the weighted majority once voting has closed', () => {
    const ada = addUser('Ada')
    const bob = addUser('Bob')
    const cy = addUser('Cy')
    const q = addQuestion(DAY_1_CLOSE)
    addVote(ada, q, 'A')
    addVote(bob, q, 'A')
    addVote(cy, q, 'B')

    const outcome = tickPredictor(app.db, silent, AFTER_DAY_1)

    expect(outcome.committed).toEqual([{ question_id: q, round_index: 1, prediction: 'A' }])

    const round = buildPredictorView(app.db).rounds[0]
    expect(round.wm_prediction).toBe('A')
    expect(round.mv_prediction).toBe('A')
    expect(round.weight_a).toBeCloseTo(2 / 3, 10)
    expect(round.n_voters).toBe(3)
    expect(round.n_manual).toBe(3)
    expect(round.truth).toBeNull() // committed before the truth exists
  })

  it('is idempotent — a second tick commits nothing new', () => {
    const ada = addUser('Ada')
    const q = addQuestion(DAY_1_CLOSE)
    addVote(ada, q, 'A')

    tickPredictor(app.db, silent, AFTER_DAY_1)
    const second = tickPredictor(app.db, silent, AFTER_DAY_1)

    expect(second.committed).toHaveLength(0)
    expect(buildPredictorView(app.db).rounds).toHaveLength(1)
  })

  it('freezes the pool against the end of the window, so a late joiner still counts', () => {
    const ada = addUser('Ada')
    addUser('Bob')
    const q1 = addQuestion(DAY_1_CLOSE)
    addVote(ada, q1, 'A')

    // Cy registers after the first question closed but while the window is still open.
    // Because the pool is frozen against window_end, Cy is an expert for the whole season
    // and the days before they registered are filled like any other missing vote.
    const cy = addUser('Cy', '2026-08-29T00:00:00.000Z')
    const q2 = addQuestion(DAY_2_CLOSE)
    addVote(cy, q2, 'B')

    // One run once everyone has registered — the mode the predictor cron is set up for.
    tickPredictor(app.db, silent, AFTER_DAY_2)

    const view = buildPredictorView(app.db)
    expect(view.pool).toEqual(['Ada', 'Bob', 'Cy'])
    expect(view.season.n_experts).toBe(3)
    expect(view.rounds[0].n_voters).toBe(3) // day 1 counts Cy, filled
    expect(view.rounds[0].n_manual).toBe(1) // only Ada actually voted that day
  })

  it('locks the pool at the first tick — running it early excludes later registrations', () => {
    addUser('Ada')
    const q1 = addQuestion(DAY_1_CLOSE)
    tickPredictor(app.db, silent, AFTER_DAY_1)

    addUser('Cy', '2026-08-29T00:00:00.000Z')
    addQuestion(DAY_2_CLOSE)
    resolve(q1, 'A')
    tickPredictor(app.db, silent, AFTER_DAY_2)

    // The operational constraint this pins down: the predictor cron must stay paused
    // until registrations are closed, because the first tick freezes the pool for good.
    expect(buildPredictorView(app.db).pool).toEqual(['Ada'])
  })

  it('fills an absent expert with a reproducible coin flip', () => {
    const ada = addUser('Ada')
    addUser('Bob') // never votes
    const q = addQuestion(DAY_1_CLOSE)
    addVote(ada, q, 'A')

    tickPredictor(app.db, silent, AFTER_DAY_1)

    const round = buildPredictorView(app.db).rounds[0]
    expect(round.n_voters).toBe(2)
    expect(round.n_manual).toBe(1) // Ada real, Bob filled
    expect(round.weight_a + round.weight_b).toBeCloseTo(1, 10)
  })

  it('ignores questions outside the season window', () => {
    const ada = addUser('Ada')
    const early = addQuestion('2026-08-20T10:00:00.000Z', 'before the window')
    const late = addQuestion('2026-09-20T10:00:00.000Z', 'after the window')
    addVote(ada, early, 'A')
    addVote(ada, late, 'A')

    tickPredictor(app.db, silent, new Date('2026-09-30T00:00:00.000Z'))

    expect(buildPredictorView(app.db).rounds).toHaveLength(0)
  })
})

describe('simultaneous questions form one batch', () => {
  it('predicts both from the same weights and updates only once both resolve', () => {
    const ada = addUser('Ada')
    const bob = addUser('Bob')
    const smi = addQuestion(DAY_1_CLOSE, 'SMI')
    const yt = addQuestion(DAY_1_CLOSE, 'YouTube')

    addVote(ada, smi, 'A')
    addVote(bob, smi, 'B')
    addVote(ada, yt, 'B')
    addVote(bob, yt, 'A')

    tickPredictor(app.db, silent, AFTER_DAY_1)

    const rounds = app.db
      .prepare(
        'SELECT weights_json, batch_key, round_index FROM predictor_rounds ORDER BY round_index',
      )
      .all() as { weights_json: string; batch_key: string; round_index: number }[]

    expect(rounds).toHaveLength(2)
    expect(rounds[0].batch_key).toBe(rounds[1].batch_key)
    // The second question must not have been predicted with weights that already knew the
    // first question's answer — the truths are revealed together.
    expect(rounds[0].weights_json).toBe(rounds[1].weights_json)

    // Only half the batch resolves: nothing may be scored yet.
    resolve(smi, 'A')
    expect(tickPredictor(app.db, silent, AFTER_DAY_1).scored).toHaveLength(0)

    resolve(yt, 'A')
    expect(tickPredictor(app.db, silent, AFTER_DAY_1).scored).toHaveLength(2)

    // Ada was right once and wrong once, Bob likewise — they stay level.
    const weights = replayWeights(app.db, seasonPool(ensureSeason(app.db)))
    expect(weights.Ada).toBeCloseTo(0.5, 10)
    expect(weights.Bob).toBeCloseTo(0.5, 10)
  })
})

describe('scoring', () => {
  it('scores a resolved round and moves the weights toward whoever was right', () => {
    const ada = addUser('Ada')
    const bob = addUser('Bob')
    const q = addQuestion(DAY_1_CLOSE)
    addVote(ada, q, 'A')
    addVote(bob, q, 'B')

    tickPredictor(app.db, silent, AFTER_DAY_1)
    resolve(q, 'A')
    const outcome = tickPredictor(app.db, silent, AFTER_DAY_1)

    expect(outcome.scored).toHaveLength(1)
    expect(outcome.scored[0].truth).toBe('A')

    const view = buildPredictorView(app.db)
    expect(view.rounds[0].truth).toBe('A')
    expect(view.rounds[0].p_follow_i).toBeCloseTo(0.5, 10) // weights were still uniform
    expect(view.headline.n_scored).toBe(1)

    const ada_ = view.experts.find((e) => e.pseudonym === 'Ada')!
    const bob_ = view.experts.find((e) => e.pseudonym === 'Bob')!
    expect(ada_.correct).toBe(1)
    expect(bob_.correct).toBe(0)
    expect(ada_.final_weight_share).toBeGreaterThan(bob_.final_weight_share)
  })

  it('scores each round exactly once', () => {
    const ada = addUser('Ada')
    const q = addQuestion(DAY_1_CLOSE)
    addVote(ada, q, 'A')

    tickPredictor(app.db, silent, AFTER_DAY_1)
    resolve(q, 'A')
    tickPredictor(app.db, silent, AFTER_DAY_1)
    const again = tickPredictor(app.db, silent, AFTER_DAY_1)

    expect(again.scored).toHaveLength(0)
    expect(buildPredictorView(app.db).headline.n_scored).toBe(1)
  })

  it('builds a cumulative series with one point per scored round', () => {
    const ada = addUser('Ada')
    const bob = addUser('Bob')

    const q1 = addQuestion(DAY_1_CLOSE, 'day 1')
    addVote(ada, q1, 'A')
    addVote(bob, q1, 'B')
    tickPredictor(app.db, silent, AFTER_DAY_1)
    resolve(q1, 'A')
    tickPredictor(app.db, silent, AFTER_DAY_1)

    const q2 = addQuestion(DAY_2_CLOSE, 'day 2')
    addVote(ada, q2, 'A')
    addVote(bob, q2, 'B')
    tickPredictor(app.db, silent, AFTER_DAY_2)
    resolve(q2, 'A')
    tickPredictor(app.db, silent, AFTER_DAY_2)

    const view = buildPredictorView(app.db)
    expect(view.series).toHaveLength(2)
    expect(view.series[1].wm).toBe(1) // Ada carried the weight into round 2
    expect(view.series[1].best_expert).toBe(1)
    expect(view.series[1].follow_i).toBeGreaterThan(view.series[0].follow_i)
    expect(view.headline.wm_rate).toBe(1)
  })
})

describe('the ledger is append-only', () => {
  it('refuses to delete a question the predictor has committed on', async () => {
    const ada = addUser('Ada')
    const q = addQuestion(DAY_1_CLOSE)
    addVote(ada, q, 'A')
    tickPredictor(app.db, silent, AFTER_DAY_1)

    const res = await app.inject({
      method: 'DELETE',
      url: `/admin/questions/${q}`,
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    })

    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatch(/round 1/)
    expect(app.db.prepare('SELECT id FROM questions WHERE id = ?').get(q)).toBeDefined()
  })

  it('still allows deleting a question that has not been predicted yet', async () => {
    const q = addQuestion(DAY_1_CLOSE)

    const res = await app.inject({
      method: 'DELETE',
      url: `/admin/questions/${q}`,
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    })

    expect(res.statusCode).toBe(204)
  })
})

describe('routes', () => {
  it('requires the admin token', async () => {
    for (const url of ['/admin/predictor', '/admin/predictor/season']) {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(403)
    }
    expect((await app.inject({ method: 'POST', url: '/admin/predictor/tick' })).statusCode).toBe(
      403,
    )
  })

  it('ticks and reports over HTTP', async () => {
    const ada = addUser('Ada')
    const q = addQuestion(DAY_1_CLOSE)
    addVote(ada, q, 'A')
    // The route uses the real clock, so nothing is due yet in 2026-08 terms; commit
    // directly and check the read model is served correctly.
    tickPredictor(app.db, silent, AFTER_DAY_1)
    resolve(q, 'A')
    tickPredictor(app.db, silent, AFTER_DAY_1)

    const tick = await app.inject({
      method: 'POST',
      url: '/admin/predictor/tick',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    })
    expect(tick.statusCode).toBe(200)
    expect(tick.json().ok).toBe(true)

    const view = await app.inject({
      method: 'GET',
      url: '/admin/predictor',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    })
    expect(view.statusCode).toBe(200)

    const body = view.json()
    expect(body.headline.n_scored).toBe(1)
    expect(body.rounds[0].wm_prediction).toBe('A')
    expect(body.season.locked).toBe(true)
    expect(body.bounds.hedge_holds).toBe(true)
    expect(body.bounds.wm_holds).toBe(true)
  })

  it('reports an empty but well-formed view before the window opens', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/predictor',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    })

    const body = res.json()
    expect(body.rounds).toEqual([])
    expect(body.series).toEqual([])
    expect(body.experts).toEqual([])
    expect(body.pool).toEqual([])
    expect(body.headline.n_scored).toBe(0)
    expect(body.season.locked).toBe(false)
    expect(body.bounds.not_yet_informative).toBe(true)
  })
})
