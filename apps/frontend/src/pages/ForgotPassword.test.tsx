import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import ForgotPassword from './ForgotPassword'
import * as client from '../api/client'

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof client>()
  return {
    ...actual,
    api: { ...actual.api, forgotPassword: vi.fn() },
  }
})

function renderForgotPassword() {
  return render(
    <MemoryRouter>
      <ForgotPassword />
    </MemoryRouter>,
  )
}

describe('ForgotPassword page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the email form', () => {
    renderForgotPassword()
    expect(screen.getByRole('heading', { name: /reset your password/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
  })

  it('shows a generic confirmation after submit, regardless of whether the email exists', async () => {
    vi.mocked(client.api.forgotPassword).mockResolvedValueOnce({ message: 'ok' })
    renderForgotPassword()

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'me@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /check your email/i })).toBeInTheDocument()
    })
    expect(client.api.forgotPassword).toHaveBeenCalledWith('me@example.com')
  })

  it('shows an error if the request fails', async () => {
    vi.mocked(client.api.forgotPassword).mockRejectedValueOnce(
      new client.ApiError('Something went wrong.', 500),
    )
    renderForgotPassword()

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'me@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/something went wrong/i)
    })
  })
})
