import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import AuthCard from '../components/AuthCard'

export default function ResetPassword() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') ?? ''
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)
    try {
      await api.resetPassword(token, password)
      navigate('/login')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  if (!token) {
    return (
      <AuthCard>
        <h1 className="auth-heading">Invalid link</h1>
        <p className="form-hint">
          This password reset link is missing its token.{' '}
          <Link to="/forgot-password">Request a new one</Link>.
        </p>
      </AuthCard>
    )
  }

  return (
    <AuthCard>
      <h1 className="auth-heading">Choose a new password</h1>
      <form
        onSubmit={(e) => {
          void handleSubmit(e)
        }}
        noValidate
      >
        <div className="form-group">
          <label htmlFor="password">New password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 6 characters"
            minLength={6}
            required
            autoComplete="new-password"
            autoFocus
          />
        </div>

        <div className="form-group">
          <label htmlFor="confirmPassword">Confirm new password</label>
          <input
            id="confirmPassword"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Repeat your new password"
            minLength={6}
            required
            autoComplete="new-password"
          />
        </div>

        {error && (
          <div className="alert alert--error" role="alert">
            {error}
          </div>
        )}

        <div style={{ marginTop: 'var(--space-6)' }}>
          <button type="submit" className="btn btn--primary" disabled={loading}>
            {loading ? 'Resetting…' : 'Reset password'}
          </button>
        </div>

        <p className="form-hint" style={{ marginTop: 'var(--space-4)' }}>
          <Link to="/forgot-password">Request a new link</Link>
        </p>
      </form>
    </AuthCard>
  )
}
