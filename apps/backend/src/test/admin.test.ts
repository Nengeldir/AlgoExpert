import { describe, it, beforeAll, afterAll, expect } from 'vitest'
import { buildTestApp, ADMIN_TOKEN, setAdminToken } from './helpers'

describe('Admin endpoints', () => {
  const app = buildTestApp()
  setAdminToken(ADMIN_TOKEN)

  const adminHeaders = { Authorization: `Bearer ${ADMIN_TOKEN}` }
  const futureDeadline = new Date(Date.now() + 86400000).toISOString()

  beforeAll(() => app.ready())
  afterAll(() => app.close())

  it('rejects unauthenticated admin requests', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/questions' })
    expect(res.statusCode).toBe(403)
  })

  it('POST /admin/questions creates a question', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/questions',
      headers: adminHeaders,
      payload: {
        title: 'Test Question',
        description: 'Will X happen?',
        option_a: 'Yes',
        option_b: 'No',
        deadline: futureDeadline,
      },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json<{ question: { id: number; title: string } }>()
    expect(body.question.title).toBe('Test Question')
  })

  it('POST /admin/questions/:id/resolve resolves a question and updates votes', async () => {
    // Create question
    const createRes = await app.inject({
      method: 'POST',
      url: '/admin/questions',
      headers: adminHeaders,
      payload: {
        title: 'Resolvable',
        description: 'Desc',
        option_a: 'A',
        option_b: 'B',
        deadline: new Date(Date.now() - 1000).toISOString(), // already closed
      },
    })
    const { question } = createRes.json<{ question: { id: number } }>()

    const resolveRes = await app.inject({
      method: 'POST',
      url: `/admin/questions/${question.id}/resolve`,
      headers: adminHeaders,
      payload: { ground_truth: 'A' },
    })
    expect(resolveRes.statusCode).toBe(200)
    const body = resolveRes.json<{ question: { ground_truth: string } }>()
    expect(body.question.ground_truth).toBe('A')
  })

  it('GET /admin/export returns JSON by default', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/export',
      headers: adminHeaders,
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ votes: unknown[]; exported_at: string }>()
    expect(Array.isArray(body.votes)).toBe(true)
  })

  it('GET /admin/export?format=csv returns CSV', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/export?format=csv',
      headers: adminHeaders,
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/csv')
  })
})
