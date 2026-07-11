import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Settings from './Settings'
import * as client from '../api/client'

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof client>()
  return {
    ...actual,
    api: {
      ...actual.api,
      getMe: vi.fn(),
      updateSettings: vi.fn(),
      forgotPassword: vi.fn(),
    },
  }
})

const profile: client.UserProfile = {
  pseudonym: 'Alpha_Euler_42',
  email: 'anna.schmidt@example.com',
  email_notifications: true,
  created_at: '2026-01-01 00:00:00',
}

function renderPage() {
  return render(
    <MemoryRouter>
      <Settings />
    </MemoryRouter>,
  )
}

describe('Settings page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(client.api.getMe).mockResolvedValue({ profile })
  })

  it('renders the profile as read-only fields', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Alpha_Euler_42')).toBeInTheDocument())
    expect(screen.getByText('anna.schmidt@example.com')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: /email notifications/i })).toBeChecked()
  })

  it('saves a changed notification preference', async () => {
    vi.mocked(client.api.updateSettings).mockResolvedValueOnce({ email_notifications: false })
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(screen.getByText('Alpha_Euler_42')).toBeInTheDocument())

    const saveButton = screen.getByRole('button', { name: /save all changes/i })
    expect(saveButton).toBeDisabled()

    await user.click(screen.getByRole('switch', { name: /email notifications/i }))
    expect(saveButton).toBeEnabled()

    await user.click(saveButton)
    await waitFor(() => expect(client.api.updateSettings).toHaveBeenCalledWith(false))
    expect(screen.getByText(/settings have been saved/i)).toBeInTheDocument()
  })

  it('requests a password reset link for the own email', async () => {
    vi.mocked(client.api.forgotPassword).mockResolvedValueOnce({
      message: 'If that email is registered, a reset link has been sent.',
    })
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(screen.getByText('Alpha_Euler_42')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /reset password/i }))
    await waitFor(() =>
      expect(client.api.forgotPassword).toHaveBeenCalledWith('anna.schmidt@example.com'),
    )
    expect(screen.getByText(/reset link has been sent/i)).toBeInTheDocument()
  })
})
