import { describe, it, beforeAll, afterAll, expect } from 'vitest'
import { buildTestApp } from './helpers'

describe('/api/me', () => {
  const app = buildTestApp()
  let token: string

  beforeAll(async () => {
    await app.ready()
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        pseudonym: 'meuser',
        email: 'meuser@example.com',
        password: 'pass123',
        consent: true,
      },
    })
    token = res.json<{ token: string }>().token
  })

  afterAll(() => app.close())

  it('rejects unauthenticated requests', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/me' })
    expect(res.statusCode).toBe(401)
  })

  it('returns the caller profile with notifications enabled by default', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    const { profile } = res.json<{
      profile: { pseudonym: string; email: string; email_notifications: boolean }
    }>()
    expect(profile.pseudonym).toBe('meuser')
    expect(profile.email).toBe('meuser@example.com')
    expect(profile.email_notifications).toBe(true)
  })

  it('updates email notification preference', async () => {
    const patch = await app.inject({
      method: 'PATCH',
      url: '/api/me/settings',
      headers: { authorization: `Bearer ${token}` },
      payload: { email_notifications: false },
    })
    expect(patch.statusCode).toBe(200)
    expect(patch.json<{ email_notifications: boolean }>().email_notifications).toBe(false)

    const res = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(
      res.json<{ profile: { email_notifications: boolean } }>().profile.email_notifications,
    ).toBe(false)
  })

  it('rejects a settings update without the email_notifications field', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/me/settings',
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    })
    expect(res.statusCode).toBe(400)
  })
})
