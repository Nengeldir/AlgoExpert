import { useEffect, useState } from 'react'
import { api, ApiError, type HistoryItem } from '../api/client'

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

  return (
    <div className="page">
      <h1 className="page-title">My Voting History</h1>

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
        <span>Closed: {deadline.toLocaleDateString()}</span>
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
