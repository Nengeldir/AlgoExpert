import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, setToken, ApiError } from '../api/client'
import AuthCard from '../components/AuthCard'

export default function Register() {
  const navigate = useNavigate()
  const [pseudonym, setPseudonym] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [consent, setConsent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const { token } = await api.register(pseudonym, email, password, consent)
      setToken(token)
      navigate('/today')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Registration failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthCard tabs>
      <h1 className="auth-heading">Join Expert Algo</h1>
      <form
        onSubmit={(e) => {
          void handleSubmit(e)
        }}
        noValidate
      >
        <div className="form-group">
          <label htmlFor="pseudonym">Pseudonym</label>
          <input
            id="pseudonym"
            type="text"
            value={pseudonym}
            onChange={(e) => setPseudonym(e.target.value)}
            placeholder="e.g. star-predictor"
            minLength={3}
            maxLength={30}
            required
            autoComplete="username"
            autoFocus
          />
          <span className="form-hint">3–30 characters: letters, digits, hyphens, underscores</span>
        </div>

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
          />
          <span className="form-hint">
            Used only to recover your account if you forget your password — never shown publicly.
          </span>
        </div>

        <div className="form-group">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 6 characters"
            minLength={6}
            required
            autoComplete="new-password"
          />
        </div>

        <div className="consent-row">
          <input
            id="consent"
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            required
          />
          <label htmlFor="consent">
            I agree that my voting behavior will be shown in the lecture for teaching purposes, and
            that all data will be deleted after the course ends.
          </label>
        </div>

        {error && (
          <div className="alert alert--error" role="alert">
            {error}
          </div>
        )}

        <div style={{ marginTop: 'var(--space-6)' }}>
          <button type="submit" className="btn btn--primary" disabled={loading || !consent}>
            {loading ? 'Creating account…' : 'Register'}
          </button>
        </div>
      </form>
    </AuthCard>
  )
}
