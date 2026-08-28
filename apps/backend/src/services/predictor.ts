import type BetterSqlite3 from 'better-sqlite3'
import { PUBLISH_HOUR, RACE_END_HOUR, zurichTimeUTC } from './schedule'
import {
  anytimeRegret,
  buildRoundVotes,
  etaForRound,
  followISuccess,
  growthRateFromEta,
  hedgeLossBound,
  optimalEta,
  predict,
  slidesGuarantee,
  tunedRegret,
  uniformWeights,
  updateWeights,
  wmMistakeBound,
  type Choice,
  type RoundVotes,
  type Weights,
} from './predictorEngine'

/**
 * Defaults for the lecture window: 31 Aug – 11 Sep 2026.
 *
 * The window opens on the Monday, not the Friday of the kickoff: the SMI question needs a
 * trading day, so nothing can be asked over the weekend anyway, and the later start gives
 * anyone who missed the kickoff the weekend to register.
 *
 * T = 22 questions: SMI runs weekdays only (10 of the 12 days), YouTube runs daily (12).
 * It is a *planned* horizon — the anytime learning rate does not depend on it, so a
 * YouTube pair you decide not to approve costs nothing but a slightly stale progress
 * counter in the view.
 */
const DEFAULT_SEASON_START = '2026-08-31'
const DEFAULT_SEASON_END = '2026-09-11'
const DEFAULT_T_PLANNED = 22
const DEFAULT_FILL_SEED = 20260831
/** Cohort size assumed only to seed the stored fallback rate before the pool is frozen. */
const ASSUMED_N = 30

export interface SeasonRow {
  id: number
  window_start: string
  window_end: string
  t_planned: number
  rate_mode: 'fixed' | 'anytime'
  learning_rate: number
  tie_break: Choice
  fill_seed: number
  n_experts: number | null
  expert_pool_json: string | null
  created_at: string
}

interface PredictorRoundRow {
  id: number
  question_id: number
  batch_key: string
  round_index: number
  committed_at: string
  learning_rate: number
  weights_json: string
  votes_json: string
  weight_a: number
  weight_b: number
  n_voters: number
  n_manual: number
  wm_prediction: Choice
  mv_prediction: Choice
  truth: Choice | null
  wm_correct: 0 | 1 | null
  mv_correct: 0 | 1 | null
  p_follow_i: number | null
  scored_at: string | null
}

interface EligibleQuestionRow {
  id: number
  title: string
  deadline: string
  ground_truth: Choice | null
  source: 'smi' | 'youtube' | 'manual'
}

export interface TickOutcome {
  committed: { question_id: number; round_index: number; prediction: Choice }[]
  scored: { question_id: number; round_index: number; truth: Choice; wm_correct: boolean }[]
}

/**
 * Parse a timestamp that may be ISO-8601 (our own writes) or SQLite's `datetime('now')`
 * output (`YYYY-MM-DD HH:MM:SS`, UTC, no zone marker), which `new Date()` would otherwise
 * read as local time.
 */
function parseTimestamp(value: string): number {
  return Date.parse(/[TZ]/.test(value) ? value : `${value.replace(' ', 'T')}Z`)
}

// ---------------------------------------------------------------------------
// Season config
// ---------------------------------------------------------------------------

/**
 * Read the frozen configuration, creating it from the defaults on first use.
 *
 * Auto-creating is deliberate: the row has to exist *before* the first prediction, and an
 * operator who forgets to POST it would otherwise silently get a season whose parameters
 * were first written after data existed.
 */
