import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import History from './History'
import * as client from '../api/client'

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof client>()
  return {
    ...actual,
    api: { ...actual.api, getHistory: vi.fn() },
  }
})

const historyItem: client.HistoryItem = {
  id: 2,
  title: 'Yesterday question',
  description: 'Was it sunny?',
  option_a: 'Yes',
  option_b: 'No',
  image_url: null,
  deadline: new Date(Date.now() - 86400000).toISOString(),
  is_resolved: true,
  ground_truth: 'B',
  user_vote: 'A',
  is_correct: 0,
}

describe('History page', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders history items', async () => {
    vi.mocked(client.api.getHistory).mockResolvedValueOnce({ history: [historyItem] })
    render(
      <MemoryRouter>
        <History />
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getByText('Yesterday question')).toBeInTheDocument())
    expect(screen.getByText(/wrong/i)).toBeInTheDocument()
  })

  it('shows empty state when no history', async () => {
    vi.mocked(client.api.getHistory).mockResolvedValueOnce({ history: [] })
    render(
      <MemoryRouter>
        <History />
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getByText(/no past questions/i)).toBeInTheDocument())
  })
})
