import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Login from './Login'
import * as client from '../api/client'

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof client>()
  return {
    ...actual,
    api: { ...actual.api, login: vi.fn() },
    setToken: vi.fn(),
  }
})

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => mockNavigate }
})

function renderLogin() {
  return render(
    <MemoryRouter>
      <Login />
    </MemoryRouter>,
  )
}

describe('Login page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders login form', () => {
    renderLogin()
    expect(screen.getByRole('heading', { name: /welcome back/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/pseudonym/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /forgot password/i })).toHaveAttribute(
      'href',
      '/forgot-password',
    )
  })

  it('shows error on bad credentials', async () => {
    vi.mocked(client.api.login).mockRejectedValueOnce(
      new client.ApiError('Invalid pseudonym or password.', 401),
    )
    renderLogin()
    fireEvent.change(screen.getByLabelText(/pseudonym/i), { target: { value: 'alice' } })
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: /log in/i }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/invalid/i))
  })

  it('navigates to /today on success', async () => {
    vi.mocked(client.api.login).mockResolvedValueOnce({ token: 'tok', pseudonym: 'alice' })
    renderLogin()
    fireEvent.change(screen.getByLabelText(/pseudonym/i), { target: { value: 'alice' } })
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'pass123' } })
    fireEvent.click(screen.getByRole('button', { name: /log in/i }))
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/today'))
  })
})
