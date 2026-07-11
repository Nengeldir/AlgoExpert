import { describe, it, beforeAll, afterAll, expect } from 'vitest'
import { buildTestApp, ADMIN_TOKEN, setAdminToken } from './helpers'

async function registerAndLogin(app: ReturnType<typeof buildTestApp>, pseudonym: string) {
  await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { pseudonym, email: `${pseudonym}@example.com`, password: 'pass123', consent: true },
  })
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { identifier: pseudonym, password: 'pass123' },
  })
  return res.json<{ token: string }>().token
}

describe('GET /api/questions', () => {
  const app = buildTestApp()
  setAdminToken(ADMIN_TOKEN)
  let token: string

  beforeAll(async () => {
    await app.ready()
    token = await registerAndLogin(app, 'quser')

    // Create an open question via admin
    await app.inject({
      method: 'POST',
      url: '/admin/questions',
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
      payload: {
        title: 'Open Q',
        description: 'Desc',
        option_a: 'Yes',
        option_b: 'No',
        deadline: new Date(Date.now() + 86400000).toISOString(),
      },
    })
  })
  afterAll(() => app.close())

  it('requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/questions' })
    expect(res.statusCode).toBe(401)
  })

  it('returns questions with vote status', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/questions',
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ questions: { id: number; user_vote: null }[] }>()
    expect(body.questions.length).toBeGreaterThan(0)
    expect(body.questions[0].user_vote).toBeNull()
  })
})

describe('POST /api/votes', () => {
  const app = buildTestApp()
  setAdminToken(ADMIN_TOKEN)
  let token: string
  let questionId: number

  beforeAll(async () => {
    await app.ready()
    token = await registerAndLogin(app, 'voter1')

    const qRes = await app.inject({
      method: 'POST',
      url: '/admin/questions',
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
      payload: {
        title: 'Votable',
        description: 'Desc',
        option_a: 'A',
        option_b: 'B',
        deadline: new Date(Date.now() + 86400000).toISOString(),
      },
    })
    questionId = qRes.json<{ question: { id: number } }>().question.id
  })
  afterAll(() => app.close())

  it('allows a valid vote', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/votes',
      headers: { Authorization: `Bearer ${token}` },
      payload: { question_id: questionId, choice: 'A' },
    })
    expect(res.statusCode).toBe(201)
  })

  it('rejects duplicate vote', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/votes',
      headers: { Authorization: `Bearer ${token}` },
      payload: { question_id: questionId, choice: 'B' },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json<{ error: string }>().error).toMatch(/already voted/i)
  })
})
