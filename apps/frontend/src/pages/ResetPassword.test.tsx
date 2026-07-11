import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import ResetPassword from './ResetPassword'
import * as client from '../api/client'

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof client>()
  return {
    ...actual,
    api: { ...actual.api, resetPassword: vi.fn() },
  }
})

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => mockNavigate }
})

function renderResetPassword(token: string | null) {
  const path = token ? `/reset-password?token=${token}` : '/reset-password'
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ResetPassword />
    </MemoryRouter>,
  )
}

describe('ResetPassword page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows an invalid-link message when no token is present', () => {
    renderResetPassword(null)
    expect(screen.getByRole('heading', { name: /invalid link/i })).toBeInTheDocument()
  })

  it('renders the new-password form when a token is present', () => {
    renderResetPassword('abc123')
    expect(screen.getByRole('heading', { name: /choose a new password/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/^new password$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/confirm new password/i)).toBeInTheDocument()
  })

  it('rejects mismatched passwords without calling the API', async () => {
    renderResetPassword('abc123')

    fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value: 'password1' } })
    fireEvent.change(screen.getByLabelText(/confirm new password/i), {
      target: { value: 'password2' },
    })
    fireEvent.click(screen.getByRole('button', { name: /reset password/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/do not match/i)
    })
    expect(client.api.resetPassword).not.toHaveBeenCalled()
  })

  it('submits the token and password, then navigates to /login', async () => {
    vi.mocked(client.api.resetPassword).mockResolvedValueOnce({ message: 'ok' })
    renderResetPassword('abc123')

    fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value: 'newpass1' } })
    fireEvent.change(screen.getByLabelText(/confirm new password/i), {
      target: { value: 'newpass1' },
    })
    fireEvent.click(screen.getByRole('button', { name: /reset password/i }))

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/login'))
    expect(client.api.resetPassword).toHaveBeenCalledWith('abc123', 'newpass1')
  })

  it('shows an error for an invalid or expired token', async () => {
    vi.mocked(client.api.resetPassword).mockRejectedValueOnce(
      new client.ApiError('This reset link is invalid or has expired.', 400),
    )
    renderResetPassword('expired-token')

    fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value: 'newpass1' } })
    fireEvent.change(screen.getByLabelText(/confirm new password/i), {
      target: { value: 'newpass1' },
    })
    fireEvent.click(screen.getByRole('button', { name: /reset password/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/invalid or has expired/i)
    })
  })
})
