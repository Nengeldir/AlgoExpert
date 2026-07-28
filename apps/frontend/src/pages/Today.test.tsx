import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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
  option_a_image: null,
  option_b_image: null,
  option_a_views: null,
  option_b_views: null,
  deadline: new Date(Date.now() + 86400000).toISOString(),
  is_open: true,
  is_resolved: false,
  ground_truth: null,
  user_vote: null,
  is_correct: null,
}

describe('Today page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

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

  it('only casts a vote after selecting an option and confirming', async () => {
    vi.mocked(client.api.getQuestions)
      .mockResolvedValueOnce({ questions: [openQuestion] })
      .mockResolvedValueOnce({
        questions: [{ ...openQuestion, user_vote: 'A' }],
      })
    vi.mocked(client.api.castVote).mockResolvedValueOnce({ question_id: 1, choice: 'A' })

    render(
      <MemoryRouter>
        <Today />
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getByText('Will it rain?')).toBeInTheDocument())

    // Confirm button is disabled until an option is selected
    const confirmBefore = screen.getByRole('button', { name: /select an option/i })
    expect(confirmBefore).toBeDisabled()

    // Selecting an option does not cast the vote yet
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }))
    expect(client.api.castVote).not.toHaveBeenCalled()

    // Confirming sends the selected choice
    fireEvent.click(screen.getByRole('button', { name: /confirm vote — option a/i }))
    await waitFor(() => expect(client.api.castVote).toHaveBeenCalledWith(1, 'A'))
    await waitFor(() =>
      expect(screen.getByText(/your vote: option a — locked in/i)).toBeInTheDocument(),
    )
  })

  it('deselects an option when clicked twice', async () => {
    vi.mocked(client.api.getQuestions).mockResolvedValueOnce({ questions: [openQuestion] })
    render(
      <MemoryRouter>
        <Today />
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getByText('Will it rain?')).toBeInTheDocument())

    const optionA = screen.getByRole('button', { name: 'Yes' })
    fireEvent.click(optionA)
    expect(optionA).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(optionA)
    expect(optionA).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: /select an option/i })).toBeDisabled()
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
