import { describe, it, beforeAll, afterAll, expect } from 'vitest'
import { buildTestApp, ADMIN_TOKEN, setAdminToken } from './helpers'
import type { NotifyOutcome } from '../services/notifications'

describe('New-question email notifications', () => {
  const app = buildTestApp()
  setAdminToken(ADMIN_TOKEN)

  const adminHeaders = { Authorization: `Bearer ${ADMIN_TOKEN}` }

  beforeAll(async () => {
    // No Resend key: sendBatchEmails logs instead of calling the API, so the whole flow
    // runs without network access. Same for VAPID — no keys means sendPushToAll logs and
    // returns instead of calling a push service.
    delete process.env.RESEND_API_KEY
    delete process.env.VAPID_PUBLIC_KEY
    delete process.env.VAPID_PRIVATE_KEY
    await app.ready()
  })
  afterAll(() => app.close())

  function register(pseudonym: string, email: string) {
    return app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { pseudonym, email, password: 'password123', consent: true },
    })
  }

  function insertQuestion(fields: {
    title: string
    deadline: string
    published_at?: string | null
    created_at?: string
  }) {
    const result = app.db
      .prepare(
        `INSERT INTO questions (title, description, option_a, option_b, deadline, published_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        fields.title,
        'Description with <script> in it',
        'Yes',
        'No',
        fields.deadline,
        fields.published_at ?? null,
        fields.created_at ?? new Date().toISOString(),
      )
    return Number(result.lastInsertRowid)
  }

  function dispatch() {
    return app.inject({
      method: 'POST',
      url: '/admin/notifications/dispatch',
      headers: adminHeaders,
    })
  }

  const inOneHour = () => new Date(Date.now() + 3_600_000).toISOString()
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()

  it('requires the admin token', async () => {
    const res = await app.inject({ method: 'POST', url: '/admin/notifications/dispatch' })
    expect(res.statusCode).toBe(403)
  })

  it('announces a published, open question to opted-in participants exactly once', async () => {
    await register('alice', 'alice@example.com')
    await register('bob', 'bob@example.com')

    const id = insertQuestion({
      title: 'Published question',
      deadline: inOneHour(),
      published_at: hoursAgo(1),
    })

    const first = await dispatch()
    expect(first.statusCode).toBe(200)
    const { notified, log } = first.json<{ notified: NotifyOutcome[]; log: string[] }>()
    expect(notified).toEqual([{ question_id: id, title: 'Published question', recipients: 2 }])
    // Push is attempted alongside email but skips cleanly without VAPID keys configured.
    expect(log).toContain('[push] VAPID keys not set — skipping web push')

    // notified_at is the ledger — a second tick must not re-announce
    const second = await dispatch()
    expect(second.json<{ notified: NotifyOutcome[] }>().notified).toEqual([])
  })

  it('skips participants who turned email notifications off', async () => {
    app.db.prepare(`UPDATE users SET email_notifications = 0 WHERE pseudonym = 'bob'`).run()

    const id = insertQuestion({
      title: 'Opt-out question',
      deadline: inOneHour(),
      published_at: hoursAgo(1),
    })

    const { notified } = (await dispatch()).json<{ notified: NotifyOutcome[] }>()
    expect(notified).toEqual([{ question_id: id, title: 'Opt-out question', recipients: 1 }])
  })

  it('does not announce a question that is not published yet', async () => {
    const id = insertQuestion({
      title: 'Future question',
      deadline: new Date(Date.now() + 7_200_000).toISOString(),
      published_at: new Date(Date.now() + 3_600_000).toISOString(),
    })

    const { notified } = (await dispatch()).json<{ notified: NotifyOutcome[] }>()
    expect(notified).toEqual([])

    const row = app.db.prepare('SELECT notified_at FROM questions WHERE id = ?').get(id) as {
      notified_at: string | null
    }
    expect(row.notified_at).toBeNull()
  })

  it('does not announce a question whose voting has already closed', async () => {
    insertQuestion({
      title: 'Closed question',
      deadline: hoursAgo(1),
      published_at: hoursAgo(5),
    })

    const { notified } = (await dispatch()).json<{ notified: NotifyOutcome[] }>()
    expect(notified).toEqual([])
  })

  it('marks a long-published question as processed without emailing about it', async () => {
    const id = insertQuestion({
      title: 'Stale question',
      deadline: inOneHour(),
      published_at: hoursAgo(30),
    })

    const { notified } = (await dispatch()).json<{ notified: NotifyOutcome[] }>()
    expect(notified).toEqual([
      { question_id: id, title: 'Stale question', recipients: 0, skipped: 'stale' },
    ])

    const row = app.db.prepare('SELECT notified_at FROM questions WHERE id = ?').get(id) as {
      notified_at: string | null
    }
    expect(row.notified_at).not.toBeNull()
  })

  it('treats a NULL published_at as published, using created_at for the staleness check', async () => {
    // Manually created questions (POST /admin/questions) leave published_at NULL and are
    // visible immediately. created_at is written by SQLite in `YYYY-MM-DD HH:MM:SS` form.
    const result = app.db
      .prepare(
        `INSERT INTO questions (title, description, option_a, option_b, deadline)
         VALUES ('Manual question', 'D', 'Yes', 'No', ?)`,
      )
      .run(inOneHour())
    const id = Number(result.lastInsertRowid)

    const { notified } = (await dispatch()).json<{ notified: NotifyOutcome[] }>()
    expect(notified).toEqual([{ question_id: id, title: 'Manual question', recipients: 1 }])
  })
})
