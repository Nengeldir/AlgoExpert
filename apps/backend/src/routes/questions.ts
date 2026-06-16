import type { FastifyInstance } from 'fastify'
import type { QuestionRow, VoteRow } from '../types'

export async function questionRoutes(app: FastifyInstance) {
  // GET /api/questions — today's open questions with the caller's vote status
  app.get('/', {
    preHandler: [app.authenticate],
    handler: async (request, reply) => {
      const userId = request.user.userId
      const now = new Date().toISOString()

      // Questions whose deadline is in the future OR that resolved within the last 7 days
      const questions = app.db
        .prepare(
          `SELECT * FROM questions
           WHERE deadline > ? OR resolved_at > datetime(?, '-7 days')
           ORDER BY deadline ASC`,
        )
        .all(now, now) as QuestionRow[]

      const enriched = questions.map((q) => {
        const vote = app.db
          .prepare('SELECT * FROM votes WHERE user_id = ? AND question_id = ?')
          .get(userId, q.id) as VoteRow | undefined

        const isOpen = new Date(q.deadline) > new Date()

        return {
          id: q.id,
          title: q.title,
          description: q.description,
          option_a: q.option_a,
          option_b: q.option_b,
          image_url: q.image_url,
          deadline: q.deadline,
          is_open: isOpen,
          is_resolved: q.ground_truth !== null,
          ground_truth: q.ground_truth,
          user_vote: vote?.choice ?? null,
          is_correct: vote?.is_correct ?? null,
        }
      })

      return reply.send({ questions: enriched })
    },
  })
}
