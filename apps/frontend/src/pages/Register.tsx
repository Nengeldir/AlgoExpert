import { useState, type FormEvent } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { api, setToken, ApiError } from '../api/client'

export default function Register() {
  const navigate = useNavigate()
  const [pseudonym, setPseudonym] = useState('')
  const [password, setPassword] = useState('')
  const [consent, setConsent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const { token } = await api.register(pseudonym, password, consent)
      setToken(token)
      navigate('/today')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Registration failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page">
      <h1 className="page-title">Join Expert Algo</h1>
      <div className="card">
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
            <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-neutral-400)' }}>
              3–30 characters: letters, digits, hyphens, underscores
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
              I agree that my voting behavior will be shown in the lecture for teaching purposes,
              and that all data will be deleted after the course ends.
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
      </div>

      <p className="auth-switch">
        Already have an account? <Link to="/login">Log in</Link>
      </p>
    </div>
  )
}
