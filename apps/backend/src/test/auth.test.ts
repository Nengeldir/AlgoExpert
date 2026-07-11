import { describe, it, beforeAll, afterAll, expect, vi } from 'vitest'
import { buildTestApp, ADMIN_TOKEN, setAdminToken } from './helpers'

vi.mock('../services/email', () => ({
  sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined),
}))

import { sendPasswordResetEmail } from '../services/email'

describe('POST /api/auth/register', () => {
  const app = buildTestApp()
  setAdminToken(ADMIN_TOKEN)

  beforeAll(() => app.ready())
  afterAll(() => app.close())

  it('registers a new user and returns a token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        pseudonym: 'testuser',
        email: 'testuser@example.com',
        password: 'pass123',
        consent: true,
      },
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
      payload: {
        pseudonym: 'dupeuser',
        email: 'dupeuser@example.com',
        password: 'pass123',
        consent: true,
      },
    })
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        pseudonym: 'dupeuser',
        email: 'other@example.com',
        password: 'pass123',
        consent: true,
      },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json<{ error: string }>().error).toMatch(/taken/i)
  })

  it('rejects duplicate email', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        pseudonym: 'emailuser1',
        email: 'shared@example.com',
        password: 'pass123',
        consent: true,
      },
    })
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        pseudonym: 'emailuser2',
        email: 'shared@example.com',
        password: 'pass123',
        consent: true,
      },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json<{ error: string }>().error).toMatch(/email/i)
  })

  it('rejects registration without consent', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        pseudonym: 'newbie',
        email: 'newbie@example.com',
        password: 'pass123',
        consent: false,
      },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects invalid pseudonym characters', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        pseudonym: 'bad name!',
        email: 'badname@example.com',
        password: 'pass123',
        consent: true,
      },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects an invalid email', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { pseudonym: 'bademail', email: 'not-an-email', password: 'pass123', consent: true },
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
      payload: {
        pseudonym: 'loginuser',
        email: 'loginuser@example.com',
        password: 'mypassword',
        consent: true,
      },
    })
  })
  afterAll(() => app.close())

  it('returns a token on valid credentials via pseudonym', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { identifier: 'loginuser', password: 'mypassword' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json<{ token: string }>().token).toBeTruthy()
  })

  it('returns a token on valid credentials via email', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { identifier: 'loginuser@example.com', password: 'mypassword' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json<{ token: string }>().token).toBeTruthy()
  })

  it('rejects wrong password', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { identifier: 'loginuser', password: 'wrongpass' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('rejects an unknown identifier', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { identifier: 'nobody', password: 'whatever' },
    })
    expect(res.statusCode).toBe(401)
  })
})

describe('Password reset flow', () => {
  const app = buildTestApp()

  beforeAll(async () => {
    await app.ready()
    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        pseudonym: 'resetuser',
        email: 'resetuser@example.com',
        password: 'original-pw',
        consent: true,
      },
    })
  })
  afterAll(() => app.close())

  function extractToken(): string {
    const call = vi.mocked(sendPasswordResetEmail).mock.calls.at(-1)
    if (!call) throw new Error('sendPasswordResetEmail was not called')
    const resetUrl = call[1]
    const url = new URL(resetUrl)
    const token = url.searchParams.get('token')
    if (!token) throw new Error('reset URL had no token')
    return token
  }

  it('always returns a generic 200, even for an unknown email', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/forgot-password',
      payload: { email: 'nobody@example.com' },
    })
    expect(res.statusCode).toBe(200)
    expect(sendPasswordResetEmail).not.toHaveBeenCalled()
  })

  it('sends a reset email for a known email', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/forgot-password',
      payload: { email: 'resetuser@example.com' },
    })
    expect(res.statusCode).toBe(200)
    expect(sendPasswordResetEmail).toHaveBeenCalledWith(
      'resetuser@example.com',
      expect.stringContaining('/reset-password?token='),
    )
  })

  it('rejects an invalid token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: { token: 'not-a-real-token', password: 'new-password' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('resets the password with a valid token and invalidates it after use', async () => {
    const token = extractToken()

    const resetRes = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: { token, password: 'new-password' },
    })
    expect(resetRes.statusCode).toBe(200)

    const oldLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { identifier: 'resetuser', password: 'original-pw' },
    })
    expect(oldLogin.statusCode).toBe(401)

    const newLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { identifier: 'resetuser', password: 'new-password' },
    })
    expect(newLogin.statusCode).toBe(200)

    // Token must be single-use
    const reuseRes = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: { token, password: 'another-password' },
    })
    expect(reuseRes.statusCode).toBe(400)
  })
})
