import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildTestApp, ADMIN_TOKEN, setAdminToken } from './helpers'

/**
 * Every automated job is an external HTTP POST with no parameters, and schedulers phrase
 * that differently: cron-job.org sends `application/json`, `application/x-www-form-urlencoded`
 * or no Content-Type at all, always with an empty body.
 *
 * Getting this wrong fails in the worst possible way — the endpoint 400s, the scheduler
 * records a red tick nobody is watching, and questions quietly stop being created or
 * predicted. Fastify's built-in JSON parser rejects an empty body outright, so the
 * `application/json` case in particular has to be overridden explicitly.
 */
const CRON_ENDPOINTS = ['/admin/notifications/dispatch', '/admin/predictor/tick']

let app: FastifyInstance

beforeEach(async () => {
  setAdminToken(ADMIN_TOKEN)
  app = buildTestApp()
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

describe('cron endpoints accept a parameter-less POST', () => {
  for (const url of CRON_ENDPOINTS) {
    it(`${url} — empty body, Content-Type: application/json`, async () => {
      const res = await app.inject({
        method: 'POST',
        url,
        headers: { authorization: `Bearer ${ADMIN_TOKEN}`, 'content-type': 'application/json' },
        payload: '',
      })
      expect(res.statusCode).toBe(200)
    })

    it(`${url} — empty body, Content-Type: application/x-www-form-urlencoded`, async () => {
      const res = await app.inject({
        method: 'POST',
        url,
        headers: {
          authorization: `Bearer ${ADMIN_TOKEN}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        payload: '',
      })
      expect(res.statusCode).toBe(200)
    })

    it(`${url} — no body and no Content-Type`, async () => {
      const res = await app.inject({
        method: 'POST',
        url,
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      })
      expect(res.statusCode).toBe(200)
    })
  }

  it('still rejects a body that claims to be JSON but is not', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/predictor/tick',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}`, 'content-type': 'application/json' },
      payload: '{not json',
    })
    expect(res.statusCode).toBe(400)
  })

  it('still parses a real JSON body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/questions',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}`, 'content-type': 'application/json' },
      payload: JSON.stringify({
        title: 'Q',
        description: 'D',
        option_a: 'Yes',
        option_b: 'No',
        deadline: '2026-12-31T23:59:00.000Z',
      }),
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().question.title).toBe('Q')
  })
})
