import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import AdminPredictor from './AdminPredictor'
import * as client from '../api/client'

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof client>()
  return {
    ...actual,
    adminApi: { ...actual.adminApi, getPredictor: vi.fn(), tickPredictor: vi.fn() },
  }
})

function round(overrides: Partial<client.PredictorRound> = {}): client.PredictorRound {
  return {
    round_index: 1,
    batch_key: '2026-08-28T10:00:00.000Z',
    question_id: 1,
    title: 'Will the SMI close up?',
    source: 'smi',
    deadline: '2026-08-28T10:00:00.000Z',
    committed_at: '2026-08-28T10:01:00.000Z',
    learning_rate: 1.02,
    weight_a: 0.7,
    weight_b: 0.3,
    n_voters: 10,
    n_manual: 8,
    wm_prediction: 'A',
    mv_prediction: 'A',
    truth: 'A',
    wm_correct: 1,
    mv_correct: 1,
    p_follow_i: 0.7,
    scored_at: '2026-08-28T22:05:00.000Z',
    ...overrides,
  }
}

function view(overrides: Partial<client.PredictorView> = {}): client.PredictorView {
  return {
    season: {
      window_start: '2026-08-28T06:00:00.000Z',
      window_end: '2026-09-11T22:00:00.000Z',
      t_planned: 26,
      rate_mode: 'anytime',
      tie_break: 'A',
      fill_seed: 20260828,
      n_experts: 10,
      current_eta: 1.023,
      current_growth_rate: 1.78,
      locked: true,
    },
    pool: ['Ada', 'Bob'],
    rounds: [round()],
    series: [
      {
        round_index: 1,
        label: 'Will the SMI close up?',
        wm: 1,
        follow_i: 0.7,
        plain_majority: 1,
        best_expert: 1,
        mean_expert: 0.7,
      },
    ],
    weight_history: [{ round_index: 1, shares: { Ada: 0.6, Bob: 0.4 } }],
    experts: [
      {
        pseudonym: 'Ada',
        answered: 1,
        manual_answered: 1,
        correct: 1,
        rate_over_all_rounds: 1,
        rate_over_answered: 1,
        final_weight_share: 0.6,
      },
      {
        pseudonym: 'Bob',
        answered: 1,
        manual_answered: 0,
        correct: 0,
        rate_over_all_rounds: 0,
        rate_over_answered: 0,
        final_weight_share: 0.4,
      },
    ],
    headline: {
      n_committed: 1,
      n_scored: 1,
      n_pending: 0,
      wm_correct: 1,
      wm_rate: 1,
      follow_i_rate: 0.7,
      plain_majority_rate: 1,
      best_expert_rate: 1,
      mean_expert_rate: 0.5,
      median_expert_rate: 0.5,
      manual_participation: 0.8,
    },
    bounds: {
      follow_i_loss: 0.3,
      best_expert_loss: 0,
      hedge_loss_bound: 6.6,
      hedge_holds: true,
      regret_term: 6.6,
      regret_label: 'sqrt(2 D ln N)  (anytime rate)',
      wm_mistakes: 0,
      best_expert_mistakes: 0,
      wm_mistake_bound: 5.2,
      wm_holds: true,
      slides_guarantee: -0.4,
      slides_holds: true,
      not_yet_informative: true,
    },
    ...overrides,
  }
}

const renderPage = () =>
  render(
    <MemoryRouter>
      <AdminPredictor />
    </MemoryRouter>,
  )