export function ensureSeason(db: BetterSqlite3.Database): SeasonRow {
  const existing = db.prepare('SELECT * FROM predictor_season WHERE id = 1').get() as
    | SeasonRow
    | undefined
  if (existing) return existing

  const startDate = process.env.PREDICTOR_SEASON_START ?? DEFAULT_SEASON_START
  const endDate = process.env.PREDICTOR_SEASON_END ?? DEFAULT_SEASON_END
  const tPlanned = parseInt(process.env.PREDICTOR_T_PLANNED ?? String(DEFAULT_T_PLANNED), 10)
  const fillSeed = parseInt(process.env.PREDICTOR_FILL_SEED ?? String(DEFAULT_FILL_SEED), 10)
  const rateMode = process.env.PREDICTOR_RATE_MODE === 'fixed' ? 'fixed' : 'anytime'

  db.prepare(
    `INSERT INTO predictor_season
       (id, window_start, window_end, t_planned, rate_mode, learning_rate, tie_break,
        fill_seed, n_experts, expert_pool_json, created_at)
     VALUES (1, ?, ?, ?, ?, ?, 'A', ?, NULL, NULL, ?)`,
  ).run(
    zurichTimeUTC(startDate, PUBLISH_HOUR),
    zurichTimeUTC(endDate, RACE_END_HOUR),
    tPlanned,
    rateMode,
    optimalEta(ASSUMED_N, tPlanned),
    fillSeed,
    new Date().toISOString(),
  )

  return db.prepare('SELECT * FROM predictor_season WHERE id = 1').get() as SeasonRow
}

export function seasonPool(season: SeasonRow): string[] {
  return season.expert_pool_json ? (JSON.parse(season.expert_pool_json) as string[]) : []
}

