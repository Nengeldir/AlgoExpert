const RESEND_API_URL = 'https://api.resend.com/emails'

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.EMAIL_FROM ?? 'Expert Vote <onboarding@resend.dev>'

  if (!apiKey) {
    // Local dev fallback — no Resend account required to exercise the reset flow.
    console.log(`[email] password reset for ${to}: ${resetUrl}`)
    return
  }

  const res = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to,
      subject: 'Reset your Expert Vote password',
      html: `<p>Someone requested a password reset for your Expert Vote account.</p>
<p><a href="${resetUrl}">Click here to choose a new password</a>. This link expires in 1 hour.</p>
<p>If you didn't request this, you can safely ignore this email.</p>`,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Resend API ${res.status}: ${body.slice(0, 300)}`)
  }
}
