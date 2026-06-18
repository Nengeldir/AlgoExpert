import { useEffect, useState } from 'react'
import { api, ApiError, type Question } from '../api/client'

export default function Today() {
  const [questions, setQuestions] = useState<Question[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .getQuestions()
      .then(({ questions: q }) => setQuestions(q))
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Failed to load questions.')
      })
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="loading">Loading questions…</div>
  if (error)
    return (
      <div className="page">
        <div className="alert alert--error" role="alert">
          {error}
        </div>
      </div>
    )

  return (
    <div className="page">
      <h1 className="page-title">Today&apos;s Questions</h1>

      {questions.length === 0 && (
        <div className="empty-state">No open questions right now. Check back later.</div>
      )}

      {questions.map((q) => (
        <QuestionCard
          key={q.id}
          question={q}
          onVote={(updated) => {
            setQuestions((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
          }}
        />
      ))}
    </div>
  )
}

function QuestionCard({
  question,
  onVote,
}: {
  question: Question
  onVote: (updated: Question) => void
}) {
  const [voting, setVoting] = useState(false)
  const [voteError, setVoteError] = useState<string | null>(null)
  const deadline = new Date(question.deadline)

  async function handleVote(choice: 'A' | 'B') {
    setVoteError(null)
    setVoting(true)
    try {
      await api.castVote(question.id, choice)
      // Optimistically update — refetch for accuracy
      const { questions } = await api.getQuestions()
      const updated = questions.find((q) => q.id === question.id)
      if (updated) onVote(updated)
    } catch (err) {
      setVoteError(err instanceof ApiError ? err.message : 'Vote failed.')
    } finally {
      setVoting(false)
    }
  }

  function optionClass(option: 'A' | 'B') {
    const base = 'btn btn--option'
    if (!question.is_resolved && question.user_vote === option)
      return `${base} btn--option--selected`
    if (question.is_resolved && question.ground_truth === option && question.user_vote === option)
      return `${base} btn--option--correct`
    if (question.is_resolved && question.user_vote === option && question.ground_truth !== option)
      return `${base} btn--option--incorrect`
    if (question.is_resolved && question.ground_truth === option)
      return `${base} btn--option--correct`
    if (question.user_vote === option) return `${base} btn--option--selected`
    return base
  }

  const canVote = question.is_open && !question.user_vote && !question.is_resolved

  return (
    <div className="card">
      <div className="question-meta">
        {question.is_open && !question.is_resolved && (
          <span className="badge badge--open">Open</span>
        )}
        {!question.is_open && !question.is_resolved && (
          <span className="badge badge--closed">Closed — awaiting result</span>
        )}
        {question.is_resolved && (
          <>
            <span className="badge badge--closed">Resolved</span>
            {question.user_vote !== null && (
              <span className={`badge ${question.is_correct ? 'badge--correct' : 'badge--wrong'}`}>
                {question.is_correct ? 'Correct' : 'Wrong'}
              </span>
            )}
          </>
        )}
        <span>Deadline: {deadline.toLocaleString()}</span>
      </div>

      <h2 className="question-title">{question.title}</h2>
      <p className="question-description">{question.description}</p>

      {question.image_url && (
        <img
          src={question.image_url}
          alt="Question thumbnail"
          style={{
            width: '100%',
            borderRadius: 'var(--radius)',
            marginBottom: 'var(--space-4)',
            maxHeight: '200px',
            objectFit: 'cover',
          }}
        />
      )}

      <div className="options-grid">
        {(['A', 'B'] as const).map((opt) => {
          const label = opt === 'A' ? question.option_a : question.option_b
          const thumb = opt === 'A' ? question.option_a_image : question.option_b_image
          const isCorrect = question.is_resolved && question.ground_truth === opt
          return (
            <button
              key={opt}
              className={optionClass(opt)}
              onClick={() => {
                void handleVote(opt)
              }}
              disabled={!canVote || voting}
              aria-pressed={question.user_vote === opt}
            >
              {thumb && <img src={thumb} alt="" className="option-thumb" />}
              <span>
                {label}
                {isCorrect && ' ✓'}
              </span>
            </button>
          )
        })}
      </div>

      {!question.is_open && !question.is_resolved && (
        <div className="alert alert--info" style={{ marginTop: 'var(--space-3)' }}>
          Voting closed — result will be announced soon.
        </div>
      )}

      {question.user_vote && !question.is_resolved && (
        <div className="alert alert--info" style={{ marginTop: 'var(--space-3)' }}>
          Your vote: Option {question.user_vote} — locked in.
        </div>
      )}

      {voteError && <div className="alert alert--error">{voteError}</div>}
    </div>
  )
}
