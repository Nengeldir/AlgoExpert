import type { FastifyInstance } from 'fastify'
import { requireAdmin } from '../plugins/authenticate'
import type { QuestionRow } from '../types'

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
           ORDER BY q.id ASC, u.pseudonym ASC`,
        )
        .all() as VoteExportRow[]

      if (format === 'csv') {
        const header =
          'pseudonym,question_title,option_a,option_b,ground_truth,user_vote,is_correct,voted_at'
        const body = rows
          .map(
            (r) =>
              `"${r.pseudonym}","${r.question_title}","${r.option_a}","${r.option_b}","${r.ground_truth ?? ''}","${r.user_vote}","${r.is_correct ?? ''}","${r.voted_at}"`,
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

interface VoteExportRow {
  pseudonym: string
  question_title: string
  option_a: string
  option_b: string
  ground_truth: 'A' | 'B' | null
  user_vote: 'A' | 'B'
  is_correct: 0 | 1 | null
  voted_at: string
}
