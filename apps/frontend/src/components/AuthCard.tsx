import { NavLink } from 'react-router-dom'
import { Icon } from '../App'
import Logo from './Logo'

/* Shared authentication card (login_sign_up template):
   branded header with the ETH Expert Vote logo, optional Login/Sign-up tabs. */
export default function AuthCard({
  subtitle = 'Expert Vote',
  tabs = false,
  children,
}: {
  subtitle?: string
  tabs?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-card__header">
          <Logo className="auth-card__logo" />
          <div style={{ textAlign: 'center' }}>
            <div className="auth-card__title">ETH Zurich</div>
            <div className="auth-card__subtitle">{subtitle}</div>
          </div>
        </div>
        <div className="auth-card__body">
          {tabs && (
            <nav className="auth-tabs" aria-label="Authentication">
              <NavLink
                to="/login"
                className={({ isActive }) => `auth-tab${isActive ? ' auth-tab--active' : ''}`}
              >
                Login
              </NavLink>
              <NavLink
                to="/register"
                className={({ isActive }) => `auth-tab${isActive ? ' auth-tab--active' : ''}`}
              >
                Sign-up
              </NavLink>
            </nav>
          )}
          {children}
          <div className="auth-footer">
            <Icon name="verified_user" className="icon--sm" />
            Secure ETH Zurich Authentication
          </div>
        </div>
      </div>
    </div>
  )
}
