import type { FastifyInstance } from 'fastify'

interface SubscribeBody {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

interface UnsubscribeBody {
  endpoint: string
}

export async function pushRoutes(app: FastifyInstance) {
  // GET /api/push/vapid-public-key — the client needs this to call pushManager.subscribe()
  app.get('/vapid-public-key', {
    preHandler: [app.authenticate],
    handler: async (_request, reply) => {
      const publicKey = process.env.VAPID_PUBLIC_KEY
      if (!publicKey) {
        return reply.status(503).send({ error: 'Push notifications are not configured.' })
      }
      return reply.send({ publicKey })
    },
  })

  // POST /api/push/subscribe — persist a browser PushSubscription for the caller
  app.post<{ Body: SubscribeBody }>('/subscribe', {
    preHandler: [app.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['endpoint', 'keys'],
        properties: {
          endpoint: { type: 'string', minLength: 1 },
          keys: {
            type: 'object',
            required: ['p256dh', 'auth'],
            properties: {
              p256dh: { type: 'string', minLength: 1 },
              auth: { type: 'string', minLength: 1 },
            },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const { endpoint, keys } = request.body

      app.db
        .prepare(
          `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(endpoint) DO UPDATE SET
             user_id = excluded.user_id,
             p256dh  = excluded.p256dh,
             auth    = excluded.auth`,
        )
        .run(request.user.userId, endpoint, keys.p256dh, keys.auth)

      return reply.status(201).send({ ok: true })
    },
  })

  // POST /api/push/unsubscribe — remove a subscription belonging to the caller
  app.post<{ Body: UnsubscribeBody }>('/unsubscribe', {
    preHandler: [app.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['endpoint'],
        properties: { endpoint: { type: 'string', minLength: 1 } },
      },
    },
    handler: async (request, reply) => {
      app.db
        .prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?')
        .run(request.body.endpoint, request.user.userId)

      return reply.status(204).send()
    },
  })
}
