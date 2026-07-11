import crypto from 'crypto'
import type { FastifyInstance } from 'fastify'
import bcrypt from 'bcrypt'
import type { UserRow, PasswordResetRow, JwtPayload } from '../types'
import { sendPasswordResetEmail } from '../services/email'

const SALT_ROUNDS = 10
const PSEUDONYM_RE = /^[a-zA-Z0-9_-]{3,30}$/
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000 // 1 hour

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

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
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
      const { pseudonym, email, password, consent } = request.body

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

      const existingEmail = app.db.prepare('SELECT id FROM users WHERE email = ?').get(email)

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

      const user = app.db
        .prepare('SELECT * FROM users WHERE pseudonym = ? OR email = ?')
        .get(identifier, identifier) as UserRow | undefined

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
      const { email } = request.body
      const genericMessage = 'If that email is registered, a reset link has been sent.'

      const user = app.db.prepare('SELECT * FROM users WHERE email = ?').get(email) as
        | UserRow
        | undefined

      if (user) {
        const token = crypto.randomBytes(32).toString('hex')
        const tokenHash = hashToken(token)
        const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString()

        app.db
          .prepare('INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, ?)')
          .run(user.id, tokenHash, expiresAt)

        const frontendOrigin = process.env.CORS_ORIGIN ?? 'http://localhost:5173'
        const resetUrl = `${frontendOrigin}/reset-password?token=${token}`

        await sendPasswordResetEmail(user.email, resetUrl)
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

      const reset = app.db
        .prepare(
          `SELECT * FROM password_resets
           WHERE token_hash = ? AND used_at IS NULL AND expires_at > datetime('now')`,
        )
        .get(tokenHash) as PasswordResetRow | undefined

      if (!reset) {
        return reply.status(400).send({ error: 'This reset link is invalid or has expired.' })
      }

      const password_hash = await bcrypt.hash(password, SALT_ROUNDS)

      const updateUser = app.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
      const markUsed = app.db.prepare(
        "UPDATE password_resets SET used_at = datetime('now') WHERE id = ?",
      )

      app.db.transaction(() => {
        updateUser.run(password_hash, reset.user_id)
        markUsed.run(reset.id)
      })()

      return reply.send({ message: 'Your password has been reset.' })
    },
  })
}
