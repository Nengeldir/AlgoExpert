import type Database from 'better-sqlite3'

export interface JwtPayload {
  userId: number
  pseudonym: string
}

// Augment Fastify instance to carry the db connection + authenticate decorator.
declare module 'fastify' {
  interface FastifyInstance {
    db: Database.Database
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
}

// Tell @fastify/jwt the concrete shape of our token payload and request.user,
// instead of redeclaring FastifyRequest.user (which conflicts with the plugin).
declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtPayload
    user: JwtPayload
  }
}

// Database row shapes
export interface UserRow {
  id: number
  pseudonym: string
  email: string
  password_hash: string
  email_notifications: 0 | 1
  created_at: string
}

export interface PasswordResetRow {
  id: number
  user_id: number
  token_hash: string
  expires_at: string
  used_at: string | null
  created_at: string
}

export interface QuestionRow {
  id: number
  title: string
  description: string
  option_a: string
  option_b: string
  image_url: string | null
  option_a_image: string | null
  option_b_image: string | null
  option_a_views: number | null
  option_b_views: number | null
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
