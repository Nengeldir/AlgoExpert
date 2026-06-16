import type { FastifyInstance } from 'fastify'
import type { QuestionRow } from '../types'

export async function historyRoutes(app: FastifyInstance) {
  // GET /api/history — all past questions with the caller's own vote + ground truth
  app.get('/', {
    preHandler: [app.authenticate],
    handler: async (request, reply) => {
      const userId = request.user.userId

      const questions = app.db
        .prepare(
          `SELECT q.*, v.choice AS user_vote, v.is_correct
           FROM questions q
           LEFT JOIN votes v ON v.question_id = q.id AND v.user_id = ?
           WHERE q.deadline < datetime('now')
           ORDER BY q.deadline DESC`,
        )
        .all(userId) as (QuestionRow & { user_vote: 'A' | 'B' | null; is_correct: 0 | 1 | null })[]

      const history = questions.map((q) => ({
        id: q.id,
        title: q.title,
        description: q.description,
        option_a: q.option_a,
        option_b: q.option_b,
        image_url: q.image_url,
        deadline: q.deadline,
        is_resolved: q.ground_truth !== null,
        ground_truth: q.ground_truth,
        user_vote: q.user_vote,
        is_correct: q.is_correct,
        // Deliberately omit other users' votes to preserve prediction heterogeneity
      }))

      return reply.send({ history })
    },
  })
}