describe('AdminPredictor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the predictor score against the best expert', async () => {
    vi.mocked(client.adminApi.getPredictor).mockResolvedValueOnce(view())
    renderPage()

    await waitFor(() =>
      expect(screen.getByText(/Predictor \(Weighted Majority\)/i)).toBeInTheDocument(),
    )
    expect(screen.getByText('/1')).toBeInTheDocument()
    expect(screen.getByText(/Best expert \(hindsight\)/i)).toBeInTheDocument()
    expect(screen.getByText(/1 round scored of 26 planned/)).toBeInTheDocument()
  })

  it('surfaces the frozen configuration', async () => {
    vi.mocked(client.adminApi.getPredictor).mockResolvedValueOnce(view())
    renderPage()

    await waitFor(() => expect(screen.getByText(/parameters frozen/)).toBeInTheDocument())
    expect(screen.getByText(/η=1.023/)).toBeInTheDocument()
  })

  it('says plainly when the bound is not yet informative', async () => {
    vi.mocked(client.adminApi.getPredictor).mockResolvedValueOnce(view())
    renderPage()

    await waitFor(() => expect(screen.getByText(/not yet informative/i)).toBeInTheDocument())
  })

  it('shows a committed round that has no truth yet', async () => {
    vi.mocked(client.adminApi.getPredictor).mockResolvedValueOnce(
      view({
        rounds: [
          round({
            truth: null,
            wm_correct: null,
            mv_correct: null,
            scored_at: null,
            p_follow_i: null,
          }),
        ],
        series: [],
        headline: { ...view().headline, n_scored: 0, n_pending: 1, wm_correct: 0, wm_rate: 0 },
      }),
    )
    renderPage()

    await waitFor(() => expect(screen.getByText(/awaiting truth/i)).toBeInTheDocument())

    // The prediction is visible while the truth column is still empty — the whole point
    // of committing at the deadline.
    const row = screen.getByText('Will the SMI close up?').closest('tr')!
    expect(within(row).getAllByText('A').length).toBeGreaterThan(0)
    expect(screen.getByText(/No scored rounds yet/i)).toBeInTheDocument()
  })

  it('explains itself before the window opens', async () => {
    vi.mocked(client.adminApi.getPredictor).mockResolvedValueOnce(
      view({
        rounds: [],
        series: [],
        weight_history: [],
        experts: [],
        season: { ...view().season, locked: false, n_experts: null },
      }),
    )
    renderPage()

    await waitFor(() =>
      expect(screen.getByText(/has not committed anything yet/i)).toBeInTheDocument(),
    )
    expect(screen.getByText(/seeded coin flip/i)).toBeInTheDocument()
    expect(screen.queryByText(/Round ledger/i)).not.toBeInTheDocument()
  })

  it('runs a tick and reloads', async () => {
    vi.mocked(client.adminApi.getPredictor).mockResolvedValue(view())
    vi.mocked(client.adminApi.tickPredictor).mockResolvedValueOnce({
      ok: true,
      log: ['[predictor] round 1 committed for question 1'],
    })
    renderPage()

    await waitFor(() => expect(screen.getByRole('button', { name: /run tick now/i })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: /run tick now/i }))

    await waitFor(() => expect(client.adminApi.tickPredictor).toHaveBeenCalled())
    expect(await screen.findByText(/round 1 committed/)).toBeInTheDocument()
    expect(client.adminApi.getPredictor).toHaveBeenCalledTimes(2)
  })

  it('lists the expert leaderboard on demand', async () => {
    vi.mocked(client.adminApi.getPredictor).mockResolvedValueOnce(view())
    renderPage()

    await waitFor(() => expect(screen.getByText(/Show expert leaderboard/)).toBeInTheDocument())
    expect(screen.queryByText('Final weight')).not.toBeInTheDocument()

    await userEvent.click(screen.getByText(/Show expert leaderboard/))
    expect(screen.getByText('Final weight')).toBeInTheDocument()
    // Heatmap row headers use the same names, so scope the check to the table.
    const table = screen.getByText('Final weight').closest('table')!
    expect(within(table).getByText('Ada')).toBeInTheDocument()
  })

  it('surfaces a load failure', async () => {
    vi.mocked(client.adminApi.getPredictor).mockRejectedValueOnce(
      new client.ApiError('Invalid admin token.', 403),
    )
    renderPage()

    await waitFor(() => expect(screen.getByText('Invalid admin token.')).toBeInTheDocument())
  })
})
