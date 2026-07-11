import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import AuthCard from '../components/AuthCard'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await api.forgotPassword(email)
      setSent(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <AuthCard>
        <h1 className="auth-heading">Check your email</h1>
        <p className="form-hint">
          If that email is registered, we&apos;ve sent a link to reset your password. It expires in
          1 hour.
        </p>
        <div style={{ marginTop: 'var(--space-6)' }}>
          <Link to="/login" className="btn btn--primary">
            Back to login
          </Link>
        </div>
      </AuthCard>
    )
  }

  return (
    <AuthCard>
      <h1 className="auth-heading">Reset your password</h1>
      <form
        onSubmit={(e) => {
          void handleSubmit(e)
        }}
        noValidate
      >
        <div className="form-group">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            autoComplete="email"
            autoFocus
          />
        </div>

        {error && (
          <div className="alert alert--error" role="alert">
            {error}
          </div>
        )}

        <div style={{ marginTop: 'var(--space-6)' }}>
          <button type="submit" className="btn btn--primary" disabled={loading}>
            {loading ? 'Sending…' : 'Send reset link'}
          </button>
        </div>

        <p className="form-hint" style={{ marginTop: 'var(--space-4)' }}>
          <Link to="/login">Back to login</Link>
        </p>
      </form>
    </AuthCard>
  )
}
