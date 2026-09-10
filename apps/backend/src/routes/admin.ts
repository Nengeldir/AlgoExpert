import type { FastifyInstance } from 'fastify'
import { requireAdmin } from '../plugins/authenticate'
import { dispatchNewQuestionEmails } from '../services/notifications'
import { sendPasswordResetEmail } from '../services/email'
import { issueResetToken } from '../services/passwordReset'
import type { QuestionRow, UserRow } from '../types'

interface CreateQuestionBody {
  title: string
  description: string
  option_a: string
  option_b: string
  image_url?: string
  deadline: string
}

interface ResolveBody {
  ground_truth: 'A' | 'B'
}

export async function adminRoutes(app: FastifyInstance) {
  // All admin routes require the admin bearer token
  app.addHook('preHandler', requireAdmin)

  app.post<{ Body: CreateQuestionBody }>('/questions', {
    schema: {
      body: {
        type: 'object',
        required: ['title', 'description', 'option_a', 'option_b', 'deadline'],
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 200 },
          description: { type: 'string', minLength: 1 },
          option_a: { type: 'string', minLength: 1 },
          option_b: { type: 'string', minLength: 1 },
          image_url: { type: 'string' },
          deadline: { type: 'string', format: 'date-time' },
        },
      },
    },
    handler: async (request, reply) => {
      const { title, description, option_a, option_b, image_url, deadline } = request.body

      const result = app.db
        .prepare(
          `INSERT INTO questions (title, description, option_a, option_b, image_url, deadline)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(title, description, option_a, option_b, image_url ?? null, deadline)

      const question = app.db
        .prepare('SELECT * FROM questions WHERE id = ?')
        .get(result.lastInsertRowid) as QuestionRow

      return reply.status(201).send({ question })
    },
  })

  app.post<{ Params: { id: string }; Body: ResolveBody }>('/questions/:id/resolve', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['ground_truth'],
        properties: { ground_truth: { type: 'string', enum: ['A', 'B'] } },
      },
    },
    handler: async (request, reply) => {
      const questionId = parseInt(request.params.id, 10)
      const { ground_truth } = request.body

      const question = app.db.prepare('SELECT * FROM questions WHERE id = ?').get(questionId) as
        | QuestionRow
        | undefined

      if (!question) {
        return reply.status(404).send({ error: 'Question not found.' })
      }

      if (question.ground_truth !== null) {
        return reply.status(409).send({ error: 'Question already resolved.' })
      }

      // Update ground truth and mark all votes as correct/incorrect atomically
      const resolveAll = app.db.transaction(() => {
        app.db
          .prepare(
            `UPDATE questions SET ground_truth = ?, resolved_at = datetime('now') WHERE id = ?`,
          )
          .run(ground_truth, questionId)

        // Set is_correct = 1 where vote matches ground truth, 0 otherwise
        app.db
          .prepare(
            `UPDATE votes SET is_correct = CASE WHEN choice = ? THEN 1 ELSE 0 END
             WHERE question_id = ?`,
          )
          .run(ground_truth, questionId)
      })

      resolveAll()

      const updated = app.db
        .prepare('SELECT * FROM questions WHERE id = ?')
        .get(questionId) as QuestionRow

      const voteCount = (
        app.db
          .prepare('SELECT COUNT(*) as count FROM votes WHERE question_id = ?')
          .get(questionId) as { count: number }
      ).count

      return reply.send({
        question: updated,
        votes_updated: voteCount,
      })
    },
  })

  // Export all votes as JSON or CSV for live lecture analysis
  app.get<{ Querystring: { format?: string } }>('/export', {
    handler: async (request, reply) => {
      const format = request.query.format ?? 'json'

      const rows = app.db
        .prepare(
          `SELECT
             q.id          AS question_id,
             q.deadline,
             u.pseudonym,
             q.title       AS question_title,
             q.option_a,
             q.option_b,
             q.ground_truth,
             v.choice      AS user_vote,
             v.is_correct,
             v.voted_at
           FROM votes v
           JOIN users     u ON u.id = v.user_id
           JOIN questions q ON q.id = v.question_id
           ORDER BY q.deadline ASC, q.id ASC, u.pseudonym ASC`,
        )
        .all() as VoteExportRow[]

      if (format === 'csv') {
        const header =
          'question_id,deadline,pseudonym,question_title,option_a,option_b,ground_truth,user_vote,is_correct,voted_at'
        const body = rows
          .map(
            (r) =>
              `"${r.question_id}","${r.deadline}","${r.pseudonym}","${r.question_title}","${r.option_a}","${r.option_b}","${r.ground_truth ?? ''}","${r.user_vote}","${r.is_correct ?? ''}","${r.voted_at}"`,
          )
          .join('\n')
        return reply
          .header('Content-Type', 'text/csv')
          .header('Content-Disposition', 'attachment; filename="votes.csv"')
          .send(`${header}\n${body}`)
      }

      return reply.send({ votes: rows, exported_at: new Date().toISOString() })
    },
  })

  app.delete<{ Params: { id: string } }>('/questions/:id', {
    handler: async (request, reply) => {
      const questionId = parseInt(request.params.id, 10)

      const question = app.db.prepare('SELECT id FROM questions WHERE id = ?').get(questionId)
      if (!question) return reply.status(404).send({ error: 'Question not found.' })

      // The predictor's ledger is append-only: once it has committed a prediction for this
      // question, deleting it would rewrite the run's history and invalidate every weight
      // downstream. Questions can still be deleted freely before their deadline, which is
      // the case that actually matters (spotting a bad pair in the morning).
      const committed = app.db
        .prepare('SELECT round_index FROM predictor_rounds WHERE question_id = ?')
        .get(questionId) as { round_index: number } | undefined

      if (committed) {
        return reply.status(409).send({
          error:
            `The predictor already committed a prediction for this question ` +
            `(round ${committed.round_index}). Deleting it would rewrite the run's history.`,
        })
      }

      app.db.transaction(() => {
        app.db.prepare('DELETE FROM votes WHERE question_id = ?').run(questionId)
        // Remove the source row that published this question — the YouTube suggestion so a
        // fresh pair can be fetched, the SMI row so the daily job can recreate the question.
        // Both reference questions(id), so leaving either behind would make the delete fail.
        app.db.prepare('DELETE FROM youtube_suggestions WHERE question_id = ?').run(questionId)
        app.db.prepare('DELETE FROM smi_questions WHERE question_id = ?').run(questionId)
        app.db.prepare('DELETE FROM questions WHERE id = ?').run(questionId)
      })()

      return reply.status(204).send()
    },
  })

  // Votes for a single question (inline view)
  app.get<{ Params: { id: string } }>('/questions/:id/votes', {
    handler: async (request, reply) => {
      const questionId = parseInt(request.params.id, 10)

      const question = app.db.prepare('SELECT id FROM questions WHERE id = ?').get(questionId)
      if (!question) return reply.status(404).send({ error: 'Question not found.' })

      const votes = app.db
        .prepare(
          `SELECT u.pseudonym, v.choice, v.is_correct, v.voted_at
           FROM votes v
           JOIN users u ON u.id = v.user_id
           WHERE v.question_id = ?
           ORDER BY u.pseudonym ASC`,
        )
        .all(questionId) as QuestionVoteRow[]

      return reply.send({ votes })
    },
  })

  // POST /admin/notifications/dispatch — email opted-in participants about questions that
  // have gone live since the last call. Idempotent, so call it every few minutes from an
  // external cron service; it does no work (and sends nothing) when there is nothing new.
  app.post('/notifications/dispatch', {
    handler: async (_request, reply) => {
      const messages: string[] = []
      const notified = await dispatchNewQuestionEmails(app.db, (msg) => messages.push(msg))
      return reply.send({ ok: true, notified, log: messages })
    },
  })

  // --- Account recovery ---------------------------------------------------------------
  //
  // POST /api/auth/forgot-password deliberately reveals nothing — it returns the same
  // generic success whether or not the address matched an account. That is correct for a
  // public endpoint and useless for the operator fielding "I never got the mail", who
  // cannot otherwise tell a mistyped address apart from a delivery failure. These two
  // routes are that missing view, behind the admin token.

  // Look a participant up by pseudonym or email substring.
  app.get<{ Querystring: { q?: string } }>('/users', {
    handler: async (request, reply) => {
      const q = (request.query.q ?? '').trim().toLowerCase()

      if (q.length < 2) {
        return reply.status(400).send({ error: 'Search for at least 2 characters.' })
      }

      const like = `%${q}%`
      const users = app.db
        .prepare(
          `SELECT u.id, u.pseudonym, u.email, u.email_notifications, u.created_at,
                  COUNT(v.id) AS vote_count,
                  (SELECT max(p.created_at) FROM password_resets p WHERE p.user_id = u.id)
                    AS last_reset_requested_at
           FROM users u
           LEFT JOIN votes v ON v.user_id = u.id
           WHERE lower(u.pseudonym) LIKE ? OR lower(u.email) LIKE ?
           GROUP BY u.id
           ORDER BY u.pseudonym ASC
           LIMIT 25`,
        )
        .all(like, like) as AdminUserRow[]

      return reply.send({ users })
    },
  })

  // Mint a reset link for one participant.
  //
  // The link is always returned so it can be forwarded by hand — that is the path that
  // works even when mail delivery is the thing that is broken. `send: true` additionally
  // pushes it through the normal mail path and reports what the provider said, which is
  // the quickest way to find out whether the address is deliverable at all.
  app.post<{ Params: { id: string }; Body: { send?: boolean } | undefined }>(
    '/users/:id/reset-link',
    {
      schema: {
        body: {
          type: 'object',
          properties: { send: { type: 'boolean' } },
        },
      },
      handler: async (request, reply) => {
        const userId = parseInt(request.params.id, 10)
        if (!Number.isInteger(userId)) return reply.status(404).send({ error: 'User not found.' })

        const user = app.db
          .prepare('SELECT id, pseudonym, email FROM users WHERE id = ?')
          .get(userId) as Pick<UserRow, 'id' | 'pseudonym' | 'email'> | undefined

        if (!user) return reply.status(404).send({ error: 'User not found.' })

        const { url, expires_at } = issueResetToken(app.db, user.id)

        let sent = false
        let send_error: string | undefined

        if (request.body?.send) {
          if (!user.email) {
            send_error = 'This account has no email address on file.'
          } else {
            try {
              await sendPasswordResetEmail(user.email, url)
              sent = true
            } catch (err) {
              // Surfaced rather than thrown: the link above is still valid and forwardable,
              // and the provider's message is the diagnostic the operator came for.
              send_error = err instanceof Error ? err.message : String(err)
            }
          }
        }

        return reply.send({
          user: { id: user.id, pseudonym: user.pseudonym, email: user.email },
          reset_url: url,
          expires_at,
          sent,
          ...(send_error ? { send_error } : {}),
        })
      },
    },
  )

  // List all questions (admin overview)
  app.get('/questions', {
    handler: async (_request, reply) => {
      const questions = app.db
        .prepare(
          `SELECT q.*, COUNT(v.id) as vote_count
           FROM questions q
           LEFT JOIN votes v ON v.question_id = q.id
           GROUP BY q.id
           ORDER BY q.created_at DESC`,
        )
        .all()
      return reply.send({ questions })
    },
  })
}

interface AdminUserRow {
  id: number
  pseudonym: string
  email: string | null
  email_notifications: 0 | 1
  created_at: string
  vote_count: number
  last_reset_requested_at: string | null
}

interface QuestionVoteRow {
  pseudonym: string
  choice: 'A' | 'B'
  is_correct: 0 | 1 | null
  voted_at: string
}

interface VoteExportRow {
  question_id: number
  deadline: string
  pseudonym: string
  question_title: string
  option_a: string
  option_b: string
  ground_truth: 'A' | 'B' | null
  user_vote: 'A' | 'B'
  is_correct: 0 | 1 | null
  voted_at: string
}
