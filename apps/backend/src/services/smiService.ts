import type BetterSqlite3 from 'better-sqlite3'

const SMI_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/%5ESSMI'

interface YahooChartResponse {
  chart: {
    result?: Array<{
      timestamp: number[]
      indicators: { quote: Array<{ close: (number | null)[] }> }
    }>
    error?: { code: string; description: string } | null
  }
}

interface DayClose {
  date: string // YYYY-MM-DD (UTC calendar date from Yahoo timestamp)
  close: number
}

async function fetchRecentCloses(): Promise<DayClose[]> {
  const res = await fetch(`${SMI_URL}?interval=1d&range=7d`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  })
  if (!res.ok) throw new Error(`Yahoo Finance HTTP ${res.status}`)
  const data = (await res.json()) as YahooChartResponse
  if (data.chart.error) throw new Error(`Yahoo Finance: ${data.chart.error.description}`)

  const result = data.chart.result?.[0]
  if (!result) throw new Error('No SMI data in response')

  const closes: DayClose[] = []
  const { timestamp } = result
  const closeArr = result.indicators.quote[0].close

  for (let i = 0; i < timestamp.length; i++) {
    const close = closeArr[i]
    if (close != null) {
      closes.push({ date: new Date(timestamp[i] * 1000).toISOString().slice(0, 10), close })
    }
  }

  return closes.sort((a, b) => a.date.localeCompare(b.date))
}

function zurichDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich' }).format(d)
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

// Returns the UTC ISO string for 17:30 Europe/Zurich on a given YYYY-MM-DD date
function marketCloseUTC(zurichDateStr: string): string {
  // Probe UTC 17:30 on that date and measure the Zurich offset to correct it
  const probe = new Date(`${zurichDateStr}T17:30:00Z`)
  const zurichHM = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Zurich',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(probe)
  const [zh, zm] = zurichHM.split(':').map(Number)
  const diffMs = (17 * 60 + 30 - (zh * 60 + zm)) * 60 * 1000
  return new Date(probe.getTime() + diffMs).toISOString()
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
  if (!isZurichWeekday(now)) return

  const today = zurichDate(now)

  const existing = db.prepare('SELECT id FROM smi_questions WHERE question_date = ?').get(today)
  if (existing) return

  let closes: DayClose[]
  try {
    closes = await fetchRecentCloses()
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

  const deadline = marketCloseUTC(today)

  const qResult = db
    .prepare(
      `INSERT INTO questions (title, description, option_a, option_b, deadline)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      'SMI: Higher close today?',
      `The Swiss Market Index (SMI) closed at ${prev.close.toFixed(2)} on ${prevFormatted}. Will it close higher today?`,
      'Yes — higher close',
      'No — flat or lower',
      deadline,
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
): Promise<void> {
  const now = new Date()
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
    closes = await fetchRecentCloses()
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
      if (isPast) {
        // No data for a past date — most likely a public holiday; remove the question
        log(
          `[smi] question ${row.question_id}: no data for ${row.question_date} (holiday?), removing`,
        )
        db.transaction(() => {
          db.prepare('DELETE FROM votes WHERE question_id = ?').run(row.question_id)
          db.prepare('DELETE FROM smi_questions WHERE question_id = ?').run(row.question_id)
          db.prepare('DELETE FROM questions WHERE id = ?').run(row.question_id)
        })()
      }
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
