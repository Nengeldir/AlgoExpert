import Fastify from 'fastify'
import jwt from '@fastify/jwt'
import cors from '@fastify/cors'
import { initDb } from './db/migrate'
import { registerAuth } from './plugins/authenticate'
import { authRoutes } from './routes/auth'
import { questionRoutes } from './routes/questions'
import { voteRoutes } from './routes/votes'
import { historyRoutes } from './routes/history'
import { adminRoutes } from './routes/admin'
import { youtubeRoutes } from './routes/youtube'
import { smiRoutes } from './routes/smi'

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
  },
})

async function start() {
  const dbPath = process.env.DATABASE_PATH ?? './data/app.db'
  const db = initDb(dbPath)

  // Make the DB instance available on every request via app.db
  app.decorate('db', db)

  await app.register(cors, {
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
    credentials: true,
  })

  await app.register(jwt, {
    secret: process.env.JWT_SECRET ?? 'change-me-in-production',
  })

  // Register the authenticate decorator (adds app.authenticate and requireAdmin)
  await registerAuth(app)

  // Health check — used by Docker healthcheck
  app.get('/health', async () => ({ status: 'ok' }))

  await app.register(authRoutes, { prefix: '/api/auth' })
  await app.register(questionRoutes, { prefix: '/api/questions' })
  await app.register(voteRoutes, { prefix: '/api/votes' })
  await app.register(historyRoutes, { prefix: '/api/history' })
  await app.register(adminRoutes, { prefix: '/admin' })
  await app.register(youtubeRoutes, { prefix: '/admin/youtube' })
  await app.register(smiRoutes, { prefix: '/admin/smi' })

  const port = parseInt(process.env.PORT ?? '3000', 10)
  await app.listen({ port, host: '0.0.0.0' })
}

start().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