/** True once anything has been committed — after which the config must not change. */
export function seasonIsLocked(db: BetterSqlite3.Database): boolean {
  const row = db.prepare('SELECT COUNT(*) AS n FROM predictor_rounds').get() as { n: number }
  return row.n > 0
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

/**
 * The weights the predictor holds right now: uniform over the frozen pool, updated once
 * per *scored* batch in round order.
 *
 * Only scored batches move the weights — an unresolved question teaches the learner
 * nothing yet. If a question resolves late, the batches committed in the meantime keep the
 * weights they were committed with; the ledger is never rewritten, because a prediction
 * that silently improves after the fact is exactly what the guarantee rules out.
 */
export function replayWeights(db: BetterSqlite3.Database, pool: string[]): Weights {
  const rows = db
    .prepare(
      `SELECT batch_key, round_index, learning_rate, votes_json, truth
       FROM   predictor_rounds
       WHERE  scored_at IS NOT NULL
       ORDER BY round_index ASC`,
    )
    .all() as Pick<
    PredictorRoundRow,
    'batch_key' | 'round_index' | 'learning_rate' | 'votes_json' | 'truth'
  >[]

  let weights = uniformWeights(pool)

  for (const batch of groupByBatch(rows)) {
    weights = updateWeights(
      weights,
      batch.map((r) => ({
        votes: JSON.parse(r.votes_json) as RoundVotes,
        truth: r.truth as Choice,
      })),
      batch[0].learning_rate,
    )
  }

  return weights
}

function groupByBatch<T extends { batch_key: string }>(rows: T[]): T[][] {
  const batches: T[][] = []
  for (const row of rows) {
    const last = batches[batches.length - 1]
    if (last && last[0].batch_key === row.batch_key) last.push(row)
    else batches.push([row])
  }
  return batches
}

// ---------------------------------------------------------------------------
// The tick
// ---------------------------------------------------------------------------

/**
 * Commit predictions for batches whose voting has closed, and score batches whose
 * questions have all resolved. Both halves are idempotent, so this is safe on a tight
 * cron: the ledger rows are the state, and a second call in the same window does nothing.
 *
 * It is a cron tick rather than a hook on the resolve endpoint because the prediction has
 * to be recorded at the *deadline* — the moment voting closes and before any part of the
 * measured window has elapsed — which no request-driven code path is guaranteed to hit.
 */
export function tickPredictor(
  db: BetterSqlite3.Database,
  log: (msg: string) => void = console.log,
  now: Date = new Date(),
): TickOutcome {
  const season = ensureSeason(db)
  const nowIso = now.toISOString()
  const outcome: TickOutcome = { committed: [], scored: [] }

  commitDueBatches(db, season, nowIso, outcome, log)
  scoreResolvedBatches(db, outcome, log)

  if (outcome.committed.length === 0 && outcome.scored.length === 0) {
    log('[predictor] nothing to commit or score')
  }
  return outcome
}

function commitDueBatches(
  db: BetterSqlite3.Database,
  season: SeasonRow,
  nowIso: string,
  outcome: TickOutcome,
  log: (msg: string) => void,
): void {
  const due = db
    .prepare(
      `SELECT q.id, q.title, q.deadline, q.ground_truth,
              CASE WHEN s.question_id IS NOT NULL THEN 'smi'
                   WHEN y.question_id IS NOT NULL THEN 'youtube'
                   ELSE 'manual' END AS source
       FROM   questions q
       LEFT JOIN smi_questions       s ON s.question_id = q.id
       LEFT JOIN youtube_suggestions y ON y.question_id = q.id
       LEFT JOIN predictor_rounds    p ON p.question_id = q.id
       WHERE  p.id IS NULL
         AND  q.deadline <= ?
         AND  q.deadline >= ?
         AND  q.deadline <= ?
       ORDER BY q.deadline ASC, q.id ASC`,
    )
    .all(nowIso, season.window_start, season.window_end) as EligibleQuestionRow[]

  if (due.length === 0) return

  let pool = seasonPool(season)

  for (const batch of groupByDeadline(due)) {
    // Freeze the expert pool against the *end* of the window, not the first deadline.
    // Everyone holding an account when the window closes is an expert for the whole
    // season: days before they registered are filled like any other missing vote, so a
    // late joiner is simply an expert who guessed early on. N is therefore fixed across
    // the entire run — decided late, but never moving mid-run, which is what ln(N) in the
    // learning rate and in the bound requires.
    //
    // This holds only if no round is committed while registrations are still open: the
    // first tick freezes the pool and the guard below never recomputes it. The predictor
    // cron must therefore stay paused until the window has closed — see cron-setup.md.
    if (pool.length === 0) {
      pool = freezeExpertPool(db, season.window_end)
      if (pool.length === 0) {
        log(`[predictor] batch ${batch[0].deadline} skipped — no registered users to run over`)
        continue
      }
      db.prepare(
        'UPDATE predictor_season SET n_experts = ?, expert_pool_json = ? WHERE id = 1',
      ).run(pool.length, JSON.stringify(pool))
      log(`[predictor] expert pool frozen at ${pool.length} expert(s)`)
    }

    const weights = replayWeights(db, pool)
    const maxIndex = (
      db.prepare('SELECT COALESCE(MAX(round_index), 0) AS m FROM predictor_rounds').get() as {
        m: number
      }
    ).m
    // The rate is pinned to the last round in the batch so `t` counts questions, matching
    // the horizon T the bounds are quoted against.
    const eta = etaForRound(
      season.rate_mode,
      season.learning_rate,
      pool.length,
      maxIndex + batch.length,
    )
    const weightsJson = JSON.stringify(weights)
    const committedAt = new Date().toISOString()

    const insert = db.prepare(
      `INSERT INTO predictor_rounds
         (question_id, batch_key, round_index, committed_at, learning_rate, weights_json,
          votes_json, weight_a, weight_b, n_voters, n_manual, wm_prediction, mv_prediction)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )

    db.transaction(() => {
      batch.forEach((question, offset) => {
        const cast = new Map(
          (
            db
              .prepare(
                `SELECT u.pseudonym, v.choice
                 FROM   votes v
                 JOIN   users u ON u.id = v.user_id
                 WHERE  v.question_id = ?`,
              )
              .all(question.id) as { pseudonym: string; choice: Choice }[]
          ).map((r) => [r.pseudonym, r.choice] as const),
        )

        const votes = buildRoundVotes(pool, cast, season.fill_seed, question.id)
        const prediction = predict(weights, votes, season.tie_break)
        const roundIndex = maxIndex + offset + 1

        insert.run(
          question.id,
          question.deadline,
          roundIndex,
          committedAt,
          eta,
          weightsJson,
          JSON.stringify(votes),
          prediction.weightA,
          prediction.weightB,
          prediction.nVoters,
          prediction.nManual,
          prediction.weightedMajority,
          prediction.plainMajority,
        )

        outcome.committed.push({
          question_id: question.id,
          round_index: roundIndex,
          prediction: prediction.weightedMajority,
        })
        log(
          `[predictor] round ${roundIndex} committed for question ${question.id}: ` +
            `WM=${prediction.weightedMajority} (${(prediction.weightA * 100).toFixed(1)}% on A), ` +
            `${prediction.nManual}/${prediction.nVoters} real votes`,
        )
      })
    })()
  }
}

function scoreResolvedBatches(
  db: BetterSqlite3.Database,
  outcome: TickOutcome,
  log: (msg: string) => void,
): void {
  const pending = db
    .prepare(
      `SELECT p.*, q.ground_truth AS question_truth
       FROM   predictor_rounds p
       JOIN   questions q ON q.id = p.question_id
       WHERE  p.scored_at IS NULL
       ORDER BY p.round_index ASC`,
    )
    .all() as (PredictorRoundRow & { question_truth: Choice | null })[]

  if (pending.length === 0) return

  const update = db.prepare(
    `UPDATE predictor_rounds
     SET    truth = ?, wm_correct = ?, mv_correct = ?, p_follow_i = ?, scored_at = ?
     WHERE  id = ?`,
  )

  for (const batch of groupByBatch(pending)) {
    // A batch scores as a unit: its questions were predicted together, so until every one
    // of them has a ground truth the learner has not finished the round.
    if (batch.some((row) => row.question_truth === null)) continue

    const scoredAt = new Date().toISOString()

    db.transaction(() => {
      for (const row of batch) {
        const truth = row.question_truth as Choice
        const votes = JSON.parse(row.votes_json) as RoundVotes
        const weights = JSON.parse(row.weights_json) as Weights
        const wmCorrect = row.wm_prediction === truth
        const mvCorrect = row.mv_prediction === truth

        update.run(
          truth,
          wmCorrect ? 1 : 0,
          mvCorrect ? 1 : 0,
          followISuccess(weights, votes, truth),
          scoredAt,
          row.id,
        )

        outcome.scored.push({
          question_id: row.question_id,
          round_index: row.round_index,
          truth,
          wm_correct: wmCorrect,
        })
        log(
          `[predictor] round ${row.round_index} scored: truth=${truth}, ` +
            `WM ${wmCorrect ? 'correct' : 'wrong'}`,
        )
      }
    })()
  }
}

function freezeExpertPool(db: BetterSqlite3.Database, deadline: string): string[] {
  const cutoff = Date.parse(deadline)
  return (
    db.prepare('SELECT pseudonym, created_at FROM users ORDER BY id ASC').all() as {
      pseudonym: string
      created_at: string
    }[]
  )
    .filter((u) => parseTimestamp(u.created_at) <= cutoff)
    .map((u) => u.pseudonym)
}

function groupByDeadline(rows: EligibleQuestionRow[]): EligibleQuestionRow[][] {
  const batches: EligibleQuestionRow[][] = []
  for (const row of rows) {
    const last = batches[batches.length - 1]
    if (last && last[0].deadline === row.deadline) last.push(row)
    else batches.push([row])
  }
  return batches
}

// ---------------------------------------------------------------------------
// The read model
// ---------------------------------------------------------------------------

export interface PredictorRoundView {
  round_index: number
  batch_key: string
  question_id: number
  title: string
  source: string
  deadline: string
  committed_at: string
  learning_rate: number
  weight_a: number
  weight_b: number
  n_voters: number
  n_manual: number
  wm_prediction: Choice
  mv_prediction: Choice
  truth: Choice | null
  wm_correct: 0 | 1 | null
  mv_correct: 0 | 1 | null
  p_follow_i: number | null
  scored_at: string | null
}

export interface PredictorSeriesPoint {
  round_index: number
  label: string
  /** Cumulative rates after this round — everything is "as of round r" */
  wm: number
  follow_i: number
  plain_majority: number
  best_expert: number
  mean_expert: number
}

export interface PredictorExpertView {
  pseudonym: string
  answered: number
  manual_answered: number
  correct: number
  rate_over_all_rounds: number
  rate_over_answered: number
  final_weight_share: number
}

export interface PredictorView {
  season: {
    window_start: string
    window_end: string
    t_planned: number
    rate_mode: 'fixed' | 'anytime'
    tie_break: Choice
    fill_seed: number
    n_experts: number | null
    /** The rate in force for the next update, and the slides' G it corresponds to */
    current_eta: number
    current_growth_rate: number
    locked: boolean
  }
  pool: string[]
  rounds: PredictorRoundView[]
  series: PredictorSeriesPoint[]
  weight_history: { round_index: number; shares: Record<string, number> }[]
  experts: PredictorExpertView[]
  headline: {
    n_committed: number
    n_scored: number
    n_pending: number
    wm_correct: number
    wm_rate: number
    follow_i_rate: number
    plain_majority_rate: number
    best_expert_rate: number
    mean_expert_rate: number
    median_expert_rate: number
    manual_participation: number
  }
  bounds: {
    /** Follow-i, the randomized learner the Hedge bound covers */
    follow_i_loss: number
    best_expert_loss: number
    hedge_loss_bound: number
    hedge_holds: boolean
    regret_term: number
    regret_label: string
    /** Weighted Majority, the deterministic learner */
    wm_mistakes: number
    best_expert_mistakes: number
    wm_mistake_bound: number
    wm_holds: boolean
    /** The slides' success-rate form, so the live view and analysis/run.py agree */
    slides_guarantee: number
    slides_holds: boolean
    /** True when the bound is vacuous at this D and should be described as such */
    not_yet_informative: boolean
  }
}

export function buildPredictorView(db: BetterSqlite3.Database): PredictorView {
  const season = ensureSeason(db)
  const pool = seasonPool(season)

  const rounds = db
    .prepare(
      `SELECT p.round_index, p.batch_key, p.question_id, p.committed_at, p.learning_rate,
              p.weights_json, p.votes_json, p.weight_a, p.weight_b, p.n_voters, p.n_manual,
              p.wm_prediction, p.mv_prediction, p.truth, p.wm_correct, p.mv_correct,
              p.p_follow_i, p.scored_at,
              q.title, q.deadline,
              CASE WHEN s.question_id IS NOT NULL THEN 'smi'
                   WHEN y.question_id IS NOT NULL THEN 'youtube'
                   ELSE 'manual' END AS source
       FROM   predictor_rounds p
       JOIN   questions q ON q.id = p.question_id
       LEFT JOIN smi_questions       s ON s.question_id = q.id
       LEFT JOIN youtube_suggestions y ON y.question_id = q.id
       ORDER BY p.round_index ASC`,
    )
    .all() as (PredictorRoundView & { weights_json: string; votes_json: string })[]

  const scored = rounds.filter((r) => r.scored_at !== null && r.truth !== null)
  const nScored = scored.length
  const nExperts = pool.length

  // Per-expert running tallies, walked in round order so the cumulative series and the
  // final leaderboard come from one pass over the same data.
  const correct: Record<string, number> = Object.fromEntries(pool.map((p) => [p, 0]))
  const answered: Record<string, number> = Object.fromEntries(pool.map((p) => [p, 0]))
  const manualAnswered: Record<string, number> = Object.fromEntries(pool.map((p) => [p, 0]))

  const series: PredictorSeriesPoint[] = []
  let wmHits = 0
  let mvHits = 0
  let followISum = 0

  scored.forEach((round, i) => {
    const votes = JSON.parse(round.votes_json) as RoundVotes
    for (const [pseudonym, vote] of Object.entries(votes)) {
      if (answered[pseudonym] === undefined) continue
      answered[pseudonym] += 1
      if (vote.manual) manualAnswered[pseudonym] += 1
      if (vote.choice === round.truth) correct[pseudonym] += 1
    }

    wmHits += round.wm_correct === 1 ? 1 : 0
    mvHits += round.mv_correct === 1 ? 1 : 0
    followISum += round.p_follow_i ?? 0

    const d = i + 1
    const rates = pool.map((p) => correct[p] / d)
    series.push({
      round_index: round.round_index,
      label: round.title,
      wm: wmHits / d,
      follow_i: followISum / d,
      plain_majority: mvHits / d,
      best_expert: rates.length ? Math.max(...rates) : 0,
      mean_expert: mean(rates),
    })
  })

  const finalWeights = replayWeights(db, pool)
  const experts: PredictorExpertView[] = pool
    .map((pseudonym) => ({
      pseudonym,
      answered: answered[pseudonym],
      manual_answered: manualAnswered[pseudonym],
      correct: correct[pseudonym],
      rate_over_all_rounds: nScored ? correct[pseudonym] / nScored : 0,
      rate_over_answered: answered[pseudonym] ? correct[pseudonym] / answered[pseudonym] : 0,
      final_weight_share: finalWeights[pseudonym] ?? 0,
    }))
    .sort(
      (a, b) =>
        b.final_weight_share - a.final_weight_share || a.pseudonym.localeCompare(b.pseudonym),
    )

  const expertRates = experts.map((e) => e.rate_over_all_rounds)
  const bestExpertRate = expertRates.length ? Math.max(...expertRates) : 0
  const bestExpertCorrect = experts.length ? Math.max(...experts.map((e) => e.correct)) : 0
  const bestExpertLoss = nScored - bestExpertCorrect

  const currentEta = etaForRound(
    season.rate_mode,
    season.learning_rate,
    Math.max(2, nExperts),
    Math.max(1, nScored),
  )
  const followILoss = nScored - followISum
  const wmMistakes = nScored - wmHits

  const regretTerm =
    season.rate_mode === 'anytime'
      ? anytimeRegret(nExperts, nScored)
      : tunedRegret(nExperts, season.t_planned)
  const hedgeBound =
    season.rate_mode === 'anytime'
      ? bestExpertLoss + regretTerm
      : hedgeLossBound(bestExpertLoss, nExperts, season.learning_rate, season.t_planned)
  const wmBound = wmMistakeBound(bestExpertLoss, nExperts, currentEta)
  const slides = slidesGuarantee(growthRateFromEta(currentEta), bestExpertRate, nExperts, nScored)

  const totalCells = nExperts * nScored
  const manualCells = Object.values(manualAnswered).reduce((s, n) => s + n, 0)

  return {
    season: {
      window_start: season.window_start,
      window_end: season.window_end,
      t_planned: season.t_planned,
      rate_mode: season.rate_mode,
      tie_break: season.tie_break,
      fill_seed: season.fill_seed,
      n_experts: season.n_experts,
      current_eta: currentEta,
      current_growth_rate: growthRateFromEta(currentEta),
      locked: rounds.length > 0,
    },
    pool,
    rounds: rounds.map(({ weights_json: _w, votes_json: _v, ...rest }) => rest),
    series,
    weight_history: rounds.map((r) => ({
      round_index: r.round_index,
      shares: JSON.parse(r.weights_json) as Record<string, number>,
    })),
    experts,
    headline: {
      n_committed: rounds.length,
      n_scored: nScored,
      n_pending: rounds.length - nScored,
      wm_correct: wmHits,
      wm_rate: nScored ? wmHits / nScored : 0,
      follow_i_rate: nScored ? followISum / nScored : 0,
      plain_majority_rate: nScored ? mvHits / nScored : 0,
      best_expert_rate: bestExpertRate,
      mean_expert_rate: mean(expertRates),
      median_expert_rate: median(expertRates),
      manual_participation: totalCells ? manualCells / totalCells : 0,
    },
    bounds: {
      follow_i_loss: followILoss,
      best_expert_loss: bestExpertLoss,
      hedge_loss_bound: hedgeBound,
      hedge_holds: followILoss <= hedgeBound + 1e-9,
      regret_term: regretTerm,
      regret_label:
        season.rate_mode === 'anytime'
          ? 'sqrt(2 D ln N)  (anytime rate)'
          : 'ln(N)/eta + eta*T/8  (fixed rate)',
      wm_mistakes: wmMistakes,
      best_expert_mistakes: bestExpertLoss,
      wm_mistake_bound: wmBound,
      wm_holds: wmMistakes <= wmBound + 1e-9,
      slides_guarantee: slides,
      slides_holds: nScored === 0 || (nScored ? followISum / nScored : 0) >= slides,
      // Either the regret term swamps the horizon or the slides' form has gone negative:
      // in both cases the bound is true but vacuous, and saying so is more honest than
      // presenting a guarantee that promises nothing.
      not_yet_informative: nScored === 0 || regretTerm >= nScored || slides <= 0,
    },
  }
}

function mean(values: number[]): number {
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}
