import type { FastifyInstance } from 'fastify'
import type { QuestionRow, VoteRow } from '../types'

interface VoteBody {
  question_id: number
  choice: 'A' | 'B'
}

export async function voteRoutes(app: FastifyInstance) {
  app.post<{ Body: VoteBody }>('/', {
    preHandler: [app.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['question_id', 'choice'],
        properties: {
          question_id: { type: 'integer' },
          choice: { type: 'string', enum: ['A', 'B'] },
        },
      },
    },
    handler: async (request, reply) => {
      const { question_id, choice } = request.body
      const userId = request.user.userId

      const question = app.db.prepare('SELECT * FROM questions WHERE id = ?').get(question_id) as
        | QuestionRow
        | undefined

      if (!question) {
        return reply.status(404).send({ error: 'Question not found.' })
      }

      if (new Date(question.deadline) <= new Date()) {
        return reply.status(409).send({ error: 'Voting deadline has passed.' })
      }

      if (question.ground_truth !== null) {
        return reply.status(409).send({ error: 'This question has already been resolved.' })
      }

      const existing = app.db
        .prepare('SELECT id FROM votes WHERE user_id = ? AND question_id = ?')
        .get(userId, question_id) as VoteRow | undefined

      if (existing) {
        return reply.status(409).send({ error: 'You have already voted on this question.' })
      }

      app.db
        .prepare('INSERT INTO votes (user_id, question_id, choice) VALUES (?, ?, ?)')
        .run(userId, question_id, choice)

      return reply.status(201).send({ question_id, choice })
    },
  })
}
