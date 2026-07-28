import type BetterSqlite3 from 'better-sqlite3'

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3'

interface VideoStatsItem {
  id: string
  statistics: { viewCount?: string }
}

async function fetchCurrentViews(apiKey: string, videoIds: string[]): Promise<Map<string, number>> {
  const url = `${YOUTUBE_API_BASE}/videos?part=statistics&id=${videoIds.join(',')}&key=${apiKey}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`YouTube API ${res.status}`)
  const data = (await res.json()) as { items?: VideoStatsItem[] }
  const map = new Map<string, number>()
  for (const item of data.items ?? []) {
    if (item.statistics.viewCount) {
      map.set(item.id, parseInt(item.statistics.viewCount, 10))
    }
  }
  return map
}

interface StartRow {
  question_id: number
  suggestion_id: number
  video_a_id: string
  video_b_id: string
}

interface EndRow {
  question_id: number
  suggestion_id: number
  video_a_id: string
  video_b_id: string
  race_start_views_a: number
  race_start_views_b: number
  race_start_at: string
}

/**
 * Snapshot the baseline view counts for races whose voting has just closed.
 *
 * The baseline is deliberately NOT taken when the pair is suggested: the measurement window
 * has to begin after voting closes, otherwise voters can watch part of the outcome unfold
 * and simply read off the answer instead of predicting it.
 */
async function snapshotRaceStarts(
  db: BetterSqlite3.Database,
  apiKey: string,
  now: string,
  log: (msg: string) => void,
): Promise<void> {
  const starting = db
    .prepare(
      `SELECT q.id AS question_id, ys.id AS suggestion_id, ys.video_a_id, ys.video_b_id
       FROM   questions q
       JOIN   youtube_suggestions ys ON ys.question_id = q.id
       WHERE  q.race_starts_at IS NOT NULL
         AND  q.race_starts_at <= ?
         AND  ys.race_start_views_a IS NULL`,
    )
    .all(now) as StartRow[]

  for (const row of starting) {
    try {
      const current = await fetchCurrentViews(apiKey, [row.video_a_id, row.video_b_id])
      const a = current.get(row.video_a_id)
      const b = current.get(row.video_b_id)

      if (a == null || b == null) {
        log(`[yt-race] question ${row.question_id}: baseline fetch incomplete, will retry`)
        continue
      }

      db.prepare(
        `UPDATE youtube_suggestions
         SET race_start_views_a = ?, race_start_views_b = ?, race_start_at = ?
         WHERE id = ?`,
      ).run(a, b, now, row.suggestion_id)

      log(
        `[yt-race] question ${row.question_id} baseline captured at ${now}` +
          ` (A=${a.toLocaleString()}, B=${b.toLocaleString()})`,
      )
    } catch (err) {
      log(`[yt-race] question ${row.question_id} baseline failed: ${String(err)}`)
    }
  }
}

/** Close out races whose measurement window has ended and score the votes. */
async function resolveFinishedRaces(
  db: BetterSqlite3.Database,
  apiKey: string,
  now: string,
  log: (msg: string) => void,
): Promise<void> {
  const finished = db
    .prepare(
      `SELECT q.id AS question_id, ys.id AS suggestion_id, ys.video_a_id, ys.video_b_id,
              ys.race_start_views_a, ys.race_start_views_b, ys.race_start_at
       FROM   questions q
       JOIN   youtube_suggestions ys ON ys.question_id = q.id
       WHERE  q.ground_truth IS NULL
         AND  q.race_ends_at IS NOT NULL
         AND  q.race_ends_at <= ?
         AND  ys.race_start_views_a IS NOT NULL
         AND  ys.race_start_views_b IS NOT NULL`,
    )
    .all(now) as EndRow[]

  for (const row of finished) {
    try {
      const current = await fetchCurrentViews(apiKey, [row.video_a_id, row.video_b_id])
      const endA = current.get(row.video_a_id)
      const endB = current.get(row.video_b_id)

      if (endA == null || endB == null) {
        log(`[yt-race] question ${row.question_id}: closing fetch incomplete, will retry`)
        continue
      }

      const deltaA = endA - row.race_start_views_a
      const deltaB = endB - row.race_start_views_b

      if (deltaA === deltaB) {
        log(`[yt-race] question ${row.question_id}: tie (ΔA=${deltaA}, ΔB=${deltaB}), skipping`)
        continue
      }

      const winner: 'A' | 'B' = deltaA > deltaB ? 'A' : 'B'

      db.transaction(() => {
        db.prepare(
          `UPDATE youtube_suggestions
           SET race_end_views_a = ?, race_end_views_b = ?, race_end_at = ?
           WHERE id = ?`,
        ).run(endA, endB, now, row.suggestion_id)

        db.prepare(`UPDATE questions SET ground_truth = ?, resolved_at = ? WHERE id = ?`).run(
          winner,
          now,
          row.question_id,
        )

        db.prepare(
          `UPDATE votes SET is_correct = CASE WHEN choice = ? THEN 1 ELSE 0 END
           WHERE question_id = ?`,
        ).run(winner, row.question_id)
      })()

      const windowMin = Math.round((Date.parse(now) - Date.parse(row.race_start_at)) / 60_000)
      log(
        `[yt-race] question ${row.question_id} resolved → ${winner}` +
          ` (ΔA=${deltaA.toLocaleString()}, ΔB=${deltaB.toLocaleString()};` +
          ` measured over ${windowMin} min)`,
      )
    } catch (err) {
      log(`[yt-race] question ${row.question_id} resolution failed: ${String(err)}`)
    }
  }
}

/**
 * One cron tick: open any races that have started, close any that have ended.
 *
 * Both halves are idempotent, so firing this more often only tightens how closely the real
 * measurement window tracks the nominal one. Any slop applies to both videos equally — they
 * are read in a single API call — so it lengthens the window rather than favouring an option.
 */
export async function runYoutubeRaceTick(
  db: BetterSqlite3.Database,
  apiKey: string,
  log: (msg: string) => void = console.log,
): Promise<void> {
  // deadline/race timestamps are ISO-8601 strings, so compare against one — datetime('now')
  // has a space where the ISO format has 'T', which breaks the lexicographic comparison.
  const now = new Date().toISOString()

  await snapshotRaceStarts(db, apiKey, now, log)
  await resolveFinishedRaces(db, apiKey, now, log)
}
