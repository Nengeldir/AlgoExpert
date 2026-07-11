import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Register from './Register'
import * as client from '../api/client'

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof client>()
  return {
    ...actual,
    api: {
      ...actual.api,
      register: vi.fn(),
    },
    setToken: vi.fn(),
  }
})

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => mockNavigate }
})

function renderRegister() {
  return render(
    <MemoryRouter>
      <Register />
    </MemoryRouter>,
  )
}

describe('Register page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the registration form', () => {
    renderRegister()
    expect(screen.getByRole('heading', { name: /join expert algo/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/pseudonym/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^email$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/i agree/i)).toBeInTheDocument()
  })

  it('submit button is disabled without consent', () => {
    renderRegister()
    const btn = screen.getByRole('button', { name: /register/i })
    expect(btn).toBeDisabled()
  })

  it('shows error message on failed registration', async () => {
    vi.mocked(client.api.register).mockRejectedValueOnce(
      new client.ApiError('This pseudonym is already taken.', 409),
    )
    renderRegister()

    fireEvent.change(screen.getByLabelText(/pseudonym/i), { target: { value: 'dupeuser' } })
    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: 'dupe@example.com' } })
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'pass123' } })
    fireEvent.click(screen.getByLabelText(/i agree/i))
    fireEvent.click(screen.getByRole('button', { name: /register/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/taken/i)
    })
  })

  it('navigates to /today on successful registration', async () => {
    vi.mocked(client.api.register).mockResolvedValueOnce({ token: 'tok', pseudonym: 'newuser' })
    renderRegister()

    fireEvent.change(screen.getByLabelText(/pseudonym/i), { target: { value: 'newuser' } })
    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: 'new@example.com' } })
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'pass123' } })
    fireEvent.click(screen.getByLabelText(/i agree/i))
    fireEvent.click(screen.getByRole('button', { name: /register/i }))

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/today'))
    expect(client.api.register).toHaveBeenCalledWith('newuser', 'new@example.com', 'pass123', true)
  })
})
