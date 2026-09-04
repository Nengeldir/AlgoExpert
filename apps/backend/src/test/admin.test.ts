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

describe('Admin account recovery', () => {
  const app = buildTestApp()
  setAdminToken(ADMIN_TOKEN)

  const adminHeaders = { Authorization: `Bearer ${ADMIN_TOKEN}` }

  beforeAll(async () => {
    await app.ready()
    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        pseudonym: 'lockedout',
        email: 'Locked.Out@ethz.ch',
        password: 'original-pw',
        consent: true,
      },
    })
  })
  afterAll(() => app.close())

  it('requires the admin token', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/users?q=locked' })
    expect(res.statusCode).toBe(403)
  })

  it('rejects a search term that is too short to be a search', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/users?q=l', headers: adminHeaders })
    expect(res.statusCode).toBe(400)
  })

  it('finds a user by a fragment of the pseudonym or the email', async () => {
    for (const q of ['ckedo', 'LOCKED.OUT', 'ethz.ch']) {
      const res = await app.inject({ method: 'GET', url: `/admin/users?q=${q}`, headers: adminHeaders })
      expect(res.statusCode, q).toBe(200)
      const { users } = res.json<{ users: { pseudonym: string; email: string }[] }>()
      expect(users.map((u) => u.pseudonym), q).toContain('lockedout')
    }
  })

  it('mints a working reset link without sending mail by default', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/users?q=lockedout', headers: adminHeaders })
    const { users } = res.json<{ users: { id: number }[] }>()

    const minted = await app.inject({
      method: 'POST',
      url: `/admin/users/${users[0].id}/reset-link`,
      headers: adminHeaders,
      payload: {},
    })
    expect(minted.statusCode).toBe(200)

    const body = minted.json<{ reset_url: string; sent: boolean; expires_at: string }>()
    expect(body.sent).toBe(false)
    expect(Date.parse(body.expires_at)).toBeGreaterThan(Date.now())

    const token = new URL(body.reset_url).searchParams.get('token')!
    const used = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: { token, password: 'operator-issued-pw' },
    })
    expect(used.statusCode).toBe(200)

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { identifier: 'lockedout', password: 'operator-issued-pw' },
    })
    expect(login.statusCode).toBe(200)
  })

  it('404s for an unknown user', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/users/99999/reset-link',
      headers: adminHeaders,
      payload: {},
    })
    expect(res.statusCode).toBe(404)
  })
})
