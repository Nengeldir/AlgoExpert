import { BrowserRouter, Routes, Route, Navigate, NavLink, useNavigate } from 'react-router-dom'
import { isLoggedIn, clearToken } from './api/client'
import Register from './pages/Register'
import Login from './pages/Login'
import Today from './pages/Today'
import History from './pages/History'

function RequireAuth({ children }: { children: React.ReactNode }) {
  if (!isLoggedIn()) return <Navigate to="/register" replace />
  return <>{children}</>
}

function Header() {
  const navigate = useNavigate()
  const loggedIn = isLoggedIn()

  function handleLogout() {
    clearToken()
    navigate('/register')
  }

  return (
    <header className="app-header">
      <span className="app-header__title">Expert Algo</span>
      {loggedIn && (
        <nav className="app-header__nav" aria-label="Main navigation">
          <NavLink to="/today">Today</NavLink>
          <NavLink to="/history">History</NavLink>
          <button className="btn btn--ghost" onClick={handleLogout} style={{ color: 'white' }}>
            Logout
          </button>
        </nav>
      )}
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
