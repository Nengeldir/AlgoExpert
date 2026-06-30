import type { FastifyInstance } from 'fastify'
import { requireAdmin } from '../plugins/authenticate'
import { createDailySmiQuestion, resolveExpiredSmiQuestions } from '../services/smiService'

export async function smiRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAdmin)

  // POST /admin/smi/daily — create today's SMI question if it doesn't exist yet.
  // Call this each morning (e.g. 08:00 Zurich) from an external cron service.
  app.post('/daily', {
    handler: async (_request, reply) => {
      const messages: string[] = []
      await createDailySmiQuestion(app.db, (msg) => messages.push(msg))
      return reply.send({ ok: true, log: messages })
    },
  })

  // POST /admin/smi/resolve — resolve any expired SMI questions that now have a close price.
  // Call this after market close (e.g. 18:30 Zurich) from an external cron service.
  app.post('/resolve', {
    handler: async (_request, reply) => {
      const messages: string[] = []
      await resolveExpiredSmiQuestions(app.db, (msg) => messages.push(msg))
      return reply.send({ ok: true, log: messages })
    },
  })
}
