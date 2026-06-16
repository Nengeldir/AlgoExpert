import Fastify from 'fastify'
import jwt from '@fastify/jwt'
import cors from '@fastify/cors'
import { initDb } from '../db/migrate'
import { registerAuth } from '../plugins/authenticate'
import { authRoutes } from '../routes/auth'
import { questionRoutes } from '../routes/questions'
import { voteRoutes } from '../routes/votes'
import { historyRoutes } from '../routes/history'
import { adminRoutes } from '../routes/admin'

// Build a test app backed by an in-memory SQLite database
export function buildTestApp() {
  const app = Fastify({ logger: false })

  // :memory: gives us a fresh schema per test suite without touching disk
  const db = initDb(':memory:')
  app.decorate('db', db)

  void app.register(cors)
  void app.register(jwt, { secret: 'test-secret' })
  void registerAuth(app)

  app.get('/health', async () => ({ status: 'ok' }))

  void app.register(authRoutes, { prefix: '/api/auth' })
  void app.register(questionRoutes, { prefix: '/api/questions' })
  void app.register(voteRoutes, { prefix: '/api/votes' })
  void app.register(historyRoutes, { prefix: '/api/history' })
  void app.register(adminRoutes, { prefix: '/admin' })

  return app
}

export const ADMIN_TOKEN = 'test-admin-token'

export function setAdminToken(token: string) {
  process.env.ADMIN_TOKEN = token
}
