import type { FastifyInstance } from 'fastify'
import bcrypt from 'bcrypt'
import type { UserRow, JwtPayload } from '../types'

const SALT_ROUNDS = 10
const PSEUDONYM_RE = /^[a-zA-Z0-9_-]{3,30}$/

interface RegisterBody {
  pseudonym: string
  password: string
  consent: boolean
}

interface LoginBody {
  pseudonym: string
  password: string
}

export async function authRoutes(app: FastifyInstance) {
  app.post<{ Body: RegisterBody }>('/register', {
    schema: {
      body: {
        type: 'object',
        required: ['pseudonym', 'password', 'consent'],
        properties: {
          pseudonym: { type: 'string', minLength: 3, maxLength: 30 },
          password: { type: 'string', minLength: 6 },
          consent: { type: 'boolean' },
        },
      },
    },
    handler: async (request, reply) => {
      const { pseudonym, password, consent } = request.body

      if (!consent) {
        return reply.status(400).send({ error: 'You must agree to the consent terms.' })
      }

      if (!PSEUDONYM_RE.test(pseudonym)) {
        return reply.status(400).send({
          error: 'Pseudonym must be 3–30 characters: letters, digits, hyphens, underscores only.',
        })
      }

      const existing = app.db.prepare('SELECT id FROM users WHERE pseudonym = ?').get(pseudonym)

      if (existing) {
        return reply.status(409).send({ error: 'This pseudonym is already taken.' })
      }

      const password_hash = await bcrypt.hash(password, SALT_ROUNDS)
      const result = app.db
        .prepare('INSERT INTO users (pseudonym, password_hash) VALUES (?, ?)')
        .run(pseudonym, password_hash)

      const userId = result.lastInsertRowid as number
      const payload: JwtPayload = { userId, pseudonym }
      const token = app.jwt.sign(payload, { expiresIn: '30d' })

      return reply.status(201).send({ token, pseudonym })
    },
  })

  app.post<{ Body: LoginBody }>('/login', {
    schema: {
      body: {
        type: 'object',
        required: ['pseudonym', 'password'],
        properties: {
          pseudonym: { type: 'string' },
          password: { type: 'string' },
        },
      },
    },
    handler: async (request, reply) => {
      const { pseudonym, password } = request.body

      const user = app.db.prepare('SELECT * FROM users WHERE pseudonym = ?').get(pseudonym) as
        | UserRow
        | undefined

      if (!user) {
        return reply.status(401).send({ error: 'Invalid pseudonym or password.' })
      }

      const valid = await bcrypt.compare(password, user.password_hash)
      if (!valid) {
        return reply.status(401).send({ error: 'Invalid pseudonym or password.' })
      }

      const payload: JwtPayload = { userId: user.id, pseudonym: user.pseudonym }
      const token = app.jwt.sign(payload, { expiresIn: '30d' })

      return reply.send({ token, pseudonym: user.pseudonym })
    },
  })
}
