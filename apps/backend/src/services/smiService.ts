import type BetterSqlite3 from 'better-sqlite3'
import { PUBLISH_HOUR, VOTING_CLOSE_HOUR, zurichDate, zurichTimeUTC } from './schedule'

interface DayClose {
  date: string // YYYY-MM-DD
  close: number
}

// Keyless; may be blocked from some cloud egress IPs
async function fetchClosesYahoo(): Promise<DayClose[]> {
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/%5ESSMI?interval=1d&range=1mo'
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = (await res.json()) as {
    chart?: {
      result?: { timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[] } }[]
    }
  }
  const result = json.chart?.result?.[0]
  const timestamps = result?.timestamp ?? []
  const closeValues = result?.indicators?.quote?.[0]?.close ?? []

  const closes: DayClose[] = []
  for (let i = 0; i < timestamps.length; i++) {
    const close = closeValues[i]
    if (close == null) continue // null rows are holidays / gaps
    closes.push({ date: zurichDate(new Date(timestamps[i] * 1000)), close })
  }
  return closes.sort((a, b) => a.date.localeCompare(b.date))
}

// CSV with columns: Date,Open,High,Low,Close,Volume (YYYY-MM-DD dates).
// Stooq serves a JS browser-verification page to non-browser clients as of mid-2026,
// so this usually yields zero rows — kept as a last resort in case that gate is lifted.
async function fetchClosesStooq(): Promise<DayClose[]> {
  const res = await fetch('https://stooq.com/q/d/l/?s=%5Esmi&i=d', {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const text = await res.text()

  const closes: DayClose[] = []
  for (const line of text.trim().split('\n').slice(1)) {
    const parts = line.split(',')
    if (parts.length < 5) continue
    const date = parts[0].trim()
    const close = parseFloat(parts[4])
    if (date && !isNaN(close)) closes.push({ date, close })
  }

  return closes.sort((a, b) => a.date.localeCompare(b.date))
}

export async function fetchRecentCloses(
  log: (msg: string) => void = console.log,
): Promise<DayClose[]> {
  const providers: [string, () => Promise<DayClose[]>][] = [
    ['yahoo', fetchClosesYahoo],
    ['stooq', fetchClosesStooq],
  ]

  for (const [name, fetchCloses] of providers) {
    try {
      const closes = await fetchCloses()
      if (closes.length === 0) throw new Error('no data rows')
      return closes
    } catch (err) {
      log(`[smi] ${name} failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  throw new Error('all SMI data providers failed')
}

function zurichHour(d: Date = new Date()): number {
  return parseInt(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Zurich',
      hour: 'numeric',
      hour12: false,
    }).format(d),
    10,
  )
}

function isZurichWeekday(d: Date = new Date()): boolean {
  const day = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Zurich',
    weekday: 'long',
  }).format(d)
  return day !== 'Saturday' && day !== 'Sunday'
}

interface SmiQuestionRow {
  question_id: number
  question_date: string
  prev_close: number
  prev_date: string
}

export async function createDailySmiQuestion(
  db: BetterSqlite3.Database,
  log: (msg: string) => void = console.log,
): Promise<void> {
  const now = new Date()
  if (!isZurichWeekday(now)) {
    log('[smi] skipped — market is closed on weekends')
    return
  }

  const today = zurichDate(now)

  const existing = db.prepare('SELECT id FROM smi_questions WHERE question_date = ?').get(today)
  if (existing) {
    log(`[smi] question for ${today} already exists`)
    return
  }

  // The daily cron is expected to fire around 08:00 Zurich. If it fires late enough that
  // voting would already be closed, publishing an unvotable question helps nobody.
  const deadline = zurichTimeUTC(today, VOTING_CLOSE_HOUR)
  if (now.toISOString() >= deadline) {
    log(`[smi] skipped — voting for ${today} already closed at ${deadline}`)
    return
  }

  let closes: DayClose[]
  try {
    closes = await fetchRecentCloses(log)
  } catch (err) {
    log(`[smi] fetch error: ${String(err)}`)
    return
  }

  const prevCloses = closes.filter((c) => c.date < today)
  if (prevCloses.length === 0) {
    log('[smi] no previous close available yet')
    return
  }

  const prev = prevCloses[prevCloses.length - 1]
  const prevFormatted = new Date(prev.date + 'T12:00:00Z').toLocaleDateString('en-CH', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })

  // Voting closes at 12:00 Zurich rather than at the 17:30 market close. With the old
  // deadline a voter at 17:25 could just read the live index level and know the answer;
  // now the 12:00–17:30 stretch of the trading day is never observable to voters.
  const publishedAt = zurichTimeUTC(today, PUBLISH_HOUR)

  const qResult = db
    .prepare(
      `INSERT INTO questions (title, description, option_a, option_b, deadline, published_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      'SMI: Higher close today?',
      `The Swiss Market Index (SMI) closed at ${prev.close.toFixed(2)} on ${prevFormatted}. Will it close higher today? Voting closes at 12:00 CET; the question is settled on today's 17:30 close.`,
      'Yes — higher close',
      'No — flat or lower',
      deadline,
      publishedAt,
    )

  db.prepare(
    `INSERT INTO smi_questions (question_date, question_id, prev_close, prev_date)
     VALUES (?, ?, ?, ?)`,
  ).run(today, qResult.lastInsertRowid, prev.close, prev.date)

  log(
    `[smi] created question ${qResult.lastInsertRowid} for ${today} (prev close ${prev.close.toFixed(2)} on ${prev.date})`,
  )
}

export async function resolveExpiredSmiQuestions(
  db: BetterSqlite3.Database,
  log: (msg: string) => void = console.log,
  now: Date = new Date(),
): Promise<void> {
  const today = zurichDate(now)
  const hour = zurichHour(now)

  const pending = db
    .prepare(
      `SELECT sq.question_id, sq.question_date, sq.prev_close, sq.prev_date
       FROM smi_questions sq
       JOIN questions q ON q.id = sq.question_id
       WHERE q.ground_truth IS NULL`,
    )
    .all() as SmiQuestionRow[]

  if (pending.length === 0) return

  let closes: DayClose[]
  try {
    closes = await fetchRecentCloses(log)
  } catch (err) {
    log(`[smi] fetch error during resolution: ${String(err)}`)
    return
  }

  const closeMap = new Map(closes.map((c) => [c.date, c.close]))

  for (const row of pending) {
    const isToday = row.question_date === today
    const isPast = row.question_date < today

    // For today's question, only attempt resolution after 18:00 Zurich
    if (isToday && hour < 18) continue

    const todayClose = closeMap.get(row.question_date)

    if (todayClose == null) {
      if (isPast) cleanUpHoliday(db, row, closes, log)
      continue
    }

    const ground_truth: 'A' | 'B' = todayClose > row.prev_close ? 'A' : 'B'

    db.transaction(() => {
      db.prepare(
        `UPDATE questions SET ground_truth = ?, resolved_at = datetime('now') WHERE id = ?`,
      ).run(ground_truth, row.question_id)
      db.prepare(
        `UPDATE votes SET is_correct = CASE WHEN choice = ? THEN 1 ELSE 0 END WHERE question_id = ?`,
      ).run(ground_truth, row.question_id)
    })()

    const label = ground_truth === 'A' ? 'HIGHER' : 'FLAT/LOWER'
    log(
      `[smi] question ${row.question_id} resolved → ${ground_truth} (${label}: ${todayClose.toFixed(2)} vs ${row.prev_close.toFixed(2)})`,
    )
  }
}

/**
 * A past question date with no close in the feed is *probably* a public holiday, in which
 * case the question was created by mistake and should go away. But "no close yet" also
 * happens when the data provider is simply late: on 2026-09-11 the resolve job ran at
 * 22:03 UTC, Yahoo had not published Friday's close, and in Zurich it was already
 * Saturday — so a real trading day with 43 votes was queued for deletion. Only a FOREIGN
 * KEY on predictor_rounds rolled that back.
 *
 * Two guards, either of which skips the delete:
 *  1. The feed must already contain a *later* trading day than the question date. A feed
 *     that ends before the question date has not caught up yet, holiday or not.
 *  2. A question that people voted on, or that the predictor has committed a round for,
 *     is never deleted automatically. On a real holiday an admin resolves it by hand
 *     (POST /admin/questions/:id/resolve) or removes it (DELETE /admin/questions/:id).
 */
function cleanUpHoliday(
  db: BetterSqlite3.Database,
  row: SmiQuestionRow,
  closes: DayClose[],
  log: (msg: string) => void,
): void {
  const latestFeedDate = closes.length > 0 ? closes[closes.length - 1].date : null
  if (latestFeedDate == null || latestFeedDate <= row.question_date) {
    log(
      `[smi] question ${row.question_id}: no close for ${row.question_date} yet and the feed ends at ${latestFeedDate ?? 'no data'} — waiting for the provider`,
    )
    return
  }

  const voteCount = (
    db.prepare('SELECT COUNT(*) AS n FROM votes WHERE question_id = ?').get(row.question_id) as {
      n: number
    }
  ).n
  const round = db
    .prepare('SELECT round_index FROM predictor_rounds WHERE question_id = ?')
    .get(row.question_id) as { round_index: number } | undefined

  if (voteCount > 0 || round) {
    const reasons = [
      voteCount > 0 ? `${voteCount} vote(s)` : null,
      round ? `predictor round ${round.round_index}` : null,
    ].filter(Boolean)
    log(
      `[smi] question ${row.question_id}: no close for ${row.question_date} (holiday?) but it has ${reasons.join(' and ')} — not deleting. Resolve it via POST /admin/questions/${row.question_id}/resolve or delete it via DELETE /admin/questions/${row.question_id}`,
    )
    return
  }

  log(`[smi] question ${row.question_id}: no data for ${row.question_date} (holiday?), removing`)
  db.transaction(() => {
    db.prepare('DELETE FROM smi_questions WHERE question_id = ?').run(row.question_id)
    db.prepare('DELETE FROM questions WHERE id = ?').run(row.question_id)
  })()
}
