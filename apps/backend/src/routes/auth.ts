import type { FastifyInstance } from 'fastify'
import bcrypt from 'bcrypt'
import type { UserRow, PasswordResetRow, JwtPayload } from '../types'
import { sendPasswordResetEmail } from '../services/email'
import { hashToken, issueResetToken, normalizeEmail } from '../services/passwordReset'

const SALT_ROUNDS = 10
const PSEUDONYM_RE = /^[a-zA-Z0-9_-]{3,30}$/

interface RegisterBody {
  pseudonym: string
  email: string
  password: string
  consent: boolean
}

interface LoginBody {
  identifier: string
  password: string
}

interface ForgotPasswordBody {
  email: string
}

interface ResetPasswordBody {
  token: string
  password: string
}

export async function authRoutes(app: FastifyInstance) {
  app.post<{ Body: RegisterBody }>('/register', {
    schema: {
      body: {
        type: 'object',
        required: ['pseudonym', 'email', 'password', 'consent'],
        properties: {
          pseudonym: { type: 'string', minLength: 3, maxLength: 30 },
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 6 },
          consent: { type: 'boolean' },
        },
      },
    },
    handler: async (request, reply) => {
      const { password, consent } = request.body
      const pseudonym = request.body.pseudonym.trim()
      const email = normalizeEmail(request.body.email)

      if (!consent) {
        return reply.status(400).send({ error: 'You must agree to the consent terms.' })
      }

      if (!PSEUDONYM_RE.test(pseudonym)) {
        return reply.status(400).send({
          error: 'Pseudonym must be 3–30 characters: letters, digits, hyphens, underscores only.',
        })
      }

      const existingPseudonym = app.db
        .prepare('SELECT id FROM users WHERE pseudonym = ?')
        .get(pseudonym)

      if (existingPseudonym) {
        return reply.status(409).send({ error: 'This pseudonym is already taken.' })
      }

      const existingEmail = app.db
        .prepare('SELECT id FROM users WHERE lower(email) = ?')
        .get(email)

      if (existingEmail) {
        return reply.status(409).send({ error: 'This email is already registered.' })
      }

      const password_hash = await bcrypt.hash(password, SALT_ROUNDS)
      const result = app.db
        .prepare('INSERT INTO users (pseudonym, email, password_hash) VALUES (?, ?, ?)')
        .run(pseudonym, email, password_hash)

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
        required: ['identifier', 'password'],
        properties: {
          identifier: { type: 'string' },
          password: { type: 'string' },
        },
      },
    },
    handler: async (request, reply) => {
      const { identifier, password } = request.body

      // Pseudonyms are matched exactly (they are displayed identity); emails are matched
      // case-insensitively, so logging in with the address as typed always works.
      const user = app.db
        .prepare('SELECT * FROM users WHERE pseudonym = ? OR lower(email) = ?')
        .get(identifier.trim(), normalizeEmail(identifier)) as UserRow | undefined

      if (!user) {
        return reply.status(401).send({ error: 'Invalid pseudonym/email or password.' })
      }

      const valid = await bcrypt.compare(password, user.password_hash)
      if (!valid) {
        return reply.status(401).send({ error: 'Invalid pseudonym/email or password.' })
      }

      const payload: JwtPayload = { userId: user.id, pseudonym: user.pseudonym }
      const token = app.jwt.sign(payload, { expiresIn: '30d' })

      return reply.send({ token, pseudonym: user.pseudonym })
    },
  })

  app.post<{ Body: ForgotPasswordBody }>('/forgot-password', {
    schema: {
      body: {
        type: 'object',
        required: ['email'],
        properties: {
          email: { type: 'string', format: 'email' },
        },
      },
    },
    handler: async (request, reply) => {
      const email = normalizeEmail(request.body.email)
      const genericMessage = 'If that email is registered, a reset link has been sent.'

      const user = app.db.prepare('SELECT * FROM users WHERE lower(email) = ?').get(email) as
        | UserRow
        | undefined

      if (user) {
        const { url } = issueResetToken(app.db, user.id)
        await sendPasswordResetEmail(user.email, url)
      }

      return reply.send({ message: genericMessage })
    },
  })

  app.post<{ Body: ResetPasswordBody }>('/reset-password', {
    schema: {
      body: {
        type: 'object',
        required: ['token', 'password'],
        properties: {
          token: { type: 'string' },
          password: { type: 'string', minLength: 6 },
        },
      },
    },
    handler: async (request, reply) => {
      const { token, password } = request.body
      const tokenHash = hashToken(token)

      // expires_at is an ISO-8601 string, so it must be compared against another ISO
      // string. SQLite compares TEXT lexicographically and ISO's 'T' sorts above the space
      // in datetime('now'), which made an expired token look valid until the UTC date
      // rolled over — and made a token minted late in the UTC day die at midnight.
      const reset = app.db
        .prepare(
          `SELECT * FROM password_resets
           WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?`,
        )
        .get(tokenHash, new Date().toISOString()) as PasswordResetRow | undefined

      if (!reset) {
        return reply.status(400).send({ error: 'This reset link is invalid or has expired.' })
      }

      const password_hash = await bcrypt.hash(password, SALT_ROUNDS)

      const updateUser = app.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
      const markUsed = app.db.prepare('UPDATE password_resets SET used_at = ? WHERE id = ?')
      const usedAt = new Date().toISOString()

      app.db.transaction(() => {
        updateUser.run(password_hash, reset.user_id)
        markUsed.run(usedAt, reset.id)
      })()

      return reply.send({ message: 'Your password has been reset.' })
    },
  })
}
