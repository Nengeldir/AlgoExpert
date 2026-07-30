const RESEND_API_URL = 'https://api.resend.com/emails'
const RESEND_BATCH_URL = 'https://api.resend.com/emails/batch'

// Resend's batch endpoint accepts at most 100 messages per request.
const BATCH_LIMIT = 100
// Resend's default rate limit is 2 requests/second; pause between chunks to stay under it.
const BATCH_PAUSE_MS = 600

export interface EmailMessage {
  to: string
  subject: string
  html: string
}

function fromAddress(): string {
  return process.env.EMAIL_FROM ?? 'Expert Vote <onboarding@resend.dev>'
}

async function postResend(url: string, apiKey: string, payload: unknown): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Resend API ${res.status}: ${body.slice(0, 300)}`)
  }
}

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY

  if (!apiKey) {
    // Local dev fallback — no Resend account required to exercise the reset flow.
    console.log(`[email] password reset for ${to}: ${resetUrl}`)
    return
  }

  await postResend(RESEND_API_URL, apiKey, {
    from: fromAddress(),
    to,
    subject: 'Reset your Expert Vote password',
    html: `<p>Someone requested a password reset for your Expert Vote account.</p>
<p><a href="${resetUrl}">Click here to choose a new password</a>. This link expires in 1 hour.</p>
<p>If you didn't request this, you can safely ignore this email.</p>`,
  })
}

/**
 * Send one message per recipient via Resend's batch endpoint.
 *
 * Deliberately NOT a single email with many `to` addresses: that would expose every
 * participant's address to everyone else, and the whole point of the pseudonyms is that
 * identities stay private.
 *
 * Throws on the first chunk that fails. Callers should treat a throw as "nothing is
 * confirmed sent" and retry on the next tick; with a lecture-sized cohort there is only
 * ever one chunk, so a retry cannot double-send.
 */
export async function sendBatchEmails(
  messages: EmailMessage[],
  log: (msg: string) => void = console.log,
): Promise<void> {
  if (messages.length === 0) return

  const apiKey = process.env.RESEND_API_KEY
  const from = fromAddress()

  if (!apiKey) {
    // Local dev fallback — mirrors the password-reset behaviour so no email account is
    // needed to exercise the notification flow.
    for (const m of messages) {
      log(`[email] (not sent — RESEND_API_KEY unset) to ${m.to}: ${m.subject}`)
    }
    return
  }

  for (let i = 0; i < messages.length; i += BATCH_LIMIT) {
    const chunk = messages.slice(i, i + BATCH_LIMIT)
    await postResend(
      RESEND_BATCH_URL,
      apiKey,
      chunk.map((m) => ({ from, to: m.to, subject: m.subject, html: m.html })),
    )
    if (i + BATCH_LIMIT < messages.length) {
      await new Promise((resolve) => setTimeout(resolve, BATCH_PAUSE_MS))
    }
  }
}
