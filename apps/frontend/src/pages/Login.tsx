import { useState, type FormEvent } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { api, setToken, ApiError } from '../api/client'
import AuthCard from '../components/AuthCard'

export default function Login() {
  const navigate = useNavigate()
  const [pseudonym, setPseudonym] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const { token } = await api.login(pseudonym, password)
      setToken(token)
      navigate('/today')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthCard tabs>
      <h1 className="auth-heading">Welcome back</h1>
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
            placeholder="Your pseudonym"
            required
            autoComplete="username"
            autoFocus
          />
        </div>

        <div className="form-group">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Your password"
            required
            autoComplete="current-password"
          />
          <span className="form-hint">
            <Link to="/forgot-password">Forgot password?</Link>
          </span>
        </div>

        {error && (
          <div className="alert alert--error" role="alert">
            {error}
          </div>
        )}

        <div style={{ marginTop: 'var(--space-6)' }}>
          <button type="submit" className="btn btn--primary" disabled={loading}>
            {loading ? 'Logging in…' : 'Log in'}
          </button>
        </div>
      </form>
    </AuthCard>
  )
}
