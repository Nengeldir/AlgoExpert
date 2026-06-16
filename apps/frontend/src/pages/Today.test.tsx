import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Today from './Today'
import * as client from '../api/client'

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof client>()
  return {
    ...actual,
    api: { ...actual.api, getQuestions: vi.fn(), castVote: vi.fn() },
  }
})

const openQuestion: client.Question = {
  id: 1,
  title: 'Will it rain?',
  description: 'Forecast question',
  option_a: 'Yes',
  option_b: 'No',
  image_url: null,
  deadline: new Date(Date.now() + 86400000).toISOString(),
  is_open: true,
  is_resolved: false,
  ground_truth: null,
  user_vote: null,
  is_correct: null,
}

describe('Today page', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders questions', async () => {
    vi.mocked(client.api.getQuestions).mockResolvedValueOnce({ questions: [openQuestion] })
    render(
      <MemoryRouter>
        <Today />
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getByText('Will it rain?')).toBeInTheDocument())
    expect(screen.getByText('Yes')).toBeInTheDocument()
    expect(screen.getByText('No')).toBeInTheDocument()
  })

  it('shows empty state when no questions', async () => {
    vi.mocked(client.api.getQuestions).mockResolvedValueOnce({ questions: [] })
    render(
      <MemoryRouter>
        <Today />
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getByText(/no open questions/i)).toBeInTheDocument())
  })

  it('shows error on fetch failure', async () => {
    vi.mocked(client.api.getQuestions).mockRejectedValueOnce(
      new client.ApiError('Unauthorized', 401),
    )
    render(
      <MemoryRouter>
        <Today />
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
  })
})
