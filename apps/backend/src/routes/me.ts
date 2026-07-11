import type { FastifyInstance } from 'fastify'
import type { UserRow } from '../types'

interface UpdateSettingsBody {
  email_notifications: boolean
}

export async function meRoutes(app: FastifyInstance) {
  // GET /api/me — the caller's own profile and account settings
  app.get('/', {
    preHandler: [app.authenticate],
    handler: async (request, reply) => {
      const user = app.db.prepare('SELECT * FROM users WHERE id = ?').get(request.user.userId) as
        | UserRow
        | undefined

      if (!user) {
        return reply.status(404).send({ error: 'User not found.' })
      }

      return reply.send({
        profile: {
          pseudonym: user.pseudonym,
          email: user.email,
          email_notifications: !!user.email_notifications,
          created_at: user.created_at,
        },
      })
    },
  })

  // PATCH /api/me/settings — update mutable account settings
  app.patch<{ Body: UpdateSettingsBody }>('/settings', {
    preHandler: [app.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['email_notifications'],
        properties: {
          email_notifications: { type: 'boolean' },
        },
      },
    },
    handler: async (request, reply) => {
      const { email_notifications } = request.body

      const result = app.db
        .prepare('UPDATE users SET email_notifications = ? WHERE id = ?')
        .run(email_notifications ? 1 : 0, request.user.userId)

      if (result.changes === 0) {
        return reply.status(404).send({ error: 'User not found.' })
      }

      return reply.send({ email_notifications })
    },
  })
}
