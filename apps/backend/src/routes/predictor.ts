import type { FastifyInstance, FastifyReply } from 'fastify'
import { requireAdmin } from '../plugins/authenticate'
import {
  SERIES,
  buildPredictorView,
  ensureSeason,
  parseSeries,
  seasonIsLocked,
  tickPredictor,
  type SeasonRow,
  type Series,
} from '../services/predictor'
import { optimalEta } from '../services/predictorEngine'

interface SeriesQuery {
  series?: string
}

interface SeasonBody {
  window_start?: string
  window_end?: string
  t_planned?: number
  rate_mode?: 'fixed' | 'anytime'
  learning_rate?: number
  tie_break?: 'A' | 'B'
  fill_seed?: number
}

const SERIES_QUERY_SCHEMA = {
  type: 'object',
  properties: { series: { type: 'string', enum: [...SERIES] } },
}

/**
 * Which predictor a request is about. SMI and YouTube are separate runs, so every read
 * and every configuration write names one; `smi` is the default so old links keep working.
 */
function seriesOf(query: SeriesQuery, reply: FastifyReply): Series | null {
  if (query.series === undefined) return 'smi'
  const series = parseSeries(query.series)
  if (series === null) {
    void reply.status(400).send({ error: `series must be one of ${SERIES.join(', ')}` })
  }
  return series
}

export async function predictorRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAdmin)

  // POST /admin/predictor/tick — for every series, commit predictions for batches that
  // have closed and score batches that have fully resolved. Idempotent; run it every 5 min.
  app.post('/tick', {
    handler: async (_request, reply) => {
      const messages: string[] = []
      const outcome = tickPredictor(app.db, (msg) => messages.push(msg))
      return reply.send({ ok: true, ...outcome, log: messages })
    },
  })

  // GET /admin/predictor?series=smi|youtube — everything the admin view renders for that
  // series, replayed from its ledger.
  app.get<{ Querystring: SeriesQuery }>('/', {
    schema: { querystring: SERIES_QUERY_SCHEMA },
    handler: async (request, reply) => {
      const series = seriesOf(request.query, reply)
      if (series === null) return
      return reply.send(buildPredictorView(app.db, series))
    },
  })

  app.get<{ Querystring: SeriesQuery }>('/season', {
    schema: { querystring: SERIES_QUERY_SCHEMA },
    handler: async (request, reply) => {
      const series = seriesOf(request.query, reply)
      if (series === null) return
      return reply.send({
        season: ensureSeason(app.db, series),
        locked: seasonIsLocked(app.db, series),
      })
    },
  })

  // POST /admin/predictor/season?series=… — adjust one series' frozen configuration.
  //
  // Refused outright once a single round of that series has been committed. That refusal
  // is the point: the regret bound holds only if the learning rate, the expert pool and
  // the fill seed were fixed before any outcome was observed, so the endpoint has to stop
  // being usable exactly when the first prediction lands.
  app.post<{ Querystring: SeriesQuery; Body: SeasonBody }>('/season', {
    schema: {
      querystring: SERIES_QUERY_SCHEMA,
      body: {
        type: 'object',
        properties: {
          window_start: { type: 'string', format: 'date-time' },
          window_end: { type: 'string', format: 'date-time' },
          t_planned: { type: 'integer', minimum: 1 },
          rate_mode: { type: 'string', enum: ['fixed', 'anytime'] },
          learning_rate: { type: 'number', exclusiveMinimum: 0 },
          tie_break: { type: 'string', enum: ['A', 'B'] },
          fill_seed: { type: 'integer' },
        },
      },
    },
    handler: async (request, reply) => {
      const series = seriesOf(request.query, reply)
      if (series === null) return
      const current = ensureSeason(app.db, series)

      if (seasonIsLocked(app.db, series)) {
        return reply.status(409).send({
          error:
            `The ${series} predictor has already committed a prediction. Its parameters are ` +
            'frozen — changing them now would mean tuning the algorithm against data it has seen.',
        })
      }

      const next: SeasonRow = {
        ...current,
        ...request.body,
        // A fixed rate with no explicit value falls back to the tuned sqrt(8 ln N / T).
        learning_rate:
          request.body.learning_rate ??
          (request.body.t_planned
            ? optimalEta(current.n_experts ?? 30, request.body.t_planned)
            : current.learning_rate),
      }

      app.db
        .prepare(
          `UPDATE predictor_season
           SET    window_start = ?, window_end = ?, t_planned = ?, rate_mode = ?,
                  learning_rate = ?, tie_break = ?, fill_seed = ?
           WHERE  series = ?`,
        )
        .run(
          next.window_start,
          next.window_end,
          next.t_planned,
          next.rate_mode,
          next.learning_rate,
          next.tie_break,
          next.fill_seed,
          series,
        )

      return reply.send({ season: ensureSeason(app.db, series), locked: false })
    },
  })
}
