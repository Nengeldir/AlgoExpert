import type { FastifyInstance } from 'fastify'
import { requireAdmin } from '../plugins/authenticate'
import { fetchYoutubePair } from '../services/youtube'
import { runYoutubeRaceTick } from '../services/youtubeResolver'
import { nextQuestionSchedule } from '../services/schedule'
import type { QuestionRow } from '../types'

export interface YoutubeSuggestionRow {
  id: number
  suggested_date: string
  video_a_id: string
  video_a_title: string
  video_a_channel: string
  video_a_thumbnail: string | null
  video_a_subscribers: number | null
  video_a_published_at: string | null
  video_a_views: number | null
  video_b_id: string
  video_b_title: string
  video_b_channel: string
  video_b_thumbnail: string | null
  video_b_subscribers: number | null
  video_b_published_at: string | null
  video_b_views: number | null
  approved: number
  question_id: number | null
  created_at: string
}

// CET = UTC+1 (fixed offset; used only for the one-per-day slot key)
function getCetDate(): string {
  return new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 10)
}

export async function youtubeRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAdmin)

  // GET /admin/youtube/suggest — returns today's suggestion, generating it if it doesn't exist yet
  // Pass ?refresh=true to discard the cached suggestion and fetch a new pair from YouTube
  app.get<{ Querystring: { refresh?: string } }>('/suggest', {
    handler: async (request, reply) => {
      const today = getCetDate()
      const forceRefresh = request.query.refresh === 'true'

      const existing = app.db
        .prepare('SELECT * FROM youtube_suggestions WHERE suggested_date = ?')
        .get(today) as YoutubeSuggestionRow | undefined

      if (existing) {
        if (!forceRefresh) {
          return reply.send({ suggestion: existing, already_generated: true })
        }
        // Discard the cached suggestion so a fresh pair is fetched below
        app.db.prepare('DELETE FROM youtube_suggestions WHERE id = ?').run(existing.id)
      }

      const apiKey = process.env.YOUTUBE_API_KEY
      if (!apiKey) {
        return reply.status(503).send({ error: 'YOUTUBE_API_KEY is not configured on the server.' })
      }

      let pair
      try {
        pair = await fetchYoutubePair(apiKey)
      } catch (err) {
        return reply
          .status(502)
          .send({ error: `YouTube API failed: ${err instanceof Error ? err.message : 'unknown'}` })
      }

      const result = app.db
        .prepare(
          `INSERT INTO youtube_suggestions
             (suggested_date,
              video_a_id, video_a_title, video_a_channel, video_a_thumbnail, video_a_subscribers, video_a_published_at, video_a_views,
              video_b_id, video_b_title, video_b_channel, video_b_thumbnail, video_b_subscribers, video_b_published_at, video_b_views)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          today,
          pair.videoA.videoId,
          pair.videoA.videoTitle,
          pair.videoA.channelTitle,
          pair.videoA.thumbnail,
          pair.videoA.subscribers,
          pair.videoA.publishedAt,
          pair.videoA.viewCount,
          pair.videoB.videoId,
          pair.videoB.videoTitle,
          pair.videoB.channelTitle,
          pair.videoB.thumbnail,
          pair.videoB.subscribers,
          pair.videoB.publishedAt,
          pair.videoB.viewCount,
        )

      const row = app.db
        .prepare('SELECT * FROM youtube_suggestions WHERE id = ?')
        .get(result.lastInsertRowid) as YoutubeSuggestionRow

      return reply.status(201).send({ suggestion: row, already_generated: false })
    },
  })

  // POST /admin/youtube/resolve — drives both ends of the measurement window: snapshots
  // baseline views for races that have just started, and resolves races that have ended.
  // Both halves are idempotent, so call this every 5 minutes from an external cron service;
  // a tighter interval keeps the real window closer to the nominal 12 h.
  app.post('/resolve', {
    handler: async (_request, reply) => {
      const apiKey = process.env.YOUTUBE_API_KEY
      if (!apiKey) {
        return reply.status(503).send({ error: 'YOUTUBE_API_KEY is not configured on the server.' })
      }
      const messages: string[] = []
      await runYoutubeRaceTick(app.db, apiKey, (msg) => messages.push(msg))
      return reply.send({ ok: true, log: messages })
    },
  })

  // POST /admin/youtube/approve — approve today's pending suggestion and publish it as a question
  app.post('/approve', {
    handler: async (_request, reply) => {
      const today = getCetDate()

      const suggestion = app.db
        .prepare('SELECT * FROM youtube_suggestions WHERE suggested_date = ? AND approved = 0')
        .get(today) as YoutubeSuggestionRow | undefined

      if (!suggestion) {
        return reply.status(404).send({
          error: 'No pending YouTube suggestion for today. Already approved or none generated.',
        })
      }

      // Timestamps come from the fixed daily anchors, not from when this endpoint was hit,
      // so approving early or late does not shift the window students vote in.
      const schedule = nextQuestionSchedule()

      const fmtViews = (n: number | null) =>
        n == null
          ? '?'
          : n >= 1_000_000
            ? `${(n / 1_000_000).toFixed(1)}M`
            : n >= 1_000
              ? `${(n / 1_000).toFixed(1)}K`
              : String(n)

      const title = `YouTube 12 h Race: Which video gains more views?`
      const description =
        `The race runs from 12:00 to 24:00 CET today — it starts when voting closes, so no ` +
        `part of it can be observed while you are still deciding. Which will gain more views ` +
        `in that window: "${suggestion.video_a_title}" by ${suggestion.video_a_channel} ` +
        `(${fmtViews(suggestion.video_a_views)} views when this question was drawn) or ` +
        `"${suggestion.video_b_title}" by ${suggestion.video_b_channel} ` +
        `(${fmtViews(suggestion.video_b_views)} views when this question was drawn)?`
      const option_a = `${suggestion.video_a_title} — ${suggestion.video_a_channel}`
      const option_b = `${suggestion.video_b_title} — ${suggestion.video_b_channel}`

      let questionId: number | bigint
      const approve = app.db.transaction(() => {
        const qResult = app.db
          .prepare(
            `INSERT INTO questions (title, description, option_a, option_b, deadline, option_a_image, option_b_image, option_a_views, option_b_views, published_at, race_starts_at, race_ends_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            title,
            description,
            option_a,
            option_b,
            schedule.deadline,
            suggestion.video_a_thumbnail,
            suggestion.video_b_thumbnail,
            suggestion.video_a_views,
            suggestion.video_b_views,
            schedule.publishedAt,
            schedule.raceStartsAt,
            schedule.raceEndsAt,
          )

        app.db
          .prepare('UPDATE youtube_suggestions SET approved = 1, question_id = ? WHERE id = ?')
          .run(qResult.lastInsertRowid, suggestion.id)

        questionId = qResult.lastInsertRowid
      })

      approve()

      const question = app.db
        .prepare('SELECT * FROM questions WHERE id = ?')
        .get(questionId!) as QuestionRow

      return reply.status(201).send({ question })
    },
  })
}
