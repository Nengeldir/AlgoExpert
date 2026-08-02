import webpush from 'web-push'
import type BetterSqlite3 from 'better-sqlite3'

export interface PushPayload {
  title: string
  body: string
  url: string
}

interface SubscriptionRow {
  id: number
  endpoint: string
  p256dh: string
  auth: string
}

function configureVapid(): boolean {
  const publicKey = process.env.VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY

  if (!publicKey || !privateKey) return false

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? 'mailto:admin@example.com',
    publicKey,
    privateKey,
  )
  return true
}

/**
 * Best-effort web push fan-out to every subscribed browser. Unlike email, a failure here
 * never blocks or retries — an expired subscription (404/410, the standard push-service
 * "gone" signal) is pruned, anything else is logged and skipped.
 */
export async function sendPushToAll(
  db: BetterSqlite3.Database,
  payload: PushPayload,
  log: (msg: string) => void = console.log,
): Promise<void> {
  if (!configureVapid()) {
    log('[push] VAPID keys not set — skipping web push')
    return
  }

  const subscriptions = db
    .prepare('SELECT id, endpoint, p256dh, auth FROM push_subscriptions')
    .all() as SubscriptionRow[]

  if (subscriptions.length === 0) return

  const deleteSubscription = db.prepare('DELETE FROM push_subscriptions WHERE id = ?')
  const body = JSON.stringify(payload)

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        body,
      )
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode
      if (statusCode === 404 || statusCode === 410) {
        deleteSubscription.run(sub.id)
        log(`[push] pruned expired subscription ${sub.id}`)
      } else {
        log(
          `[push] failed for subscription ${sub.id}: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
  }
}
