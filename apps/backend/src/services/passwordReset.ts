import crypto from 'crypto'
import type BetterSqlite3 from 'better-sqlite3'

export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000 // 1 hour

/**
 * Canonical form of an email for both storage and lookup.
 *
 * SQLite's default BINARY collation makes `WHERE email = ?` case-sensitive, so a student
 * who registered as `First.Last@ethz.ch` and later typed `first.last@ethz.ch` into the
 * reset form matched no row — and because /forgot-password deliberately returns a generic
 * success either way, they got the confirmation screen and no mail, forever. Normalising
 * on the way in and comparing on `lower(email)` on the way out closes that hole from both
 * sides; migrate.ts backfills the rows written before this existed.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

/** Base URL of the SPA — also the base for reset links, hence the CORS_ORIGIN reuse. */
export function frontendOrigin(): string {
  return process.env.CORS_ORIGIN ?? 'http://localhost:5173'
}

export interface IssuedReset {
  /** The raw token. Only ever leaves the process inside `url`; the DB stores its hash. */
  token: string
  url: string
  expires_at: string
}

/**
 * Mint a one-time reset token for a user and record its hash.
 *
 * Shared by the self-service /api/auth/forgot-password flow and the operator-driven
 * /admin/users/:id/reset-link, so both produce links the same reset endpoint accepts.
 */
export function issueResetToken(db: BetterSqlite3.Database, userId: number): IssuedReset {
  const token = crypto.randomBytes(32).toString('hex')
  const expires_at = new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString()

  db.prepare('INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, ?)').run(
    userId,
    hashToken(token),
    expires_at,
  )

  return { token, url: `${frontendOrigin()}/reset-password?token=${token}`, expires_at }
}
