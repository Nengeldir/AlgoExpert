import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  NavLink,
  useNavigate,
  useLocation,
} from 'react-router-dom'
import { isLoggedIn, clearToken, isAdminLoggedIn, clearAdminToken } from './api/client'
import Register from './pages/Register'
import Login from './pages/Login'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import Today from './pages/Today'
import History from './pages/History'
import AdminLogin from './pages/AdminLogin'
import AdminQuestions from './pages/AdminQuestions'
import Logo from './components/Logo'

function RequireAuth({ children }: { children: React.ReactNode }) {
  if (!isLoggedIn()) return <Navigate to="/register" replace />
  return <>{children}</>
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  if (!isAdminLoggedIn()) return <Navigate to="/admin/login" replace />
  return <>{children}</>
}

export function Icon({ name, className }: { name: string; className?: string }) {
  return (
    <span
      className={`material-symbols-outlined${className ? ` ${className}` : ''}`}
      aria-hidden="true"
    >
      {name}
    </span>
  )
}

const NAV_ITEMS = [
  { to: '/today', icon: 'today', label: "Today's Questions", shortLabel: 'Today' },
  { to: '/history', icon: 'history', label: 'Answer History', shortLabel: 'History' },
  {
    to: '/admin/questions',
    icon: 'admin_panel_settings',
    label: 'Admin View',
    shortLabel: 'Admin',
  },
]

/* App shell: desktop sidebar + mobile top bar + mobile bottom nav.
   Logout is always red and bottom-left; the bottom nav is a single shared
   component so it is identical on every screen. */
function Layout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const userLoggedIn = isLoggedIn()
  const adminLoggedIn = isAdminLoggedIn()

  function handleLogout() {
    clearToken()
    navigate('/login')
  }

  function handleAdminLogout() {
    clearAdminToken()
    navigate('/admin/login')
  }

  // Mobile has a single logout tab — log out of the session that owns the
  // current screen (admin session on /admin routes, user session elsewhere).
  function handleContextualLogout() {
    if (location.pathname.startsWith('/admin') && adminLoggedIn) {
      handleAdminLogout()
    } else {
      handleLogout()
    }
  }

  return (
    <div className="app-shell">
      <nav className="sidebar" aria-label="Main navigation">
        <NavLink to="/" className="sidebar__brand">
          <Logo className="sidebar__logo" />
          <div>
            <div className="sidebar__brand-title">ETH Expert Vote</div>
            <div className="sidebar__brand-subtitle">ETH Zurich</div>
          </div>
        </NavLink>

        <div className="sidebar__nav">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} className="sidebar__link">
              <Icon name={item.icon} />
              {item.label}
            </NavLink>
          ))}
        </div>

        <div className="sidebar__footer">
          {userLoggedIn && (
            <button className="btn-logout" onClick={handleLogout}>
              <Icon name="logout" />
              Logout
            </button>
          )}
          {adminLoggedIn && (
            <button className="btn-logout" onClick={handleAdminLogout}>
              <Icon name="logout" />
              Admin Logout
            </button>
          )}
        </div>
      </nav>

      <header className="mobile-topbar">
        <Logo className="mobile-topbar__logo" />
        <NavLink to="/" className="mobile-topbar__title">
          ETH Expert Vote
        </NavLink>
      </header>

      <main className="app-main">{children}</main>

      <nav className="bottom-nav" aria-label="Main navigation">
        <button
          className="bottom-nav__tab bottom-nav__tab--logout"
          onClick={handleContextualLogout}
        >
          <Icon name="logout" />
          Logout
        </button>
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.to} to={item.to} className="bottom-nav__tab">
            <Icon name={item.icon} />
            {item.shortLabel}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/register" element={<Register />} />
        <Route path="/login" element={<Login />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route
          path="/today"
          element={
            <RequireAuth>
              <Layout>
                <Today />
              </Layout>
            </RequireAuth>
          }
        />
        <Route
          path="/history"
          element={
            <RequireAuth>
              <Layout>
                <History />
              </Layout>
            </RequireAuth>
          }
        />
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route
          path="/admin/questions"
          element={
            <RequireAdmin>
              <Layout>
                <AdminQuestions />
              </Layout>
            </RequireAdmin>
          }
        />
        <Route path="/admin" element={<Navigate to="/admin/questions" replace />} />
        <Route path="/" element={<Navigate to={isLoggedIn() ? '/today' : '/register'} replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
