import type { FastifyInstance } from 'fastify'
import { requireAdmin } from '../plugins/authenticate'
import {
  buildPredictorView,
  ensureSeason,
  seasonIsLocked,
  tickPredictor,
  type SeasonRow,
} from '../services/predictor'
import { optimalEta } from '../services/predictorEngine'

interface SeasonBody {
  window_start?: string
  window_end?: string
  t_planned?: number
  rate_mode?: 'fixed' | 'anytime'
  learning_rate?: number
  tie_break?: 'A' | 'B'
  fill_seed?: number
}

export async function predictorRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAdmin)

  // POST /admin/predictor/tick — commit predictions for batches that have closed, score
  // batches that have fully resolved. Idempotent; run it every 5 minutes.
  app.post('/tick', {
    handler: async (_request, reply) => {
      const messages: string[] = []
      const outcome = tickPredictor(app.db, (msg) => messages.push(msg))
      return reply.send({ ok: true, ...outcome, log: messages })
    },
  })

  // GET /admin/predictor — everything the admin view renders, replayed from the ledger.
  app.get('/', {
    handler: async (_request, reply) => {
      return reply.send(buildPredictorView(app.db))
    },
  })

  app.get('/season', {
    handler: async (_request, reply) => {
      return reply.send({ season: ensureSeason(app.db), locked: seasonIsLocked(app.db) })
    },
  })

  // POST /admin/predictor/season — adjust the frozen configuration.
  //
  // Refused outright once a single round has been committed. That refusal is the point:
  // the regret bound holds only if the learning rate, the expert pool and the fill seed
  // were fixed before any outcome was observed, so the endpoint has to stop being usable
  // exactly when the first prediction lands.
  app.post<{ Body: SeasonBody }>('/season', {
    schema: {
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
      const current = ensureSeason(app.db)

      if (seasonIsLocked(app.db)) {
        return reply.status(409).send({
          error:
            'The predictor has already committed a prediction. Its parameters are frozen — ' +
            'changing them now would mean tuning the algorithm against data it has seen.',
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
           WHERE  id = 1`,
        )
        .run(
          next.window_start,
          next.window_end,
          next.t_planned,
          next.rate_mode,
          next.learning_rate,
          next.tie_break,
          next.fill_seed,
        )

      return reply.send({ season: ensureSeason(app.db), locked: false })
    },
  })
}
