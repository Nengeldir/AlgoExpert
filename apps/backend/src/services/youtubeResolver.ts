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

interface PendingRow {
  question_id: number
  video_a_id: string
  video_b_id: string
  video_a_views: number
  video_b_views: number
}

export async function resolveExpiredYoutubeQuestions(
  db: BetterSqlite3.Database,
  apiKey: string,
  log: (msg: string) => void = console.log,
): Promise<void> {
  const pending = db
    .prepare(
      `SELECT q.id          AS question_id,
              ys.video_a_id, ys.video_b_id,
              ys.video_a_views, ys.video_b_views
       FROM   questions q
       JOIN   youtube_suggestions ys ON ys.question_id = q.id
       WHERE  q.ground_truth IS NULL
         AND  q.deadline < datetime('now')
         AND  ys.video_a_views IS NOT NULL
         AND  ys.video_b_views IS NOT NULL`,
    )
    .all() as PendingRow[]

  if (pending.length === 0) return

  for (const row of pending) {
    try {
      const current = await fetchCurrentViews(apiKey, [row.video_a_id, row.video_b_id])
      const curA = current.get(row.video_a_id)
      const curB = current.get(row.video_b_id)

      if (curA == null || curB == null) {
        log(`[yt-resolver] question ${row.question_id}: could not fetch view counts, skipping`)
        continue
      }

      const deltaA = curA - row.video_a_views
      const deltaB = curB - row.video_b_views

      if (deltaA === deltaB) {
        log(`[yt-resolver] question ${row.question_id}: tie (ΔA=${deltaA}, ΔB=${deltaB}), skipping`)
        continue
      }

      const winner: 'A' | 'B' = deltaA > deltaB ? 'A' : 'B'

      db.transaction(() => {
        db.prepare(
          `UPDATE questions SET ground_truth = ?, resolved_at = datetime('now') WHERE id = ?`,
        ).run(winner, row.question_id)

        db.prepare(
          `UPDATE votes SET is_correct = CASE WHEN choice = ? THEN 1 ELSE 0 END
           WHERE question_id = ?`,
        ).run(winner, row.question_id)
      })()

      log(
        `[yt-resolver] question ${row.question_id} auto-resolved → ${winner}` +
          ` (ΔA=${deltaA.toLocaleString()}, ΔB=${deltaB.toLocaleString()})`,
      )
    } catch (err) {
      log(`[yt-resolver] question ${row.question_id} failed: ${String(err)}`)
    }
  }
}
