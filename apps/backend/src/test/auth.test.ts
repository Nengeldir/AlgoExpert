import { describe, it, beforeAll, beforeEach, afterAll, expect, vi } from 'vitest'
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

// Regression guard for the bug that locked a student out for good: they registered with a
// capitalised address, typed it lower-case into the reset form, and — because
// /forgot-password reports success either way — got the confirmation screen and no mail,
// every time they tried.
describe('Email matching is case- and whitespace-insensitive', () => {
  const app = buildTestApp()

  beforeAll(async () => {
    await app.ready()
    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        pseudonym: 'mixedcase',
        email: 'Mixed.Case@ETHZ.ch',
        password: 'original-pw',
        consent: true,
      },
    })
  })
  afterAll(() => app.close())
  beforeEach(() => vi.mocked(sendPasswordResetEmail).mockClear())

  it('stores the address folded to its canonical form', async () => {
    const row = app.db
      .prepare('SELECT email FROM users WHERE pseudonym = ?')
      .get('mixedcase') as { email: string }
    expect(row.email).toBe('mixed.case@ethz.ch')
  })

  it('rejects a duplicate that differs only by case', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        pseudonym: 'mixedcase2',
        email: 'MIXED.CASE@ethz.ch',
        password: 'pw123456',
        consent: true,
      },
    })
    expect(res.statusCode).toBe(409)
  })

  it('logs in with the address in any casing, padded or not', async () => {
    for (const identifier of [
      'Mixed.Case@ETHZ.ch',
      'mixed.case@ethz.ch',
      'MIXED.CASE@ETHZ.CH',
      '  mixed.case@ethz.ch  ',
    ]) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { identifier, password: 'original-pw' },
      })
      expect(res.statusCode, identifier).toBe(200)
    }
  })

  it('sends a reset link for the address in any casing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/forgot-password',
      payload: { email: 'Mixed.Case@ethz.ch' },
    })
    expect(res.statusCode).toBe(200)
    expect(sendPasswordResetEmail).toHaveBeenCalledWith(
      'mixed.case@ethz.ch',
      expect.stringContaining('/reset-password?token='),
    )
  })
})

// expires_at is ISO-8601; comparing it against datetime('now') made an already-expired
// token pass for the rest of the UTC day, and killed a token minted late in that day at
// midnight rather than an hour later. See CLAUDE.md on ISO vs datetime('now').
describe('Reset token expiry', () => {
  const app = buildTestApp()

  beforeAll(async () => {
    await app.ready()
    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        pseudonym: 'expiryuser',
        email: 'expiry@example.com',
        password: 'original-pw',
        consent: true,
      },
    })
  })
  afterAll(() => app.close())

  it('rejects a token that expired earlier the same UTC day', async () => {
    vi.mocked(sendPasswordResetEmail).mockClear()
    await app.inject({
      method: 'POST',
      url: '/api/auth/forgot-password',
      payload: { email: 'expiry@example.com' },
    })

    const call = vi.mocked(sendPasswordResetEmail).mock.calls.at(-1)!
    const token = new URL(call[1]).searchParams.get('token')!

    // Backdate it to one minute ago, keeping the same UTC date.
    app.db
      .prepare('UPDATE password_resets SET expires_at = ? WHERE used_at IS NULL')
      .run(new Date(Date.now() - 60_000).toISOString())

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: { token, password: 'brand-new-pw' },
    })

    expect(res.statusCode).toBe(400)
  })

  it('accepts a token minted in the last minutes of a UTC day', async () => {
    vi.mocked(sendPasswordResetEmail).mockClear()
    await app.inject({
      method: 'POST',
      url: '/api/auth/forgot-password',
      payload: { email: 'expiry@example.com' },
    })

    const call = vi.mocked(sendPasswordResetEmail).mock.calls.at(-1)!
    const token = new URL(call[1]).searchParams.get('token')!

    // An hour from now, but past midnight — the case the old comparison rejected.
    app.db
      .prepare('UPDATE password_resets SET expires_at = ? WHERE used_at IS NULL')
      .run(new Date(Date.now() + 86_400_000).toISOString())

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: { token, password: 'brand-new-pw' },
    })

    expect(res.statusCode).toBe(200)
  })
})
