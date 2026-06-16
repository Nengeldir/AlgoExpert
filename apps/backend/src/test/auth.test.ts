import { describe, it, beforeAll, afterAll, expect } from 'vitest'
import { buildTestApp, ADMIN_TOKEN, setAdminToken } from './helpers'

describe('POST /api/auth/register', () => {
  const app = buildTestApp()
  setAdminToken(ADMIN_TOKEN)

  beforeAll(() => app.ready())
  afterAll(() => app.close())

  it('registers a new user and returns a token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { pseudonym: 'testuser', password: 'pass123', consent: true },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json<{ token: string; pseudonym: string }>()
    expect(body.token).toBeTruthy()
    expect(body.pseudonym).toBe('testuser')
  })

  it('rejects duplicate pseudonym', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { pseudonym: 'dupeuser', password: 'pass123', consent: true },
    })
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { pseudonym: 'dupeuser', password: 'pass123', consent: true },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json<{ error: string }>().error).toMatch(/taken/i)
  })

  it('rejects registration without consent', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { pseudonym: 'newbie', password: 'pass123', consent: false },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects invalid pseudonym characters', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { pseudonym: 'bad name!', password: 'pass123', consent: true },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('POST /api/auth/login', () => {
  const app = buildTestApp()

  beforeAll(async () => {
    await app.ready()
    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { pseudonym: 'loginuser', password: 'mypassword', consent: true },
    })
  })
  afterAll(() => app.close())

  it('returns a token on valid credentials', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { pseudonym: 'loginuser', password: 'mypassword' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json<{ token: string }>().token).toBeTruthy()
  })

  it('rejects wrong password', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { pseudonym: 'loginuser', password: 'wrongpass' },
    })
    expect(res.statusCode).toBe(401)
  })
})
