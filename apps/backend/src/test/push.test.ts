import { describe, it, beforeAll, afterAll, expect } from 'vitest'
import { buildTestApp } from './helpers'

describe('/api/push', () => {
  const app = buildTestApp()
  let token: string
  let otherToken: string

  beforeAll(async () => {
    delete process.env.VAPID_PUBLIC_KEY
    delete process.env.VAPID_PRIVATE_KEY

    await app.ready()

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        pseudonym: 'pushuser',
        email: 'pushuser@example.com',
        password: 'pass123',
        consent: true,
      },
    })
    token = res.json<{ token: string }>().token

    const other = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        pseudonym: 'otheruser',
        email: 'otheruser@example.com',
        password: 'pass123',
        consent: true,
      },
    })
    otherToken = other.json<{ token: string }>().token
  })

  afterAll(async () => {
    delete process.env.VAPID_PUBLIC_KEY
    delete process.env.VAPID_PRIVATE_KEY
    await app.close()
  })

  const subscribePayload = (suffix: string) => ({
    endpoint: `https://push.example.com/sub-${suffix}`,
    keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
  })

  describe('GET /vapid-public-key', () => {
    it('rejects unauthenticated requests', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/push/vapid-public-key' })
      expect(res.statusCode).toBe(401)
    })

    it('returns 503 when VAPID keys are not configured', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/push/vapid-public-key',
        headers: { authorization: `Bearer ${token}` },
      })
      expect(res.statusCode).toBe(503)
    })

    it('returns the public key when configured', async () => {
      process.env.VAPID_PUBLIC_KEY = 'test-public-key'
      process.env.VAPID_PRIVATE_KEY = 'test-private-key'
      try {
        const res = await app.inject({
          method: 'GET',
          url: '/api/push/vapid-public-key',
          headers: { authorization: `Bearer ${token}` },
        })
        expect(res.statusCode).toBe(200)
        expect(res.json<{ publicKey: string }>().publicKey).toBe('test-public-key')
      } finally {
        delete process.env.VAPID_PUBLIC_KEY
        delete process.env.VAPID_PRIVATE_KEY
      }
    })
  })

  describe('POST /subscribe', () => {
    it('rejects unauthenticated requests', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/push/subscribe',
        payload: subscribePayload('unauth'),
      })
      expect(res.statusCode).toBe(401)
    })

    it('persists a subscription for the caller', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/push/subscribe',
        headers: { authorization: `Bearer ${token}` },
        payload: subscribePayload('a'),
      })
      expect(res.statusCode).toBe(201)

      const row = app.db
        .prepare('SELECT user_id, p256dh, auth FROM push_subscriptions WHERE endpoint = ?')
        .get(subscribePayload('a').endpoint) as { user_id: number; p256dh: string; auth: string }
      expect(row.p256dh).toBe('p256dh-key')
      expect(row.auth).toBe('auth-key')
    })

    it('upserts when the same endpoint subscribes again under a different user', async () => {
      const endpoint = subscribePayload('a').endpoint

      const res = await app.inject({
        method: 'POST',
        url: '/api/push/subscribe',
        headers: { authorization: `Bearer ${otherToken}` },
        payload: { endpoint, keys: { p256dh: 'new-p256dh', auth: 'new-auth' } },
      })
      expect(res.statusCode).toBe(201)

      const rows = app.db
        .prepare('SELECT user_id, p256dh, auth FROM push_subscriptions WHERE endpoint = ?')
        .all(endpoint) as { user_id: number; p256dh: string; auth: string }[]
      expect(rows).toHaveLength(1)
      expect(rows[0].p256dh).toBe('new-p256dh')
    })

    it('rejects a malformed subscription body', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/push/subscribe',
        headers: { authorization: `Bearer ${token}` },
        payload: { endpoint: 'https://push.example.com/bad' },
      })
      expect(res.statusCode).toBe(400)
    })
  })

  describe('POST /unsubscribe', () => {
    it("does not delete another user's subscription", async () => {
      const endpoint = subscribePayload('b').endpoint
      await app.inject({
        method: 'POST',
        url: '/api/push/subscribe',
        headers: { authorization: `Bearer ${token}` },
        payload: subscribePayload('b'),
      })

      const res = await app.inject({
        method: 'POST',
        url: '/api/push/unsubscribe',
        headers: { authorization: `Bearer ${otherToken}` },
        payload: { endpoint },
      })
      expect(res.statusCode).toBe(204)

      const row = app.db
        .prepare('SELECT id FROM push_subscriptions WHERE endpoint = ?')
        .get(endpoint)
      expect(row).toBeDefined()
    })

    it('deletes the caller own subscription', async () => {
      const endpoint = subscribePayload('b').endpoint

      const res = await app.inject({
        method: 'POST',
        url: '/api/push/unsubscribe',
        headers: { authorization: `Bearer ${token}` },
        payload: { endpoint },
      })
      expect(res.statusCode).toBe(204)

      const row = app.db
        .prepare('SELECT id FROM push_subscriptions WHERE endpoint = ?')
        .get(endpoint)
      expect(row).toBeUndefined()
    })
  })
})
