import { useState, FormEvent } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { setAdminToken, getAdminToken } from '../api/client'

const BASE_URL: string = import.meta.env.VITE_API_URL ?? ''

export default function AdminLogin() {
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch(`${BASE_URL}/admin/questions`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        setError('Invalid admin token.')
        return
      }
      setAdminToken(token)
      navigate('/admin/questions')
    } catch {
      setError('Could not reach the server.')
    } finally {
      setLoading(false)
    }
  }

  if (getAdminToken()) {
    return <Navigate to="/admin/questions" replace />
  }

  return (
    <div className="page">
      <div className="card" style={{ maxWidth: '400px', margin: '0 auto' }}>
        <h1 className="page-title" style={{ fontSize: 'var(--font-size-xl)' }}>
          Admin Login
        </h1>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="admin-token">Admin Token</label>
            <input
              id="admin-token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Enter admin token"
              required
              autoFocus
            />
          </div>
          {error && <div className="alert alert--error">{error}</div>}
          <div style={{ marginTop: 'var(--space-6)' }}>
            <button className="btn btn--primary" type="submit" disabled={loading || !token}>
              {loading ? 'Verifying…' : 'Sign in'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
