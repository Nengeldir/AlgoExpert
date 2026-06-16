import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { JwtPayload } from '../types'

export async function registerAuth(app: FastifyInstance) {
  // Decorator that verifies a JWT and populates request.user
  app.decorate('authenticate', async function (request: FastifyRequest, reply: FastifyReply) {
    try {
      // @fastify/jwt attaches verify() via plugin registration
      const payload = await request.jwtVerify<JwtPayload>()
      request.user = payload
    } catch {
      await reply.status(401).send({ error: 'Unauthorized' })
    }
  })
}

// Middleware factory for admin-only routes.
// Reads a bearer token from Authorization header and compares it to ADMIN_TOKEN.
export function requireAdmin(request: FastifyRequest, reply: FastifyReply, done: () => void) {
  const header = request.headers.authorization ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token || token !== (process.env.ADMIN_TOKEN ?? '')) {
    void reply.status(403).send({ error: 'Forbidden' })
    return
  }
  done()
}
