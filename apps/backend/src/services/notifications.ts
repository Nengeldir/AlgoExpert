import type BetterSqlite3 from 'better-sqlite3'
import { sendBatchEmails, type EmailMessage } from './email'

/**
 * A question published longer ago than this is never emailed about — it is marked as
 * processed and skipped.
 *
 * Without this guard, deploying the feature (or restoring a backup) would blast every
 * still-open question that predates the `notified_at` column. It also stops a cron outage
 * from producing an announcement hours after the fact, when voting is nearly closed.
 */
const MAX_NOTIFY_AGE_MS = 24 * 60 * 60 * 1000

interface PendingQuestionRow {
  id: number
  title: string
  description: string
  option_a: string
  option_b: string
  deadline: string
  published_at: string | null
  created_at: string
}

export interface NotifyOutcome {
  question_id: number
  title: string
  /** Number of opted-in recipients the announcement was sent to */
  recipients: number
  /** Set when the question was marked processed without sending anything */
  skipped?: 'stale'
}

/**
 * Parse a timestamp that may be either ISO-8601 (our own writes) or SQLite's
 * `datetime('now')` output (`YYYY-MM-DD HH:MM:SS`, always UTC, no zone marker).
 * `new Date()` would read the latter as local time.
 */
function parseTimestamp(value: string): number {
  return Date.parse(/[TZ]/.test(value) ? value : `${value.replace(' ', 'T')}Z`)
}

function formatZurich(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Zurich',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso))
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function buildAnnouncement(question: PendingQuestionRow, appUrl: string): Omit<EmailMessage, 'to'> {
  const closes = formatZurich(question.deadline)

  return {
    subject: `New question open for voting: ${question.title}`,
    html: `<p>A new question is open for voting on Expert Vote.</p>
<h2 style="margin-bottom:4px">${escapeHtml(question.title)}</h2>
<p>${escapeHtml(question.description)}</p>
<ul>
  <li><strong>A:</strong> ${escapeHtml(question.option_a)}</li>
  <li><strong>B:</strong> ${escapeHtml(question.option_b)}</li>
</ul>
<p><strong>Voting closes ${closes} (Zurich time)</strong> — after that the question can no longer be answered.</p>
<p><a href="${appUrl}">Open Expert Vote and cast your vote</a></p>
<hr>
<p style="font-size:12px;color:#666">You are receiving this because email notifications are on for
your account. Turn them off any time under <a href="${appUrl}/settings">Settings</a>.</p>`,
  }
}

/**
 * Email every opted-in participant about questions that have become visible since the
 * last run, then mark those questions as processed.
 *
 * Idempotent: `questions.notified_at` is the ledger, so calling this on a tight cron only
 * shortens the delay between a question going live and the announcement going out. It is a
 * cron tick rather than a side effect of question creation because questions are created
 * ahead of their 08:00 publish slot — announcing at creation time would leak the question
 * before it is votable.
 */
export async function dispatchNewQuestionEmails(
  db: BetterSqlite3.Database,
  log: (msg: string) => void = console.log,
): Promise<NotifyOutcome[]> {
  const now = new Date()
  const nowIso = now.toISOString()
  const appUrl = (process.env.CORS_ORIGIN ?? 'http://localhost:5173').replace(/\/$/, '')

  // Mirrors the visibility rule in GET /api/questions: open for voting, and either
  // published or predating the published_at column. Timestamps are ISO strings, so they
  // are compared against an ISO parameter and never against datetime('now').
  const pending = db
    .prepare(
      `SELECT id, title, description, option_a, option_b, deadline, published_at, created_at
       FROM   questions
       WHERE  notified_at IS NULL
         AND  deadline > ?
         AND  (published_at IS NULL OR published_at <= ?)
       ORDER BY id ASC`,
    )
    .all(nowIso, nowIso) as PendingQuestionRow[]

  if (pending.length === 0) {
    log('[notify] no newly published questions')
    return []
  }

  const recipients = db
    .prepare(
      `SELECT email FROM users
       WHERE  email_notifications = 1
         AND  email IS NOT NULL
         AND  email <> ''
       ORDER BY id ASC`,
    )
    .all() as { email: string }[]

  const markNotified = db.prepare('UPDATE questions SET notified_at = ? WHERE id = ?')
  const outcomes: NotifyOutcome[] = []

  for (const question of pending) {
    const publishedAt = parseTimestamp(question.published_at ?? question.created_at)

    if (now.getTime() - publishedAt > MAX_NOTIFY_AGE_MS) {
      markNotified.run(nowIso, question.id)
      log(`[notify] question ${question.id} skipped — published more than 24 h ago`)
      outcomes.push({
        question_id: question.id,
        title: question.title,
        recipients: 0,
        skipped: 'stale',
      })
      continue
    }

    const announcement = buildAnnouncement(question, appUrl)

    try {
      await sendBatchEmails(
        recipients.map(({ email }) => ({ to: email, ...announcement })),
        log,
      )
    } catch (err) {
      // Leave notified_at NULL so the next tick retries this question.
      log(
        `[notify] question ${question.id} failed: ${err instanceof Error ? err.message : String(err)}`,
      )
      continue
    }

    markNotified.run(nowIso, question.id)
    log(`[notify] question ${question.id} announced to ${recipients.length} recipient(s)`)
    outcomes.push({
      question_id: question.id,
      title: question.title,
      recipients: recipients.length,
    })
  }

  return outcomes
}
