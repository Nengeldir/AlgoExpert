import { useEffect, useState } from 'react'
import { api, ApiError, type HistoryItem } from '../api/client'
import { Icon } from '../App'

export default function History() {
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .getHistory()
      .then(({ history: h }) => setHistory(h))
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Failed to load history.')
      })
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="loading">Loading history…</div>
  if (error)
    return (
      <div className="page">
        <div className="alert alert--error">{error}</div>
      </div>
    )

  const totalVotes = history.filter((item) => item.user_vote !== null).length
  const scored = history.filter((item) => item.is_resolved && item.user_vote !== null)
  const correct = scored.filter((item) => item.is_correct === 1).length
  const accuracy = scored.length > 0 ? Math.round((correct / scored.length) * 1000) / 10 : null

  return (
    <div className="page">
      <header className="page-header">
        <h1 className="page-title">Performance History</h1>
        <p className="page-subtitle">
          A comprehensive log of your past predictions. Your accuracy directly influences your
          standing within the expert consensus network.
        </p>
      </header>

      {history.length > 0 && (
        <div className="stat-grid">
          <div className="stat-card">
            <Icon name="how_to_vote" className="stat-card__icon" />
            <span className="stat-card__label">Total Votes Submitted</span>
            <span className="stat-card__value">{totalVotes}</span>
          </div>
          <div className="stat-card">
            <Icon name="troubleshoot" className="stat-card__icon" />
            <span className="stat-card__label">Lifetime Accuracy</span>
            {accuracy !== null ? (
              <>
                <span className="stat-card__value">
                  {accuracy}
                  <span className="stat-card__unit">%</span>
                </span>
                <div className="stat-card__track">
                  <div className="stat-card__fill" style={{ width: `${accuracy}%` }} />
                </div>
              </>
            ) : (
              <span className="stat-card__value">—</span>
            )}
          </div>
        </div>
      )}

      {history.length === 0 && <div className="empty-state">No past questions yet.</div>}

      {history.map((item) => (
        <HistoryCard key={item.id} item={item} />
      ))}
    </div>
  )
}

function HistoryCard({ item }: { item: HistoryItem }) {
  const deadline = new Date(item.deadline)

  return (
    <div className="card">
      <div className="question-meta">
        <span className="chip">
          <Icon name="event" className="icon--sm" />
          Closed: {deadline.toLocaleDateString()}
        </span>
        {item.is_resolved && item.user_vote !== null && (
          <span className={`badge ${item.is_correct ? 'badge--correct' : 'badge--wrong'}`}>
            {item.is_correct ? 'Correct' : 'Wrong'}
          </span>
        )}
        {item.is_resolved && item.user_vote === null && (
          <span className="badge badge--closed">No vote recorded</span>
        )}
        {!item.is_resolved && <span className="badge badge--closed">Awaiting resolution</span>}
      </div>

      <h2 className="question-title">{item.title}</h2>
      <p className="question-description">{item.description}</p>

      <div className="divider" />

      <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
        <OptionRow
          label="A"
          text={item.option_a}
          isVoted={item.user_vote === 'A'}
          isCorrect={item.ground_truth === 'A'}
          isResolved={item.is_resolved}
        />
        <OptionRow
          label="B"
          text={item.option_b}
          isVoted={item.user_vote === 'B'}
          isCorrect={item.ground_truth === 'B'}
          isResolved={item.is_resolved}
        />
      </div>
    </div>
  )
}

function OptionRow({
  label,
  text,
  isVoted,
  isCorrect,
  isResolved,
}: {
  label: string
  text: string
  isVoted: boolean
  isCorrect: boolean
  isResolved: boolean
}) {
  let className = 'btn btn--option'
  if (isResolved && isCorrect && isVoted) className += ' btn--option--correct'
  else if (isResolved && !isCorrect && isVoted) className += ' btn--option--incorrect'
  else if (isResolved && isCorrect) className += ' btn--option--correct'
  else if (isVoted) className += ' btn--option--selected'

  return (
    <div className={className} style={{ cursor: 'default', pointerEvents: 'none' }}>
      <strong>{label}:</strong>&nbsp;{text}
      {isResolved && isCorrect && ' ✓'}
      {isVoted && ' (your vote)'}
    </div>
  )
}
