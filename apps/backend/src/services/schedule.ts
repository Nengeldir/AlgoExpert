// Daily schedule anchors, all expressed in Europe/Zurich wall-clock time.
//
// Every question follows the same shape so the voting window never overlaps the window
// being measured — otherwise a late voter can simply observe the outcome instead of
// predicting it:
//
//   08:00  publish        question becomes visible, voting opens
//   12:00  voting closes  measurement window STARTS here
//   24:00  race ends      measurement window ends, question resolves
//
export const PUBLISH_HOUR = 8
export const VOTING_CLOSE_HOUR = 12
export const RACE_END_HOUR = 24 // midnight at the end of the same Zurich day

/** YYYY-MM-DD for a moment, in Europe/Zurich. */
export function zurichDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich' }).format(d)
}

/**
 * UTC ISO string for `hour:minute` Europe/Zurich wall-clock on a given YYYY-MM-DD.
 * Handles the CET/CEST switch by probing the offset on that specific date rather than
 * assuming a fixed +01:00, so the anchors don't drift by an hour twice a year.
 *
 * `hour` may be >= 24 to mean "that many hours past midnight", e.g. 24 = end of day.
 */
export function zurichTimeUTC(zurichDateStr: string, hour: number, minute = 0): string {
  const dayOffset = Math.floor(hour / 24)
  const hourOfDay = hour % 24

  const base = new Date(`${zurichDateStr}T00:00:00Z`)
  base.setUTCDate(base.getUTCDate() + dayOffset)
  const probeDate = base.toISOString().slice(0, 10)

  const hh = String(hourOfDay).padStart(2, '0')
  const mm = String(minute).padStart(2, '0')

  // Probe the target wall-clock as if it were UTC, then correct by the observed offset
  const probe = new Date(`${probeDate}T${hh}:${mm}:00Z`)
  const zurichHM = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Zurich',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(probe)
  const [zh, zm] = zurichHM.split(':').map(Number)
  const diffMs = (hourOfDay * 60 + minute - (zh * 60 + zm)) * 60 * 1000

  return new Date(probe.getTime() + diffMs).toISOString()
}

export interface QuestionSchedule {
  /** Zurich date the question belongs to (YYYY-MM-DD) */
  questionDate: string
  publishedAt: string
  /** Voting closes here; also the start of the measurement window */
  deadline: string
  raceStartsAt: string
  raceEndsAt: string
}

/**
 * Build the schedule for the next question slot.
 *
 * Admin actions happen at arbitrary times, so the slot is chosen relative to the anchors
 * rather than to `Date.now()`: approving at 07:00 or at 11:00 both target today's 12:00
 * close, while approving after 12:00 targets tomorrow. This decouples when you click from
 * when the question runs.
 */
export function nextQuestionSchedule(now: Date = new Date()): QuestionSchedule {
  let questionDate = zurichDate(now)

  // Once today's voting window has closed, the next slot is tomorrow
  if (now.toISOString() >= zurichTimeUTC(questionDate, VOTING_CLOSE_HOUR)) {
    const next = new Date(`${questionDate}T00:00:00Z`)
    next.setUTCDate(next.getUTCDate() + 1)
    questionDate = next.toISOString().slice(0, 10)
  }

  return {
    questionDate,
    publishedAt: zurichTimeUTC(questionDate, PUBLISH_HOUR),
    deadline: zurichTimeUTC(questionDate, VOTING_CLOSE_HOUR),
    raceStartsAt: zurichTimeUTC(questionDate, VOTING_CLOSE_HOUR),
    raceEndsAt: zurichTimeUTC(questionDate, RACE_END_HOUR),
  }
}
