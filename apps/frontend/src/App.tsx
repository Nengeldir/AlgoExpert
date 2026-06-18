import { BrowserRouter, Routes, Route, Navigate, NavLink, useNavigate } from 'react-router-dom'
import { isLoggedIn, clearToken, isAdminLoggedIn, clearAdminToken } from './api/client'
import Register from './pages/Register'
import Login from './pages/Login'
import Today from './pages/Today'
import History from './pages/History'
import AdminLogin from './pages/AdminLogin'
import AdminQuestions from './pages/AdminQuestions'

function RequireAuth({ children }: { children: React.ReactNode }) {
  if (!isLoggedIn()) return <Navigate to="/register" replace />
  return <>{children}</>
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  if (!isAdminLoggedIn()) return <Navigate to="/admin/login" replace />
  return <>{children}</>
}

function Header() {
  const navigate = useNavigate()
  const loggedIn = isLoggedIn()
  const adminLoggedIn = isAdminLoggedIn()

  function handleLogout() {
    clearToken()
    navigate('/register')
  }

  function handleAdminLogout() {
    clearAdminToken()
    navigate('/admin/login')
  }

  return (
    <header className="app-header">
      <NavLink to="/" className="app-header__title">
        Expert Algo
      </NavLink>
      <div style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'center' }}>
        {loggedIn && (
          <nav className="app-header__nav" aria-label="Main navigation">
            <NavLink to="/today">Today</NavLink>
            <NavLink to="/history">History</NavLink>
            <button onClick={handleLogout}>Logout</button>
          </nav>
        )}
        {adminLoggedIn && (
          <nav className="app-header__nav" aria-label="Admin navigation">
            <NavLink to="/admin/questions">Admin</NavLink>
            <button onClick={handleAdminLogout}>Admin Logout</button>
          </nav>
        )}
      </div>
    </header>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Header />
      <main>
        <Routes>
          <Route path="/register" element={<Register />} />
          <Route path="/login" element={<Login />} />
          <Route
            path="/today"
            element={
              <RequireAuth>
                <Today />
              </RequireAuth>
            }
          />
          <Route
            path="/history"
            element={
              <RequireAuth>
                <History />
              </RequireAuth>
            }
          />
          <Route path="/admin/login" element={<AdminLogin />} />
          <Route
            path="/admin/questions"
            element={
              <RequireAdmin>
                <AdminQuestions />
              </RequireAdmin>
            }
          />
          <Route path="/admin" element={<Navigate to="/admin/questions" replace />} />
          <Route
            path="/"
            element={<Navigate to={isLoggedIn() ? '/today' : '/register'} replace />}
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </BrowserRouter>
  )
}
