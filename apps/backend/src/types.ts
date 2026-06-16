import type Database from 'better-sqlite3'

// Augment Fastify instance to carry the db connection and authenticated user
declare module 'fastify' {
  interface FastifyInstance {
    db: Database.Database
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
  interface FastifyRequest {
    user: JwtPayload
  }
}

export interface JwtPayload {
  userId: number
  pseudonym: string
}

// Database row shapes
export interface UserRow {
  id: number
  pseudonym: string
  password_hash: string
  created_at: string
}

export interface QuestionRow {
  id: number
  title: string
  description: string
  option_a: string
  option_b: string
  image_url: string | null
  deadline: string
  resolved_at: string | null
  ground_truth: 'A' | 'B' | null
  created_at: string
}

export interface VoteRow {
  id: number
  user_id: number
  question_id: number
  choice: 'A' | 'B'
  is_correct: 0 | 1 | null
  voted_at: string
}
