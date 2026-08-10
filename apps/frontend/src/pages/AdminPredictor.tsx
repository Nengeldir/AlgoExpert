import { useState, useEffect } from 'react'
import { adminApi, ApiError, type PredictorView, type PredictorRound } from '../api/client'
import { AccuracyChart, WeightHeatmap, BoundMeter } from '../components/PredictorCharts'

const pct = (v: number) => `${(v * 100).toFixed(0)}%`

function formatZurich(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    timeZone: 'Europe/Zurich',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function SourceBadge({ source }: { source: PredictorRound['source'] }) {
  return <span className={`source-badge source-badge--${source}`}>{source}</span>
}

/** The prediction, and — once known — whether it held up. */
function Verdict({ round }: { round: PredictorRound }) {
  if (round.truth === null) {
    return <span className="badge badge--open">awaiting truth</span>
  }
  return round.wm_correct === 1 ? (
    <span className="badge badge--correct">✓ correct</span>
  ) : (
    <span className="badge badge--wrong">✗ wrong</span>
  )
}

export default function AdminPredictor() {
  const [view, setView] = useState<PredictorView | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [ticking, setTicking] = useState(false)
  const [tickLog, setTickLog] = useState<string[]>([])
  const [showExperts, setShowExperts] = useState(false)

  async function load() {
    setError('')
    try {
      setView(await adminApi.getPredictor())
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load the predictor.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function handleTick() {
    setTicking(true)
    setTickLog([])
    try {
      const { log } = await adminApi.tickPredictor()
      setTickLog(log)
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Tick failed.')
    } finally {
      setTicking(false)
    }
  }

  if (loading) return <div className="loading">Loading the predictor…</div>

  if (error && !view) {
    return (
      <div className="page">
        <div className="alert alert--error">{error}</div>
      </div>
    )
  }
  if (!view) return null

  const { season, headline, bounds, rounds, series, experts, weight_history } = view
  const started = rounds.length > 0

  return (
    <div className="page">
      <header className="page-header">
        <h1 className="page-title">Expert Algorithm — live predictor</h1>
        <p className="page-subtitle">
          The Weighted Majority learner runs on every question the moment voting closes, commits an
          A/B prediction from the class's votes, and is scored when the ground truth arrives.
        </p>
      </header>

      <div className="admin-toolbar">
        <div className="predictor-config">
          <span className="config-chip">
            window{' '}
            <strong>
              {formatZurich(season.window_start)} → {formatZurich(season.window_end)}
            </strong>
          </span>
          <span className="config-chip">
            experts <strong>{season.n_experts ?? '—'}</strong>
          </span>
          <span className="config-chip">
            rate <strong>{season.rate_mode}</strong> η={season.current_eta.toFixed(3)}
          </span>
          <span
            className="config-chip"
            title="The reward-variant rate the lecture slides quote, e^η − 1"
          >
            slides G <strong>{season.current_growth_rate.toFixed(2)}</strong>
          </span>
          <span className={`config-chip ${season.locked ? 'config-chip--locked' : ''}`}>
            {season.locked ? '🔒 parameters frozen' : 'not yet started'}
          </span>
        </div>
        <div className="admin-toolbar__actions">
          <button className="btn btn--sm btn--outline" onClick={handleTick} disabled={ticking}>
            {ticking ? 'Running…' : 'Run tick now'}
          </button>
        </div>
      </div>

      {error && <div className="alert alert--error">{error}</div>}
      {tickLog.length > 0 && (
        <div className="alert alert--success">
          {tickLog.map((line, i) => (
            <p key={i} className="tick-log-line">
              {line}
            </p>
          ))}
        </div>
      )}

      {!started && (
        <div className="card empty-state">
          <p>
            The predictor has not committed anything yet. It starts on the first question whose
            voting closes inside the window above, and freezes the expert pool at that moment.
          </p>
          <p className="empty-state__detail">
            Planned horizon: <strong>{season.t_planned} questions</strong> — SMI on weekdays,
            YouTube daily. Absent students are filled with a seeded coin flip (seed{' '}
            {season.fill_seed}), so a missing vote never removes anyone from the run and the fill is
            identical on every replay.
          </p>
        </div>
      )}

      {started && (
        <>
          {/* Headline: what the predictor did, against the benchmark that matters. */}
          <div className="stat-row">
            <div className="stat-tile stat-tile--hero">
              <span className="stat-tile__label">Predictor (Weighted Majority)</span>
              <span className="stat-tile__value">
                {headline.wm_correct}
                <span className="stat-tile__of">/{headline.n_scored}</span>
              </span>
              <span className="stat-tile__sub">{pct(headline.wm_rate)} correct</span>
            </div>
            <div className="stat-tile">
              <span className="stat-tile__label">Best expert (hindsight)</span>
              <span className="stat-tile__value">{pct(headline.best_expert_rate)}</span>
              <span className="stat-tile__sub">
                gap {((headline.wm_rate - headline.best_expert_rate) * 100).toFixed(0)} pts
              </span>
            </div>
            <div className="stat-tile">
              <span className="stat-tile__label">Follow i (expected)</span>
              <span className="stat-tile__value">{pct(headline.follow_i_rate)}</span>
              <span className="stat-tile__sub">the randomized learner</span>
            </div>
            <div className="stat-tile">
              <span className="stat-tile__label">Plain majority</span>
              <span className="stat-tile__value">{pct(headline.plain_majority_rate)}</span>
              <span className="stat-tile__sub">unweighted straw man</span>
            </div>
            <div className="stat-tile">
              <span className="stat-tile__label">Class average</span>
              <span className="stat-tile__value">{pct(headline.mean_expert_rate)}</span>
              <span className="stat-tile__sub">median {pct(headline.median_expert_rate)}</span>
            </div>
          </div>

          <p className="predictor-progress">
            {/* T is a plan, not a cap — approving extra YouTube pairs can overshoot it, and
                "34 of 26" reads like a bug. State the count, then the plan. */}
            {headline.n_scored} round{headline.n_scored === 1 ? '' : 's'} scored of{' '}
            {season.t_planned} planned
            {headline.n_pending > 0 && ` · ${headline.n_pending} committed, awaiting ground truth`}
            {' · '}
            {pct(headline.manual_participation)} of votes were real (the rest coin flips)
          </p>

          <section className="card">
            <h2 className="section-title">Cumulative success rate</h2>
            <p className="section-note">
              Each point is the rate over rounds 1…r. The predictor should track the best student
              without having known in advance who that would be.
            </p>
            <AccuracyChart series={series} />
          </section>

          <section className="card">
            <h2 className="section-title">Does the guarantee hold?</h2>
            <p className="section-note">
              The bounds hold only because the prediction is committed at the deadline, from past
              losses alone, with the learning rate fixed in advance. That is what the frozen
              parameters above buy.
            </p>
            <div className="bounds-grid">
              <BoundMeter
                label="Follow i — Hedge loss bound"
                achieved={bounds.follow_i_loss}
                bound={bounds.hedge_loss_bound}
                holds={bounds.hedge_holds}
                unit="losses"
                formula={`L_A ≤ L_best + ${bounds.regret_label}  ·  L_best = ${bounds.best_expert_loss}`}
              />
              <BoundMeter
                label="Weighted Majority — mistake bound"
                achieved={bounds.wm_mistakes}
                bound={bounds.wm_mistake_bound}
                holds={bounds.wm_holds}
                unit="mistakes"
                formula={`M_A ≤ (η·M_best + ln N) / ln(2/(1+β))  ·  M_best = ${bounds.best_expert_mistakes}`}
              />
            </div>
            {bounds.not_yet_informative && (
              <div className="alert alert--warning">
                <strong>The bound is true but not yet informative.</strong> With {headline.n_scored}{' '}
                round{headline.n_scored === 1 ? '' : 's'} and {season.n_experts} experts, the regret
                term ({bounds.regret_term.toFixed(1)} losses) is still a large fraction of the
                horizon — worth saying out loud in the lecture. The algorithm can beat its guarantee
                long before the guarantee is worth quoting.
              </div>
            )}
            <p className="section-note">
              Slides' form, for comparison with <code>analysis/run.py</code>: guaranteed{' '}
              {Number.isFinite(bounds.slides_guarantee) ? pct(bounds.slides_guarantee) : '—'},
              achieved {pct(headline.follow_i_rate)}.
            </p>
          </section>

          <section className="card">
            <h2 className="section-title">Where the weight went</h2>
            <p className="section-note">
              Weight share entering each round. Everyone starts equal; the algorithm concentrates on
              whoever keeps being right.
            </p>
            <WeightHeatmap history={weight_history} experts={experts} />
          </section>

          <section className="card">
            <h2 className="section-title">Round ledger</h2>
            <p className="section-note">
              Append-only. A row is written when voting closes — the prediction column is filled in
              before the truth column exists.
            </p>
            <div className="table-scroll">
              <table className="votes-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Question</th>
                    <th>Closed</th>
                    <th>Weight on A</th>
                    <th>Predicted</th>
                    <th>Plain maj.</th>
                    <th>Truth</th>
                    <th>Result</th>
                    <th>Votes</th>
                  </tr>
                </thead>
                <tbody>
                  {rounds.map((round) => (
                    <tr key={round.question_id}>
                      <td>{round.round_index}</td>
                      <td>
                        <SourceBadge source={round.source} /> {round.title}
                      </td>
                      <td className="votes-timestamp">{formatZurich(round.deadline)}</td>
                      <td className="numeric">{pct(round.weight_a)}</td>
                      <td>
                        <span
                          className={`votes-choice votes-choice--${round.wm_prediction.toLowerCase()}`}
                        >
                          {round.wm_prediction}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`votes-choice votes-choice--${round.mv_prediction.toLowerCase()}`}
                        >
                          {round.mv_prediction}
                        </span>
                      </td>
                      <td>{round.truth ?? '—'}</td>
                      <td>
                        <Verdict round={round} />
                      </td>
                      <td className="numeric">
                        {round.n_manual}/{round.n_voters}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card">
            <button className="votes-toggle" onClick={() => setShowExperts((v) => !v)}>
              {showExperts
                ? '▲ Hide expert leaderboard'
                : `▼ Show expert leaderboard (${experts.length})`}
            </button>
            {showExperts && (
              <div className="table-scroll">
                <table className="votes-table">
                  <thead>
                    <tr>
                      <th>Expert</th>
                      <th>Final weight</th>
                      <th>Correct</th>
                      <th>Rate</th>
                      <th>Real votes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {experts.map((expert) => (
                      <tr key={expert.pseudonym}>
                        <td>{expert.pseudonym}</td>
                        <td className="numeric">{(expert.final_weight_share * 100).toFixed(1)}%</td>
                        <td className="numeric">
                          {expert.correct}/{expert.answered}
                        </td>
                        <td className="numeric">{pct(expert.rate_over_all_rounds)}</td>
                        <td className="numeric">
                          {expert.manual_answered}/{expert.answered}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
