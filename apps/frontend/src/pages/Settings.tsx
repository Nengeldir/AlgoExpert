import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError, clearToken, type UserProfile } from '../api/client'
import { Icon } from '../App'

export default function Settings() {
  const navigate = useNavigate()
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [emailNotifications, setEmailNotifications] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  const [resetSending, setResetSending] = useState(false)
  const [resetMessage, setResetMessage] = useState<string | null>(null)

  useEffect(() => {
    api
      .getMe()
      .then(({ profile: p }) => {
        setProfile(p)
        setEmailNotifications(p.email_notifications)
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Failed to load your settings.')
      })
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="loading">Loading settings…</div>
  if (error || !profile)
    return (
      <div className="page">
        <div className="alert alert--error">{error ?? 'Failed to load your settings.'}</div>
      </div>
    )

  const dirty = emailNotifications !== profile.email_notifications

  async function handleSave() {
    setSaving(true)
    setSaveMessage(null)
    setSaveError(null)
    try {
      await api.updateSettings(emailNotifications)
      setProfile((p) => (p ? { ...p, email_notifications: emailNotifications } : p))
      setSaveMessage('Your settings have been saved.')
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Failed to save your settings.')
    } finally {
      setSaving(false)
    }
  }

  async function handleResetPassword() {
    if (!profile) return
    setResetSending(true)
    setResetMessage(null)
    try {
      const { message } = await api.forgotPassword(profile.email)
      setResetMessage(message)
    } catch (err) {
      setResetMessage(err instanceof ApiError ? err.message : 'Failed to request a password reset.')
    } finally {
      setResetSending(false)
    }
  }

  function handleSignOut() {
    clearToken()
    navigate('/login')
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">Manage your account preferences and system configurations.</p>
      </header>

      <section className="card">
        <h2 className="settings-section-title">
          <Icon name="person" />
          User Profile
        </h2>
        <div className="settings-fields">
          <div className="form-group">
            <label>Pseudonym</label>
            <div className="readonly-field">
              <Icon name="person_outline" className="icon--sm" />
              {profile.pseudonym}
            </div>
          </div>
          <div className="form-group">
            <label>Email</label>
            <div className="readonly-field">
              <Icon name="mail" className="icon--sm" />
              {profile.email}
            </div>
          </div>
        </div>
        <p className="settings-note">
          <Icon name="info" className="icon--sm" />
          Your email is used only for login and password recovery — it is never shown to other
          participants.
        </p>
      </section>

      <section className="card">
        <h2 className="settings-section-title">
          <Icon name="manage_accounts" />
          Account Settings
        </h2>
        <div className="settings-row">
          <div>
            <div className="settings-row__title">Email Notifications</div>
            <div className="settings-row__hint">New question alerts</div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={emailNotifications}
            aria-label="Email notifications"
            className="switch"
            onClick={() => setEmailNotifications((v) => !v)}
          />
        </div>
        <button
          type="button"
          className="settings-link-row"
          onClick={handleResetPassword}
          disabled={resetSending}
        >
          <span>{resetSending ? 'Sending reset link…' : 'Reset Password'}</span>
          <Icon name="chevron_right" />
        </button>
        {resetMessage && <div className="alert alert--info">{resetMessage}</div>}
      </section>

      <section className="card">
        <h2 className="settings-section-title">
          <Icon name="tune" />
          Preferences
        </h2>
        <div className="settings-row__title" style={{ marginBottom: 'var(--space-3)' }}>
          Interface Theme
        </div>
        <div className="theme-grid">
          <div className="theme-tile theme-tile--active">
            <Icon name="light_mode" />
            Light
          </div>
          <div className="theme-tile theme-tile--disabled" title="Dark theme coming soon">
            <Icon name="dark_mode" />
            Dark
          </div>
        </div>
      </section>

      <div className="settings-actions">
        <button className="btn btn--primary" onClick={handleSave} disabled={!dirty || saving}>
          {saving ? 'Saving…' : 'Save All Changes'}
        </button>
        {saveMessage && <div className="alert alert--success">{saveMessage}</div>}
        {saveError && <div className="alert alert--error">{saveError}</div>}
        <button className="btn btn--danger-outline" onClick={handleSignOut}>
          <Icon name="logout" />
          Sign Out
        </button>
      </div>
    </div>
  )
}
