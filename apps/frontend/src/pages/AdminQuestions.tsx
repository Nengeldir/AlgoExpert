import { useState, useEffect, FormEvent } from 'react'

function formatSubscribers(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`
  return n.toLocaleString()
}
import { adminApi, AdminQuestion, QuestionVote, YoutubeSuggestion, ApiError } from '../api/client'

interface ResolveState {
  loading: boolean
  error: string
  votesUpdated: number | null
}

interface VotesPanel {
  open: boolean
  loading: boolean
  votes: QuestionVote[] | null
  error: string
}

interface CreateForm {
  title: string
  description: string
  option_a: string
  option_b: string
  image_url: string
  deadline: string
}

const EMPTY_FORM: CreateForm = {
  title: '',
  description: '',
  option_a: '',
  option_b: '',
  image_url: '',
  deadline: '',
}

function statusBadge(q: AdminQuestion) {
  if (q.ground_truth) {
    return <span className="badge badge--closed">Resolved — {q.ground_truth}</span>
  }
  const isOpen = new Date(q.deadline) > new Date()
  return isOpen ? (
    <span className="badge badge--open">Open</span>
  ) : (
    <span className="badge badge--closed">Closed</span>
  )
}

function VotesSummary({ votes, question }: { votes: QuestionVote[]; question: AdminQuestion }) {
  const countA = votes.filter((v) => v.choice === 'A').length
  const countB = votes.filter((v) => v.choice === 'B').length
  const total = votes.length
  const pctA = total ? Math.round((countA / total) * 100) : 0
  const pctB = total ? Math.round((countB / total) * 100) : 0
  const correct = votes.filter((v) => v.is_correct === 1).length

  return (
    <div className="votes-summary">
      <div className="votes-summary__bar">
        <span className="votes-summary__label votes-summary__label--a">
          A — {countA} ({pctA}%)
        </span>
        <div className="votes-summary__track">
          {total > 0 && <div className="votes-summary__fill" style={{ width: `${pctA}%` }} />}
        </div>
        <span className="votes-summary__label votes-summary__label--b">
          B — {countB} ({pctB}%)
        </span>
      </div>
      {question.ground_truth && total > 0 && (
        <p className="votes-summary__accuracy">
          {correct}/{total} correct ({Math.round((correct / total) * 100)}%)
        </p>
      )}
    </div>
  )
}

function VotesTable({ votes, question }: { votes: QuestionVote[]; question: AdminQuestion }) {
  if (votes.length === 0) {
    return <p className="votes-empty">No votes yet.</p>
  }

  return (
    <table className="votes-table">
      <thead>
        <tr>
          <th>Pseudonym</th>
          <th>Answer</th>
          {question.ground_truth && <th>Result</th>}
          <th>Voted at</th>
        </tr>
      </thead>
      <tbody>
        {votes.map((v) => (
          <tr key={v.pseudonym}>
            <td>{v.pseudonym}</td>
            <td>
              <span className={`votes-choice votes-choice--${v.choice.toLowerCase()}`}>
                {v.choice}
              </span>
            </td>
            {question.ground_truth && (
              <td>
                {v.is_correct === 1 ? (
                  <span className="badge badge--correct">✓ Correct</span>
                ) : v.is_correct === 0 ? (
                  <span className="badge badge--wrong">✗ Wrong</span>
                ) : (
                  <span className="badge badge--closed">—</span>
                )}
              </td>
            )}
            <td className="votes-timestamp">{new Date(v.voted_at).toLocaleString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default function AdminQuestions() {
  const [questions, setQuestions] = useState<AdminQuestion[]>([])
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(true)

  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState<CreateForm>(EMPTY_FORM)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  const [resolveState, setResolveState] = useState<Record<number, ResolveState>>({})
  const [votePanels, setVotePanels] = useState<Record<number, VotesPanel>>({})
  const [exportError, setExportError] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<Record<number, boolean>>({})
  const [deleteLoading, setDeleteLoading] = useState<Record<number, boolean>>({})

  const [showYoutube, setShowYoutube] = useState(false)
  const [ytSuggestion, setYtSuggestion] = useState<YoutubeSuggestion | null>(null)
  const [ytLoading, setYtLoading] = useState(false)
  const [ytError, setYtError] = useState('')
  const [ytApproving, setYtApproving] = useState(false)
  const [ytApproveError, setYtApproveError] = useState('')

  async function load() {
    setLoading(true)
    setLoadError('')
    try {
      const { questions: qs } = await adminApi.listQuestions()
      setQuestions(qs)
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Failed to load questions.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    setCreateError('')
    setCreating(true)
    try {
      const payload = {
        title: form.title,
        description: form.description,
        option_a: form.option_a,
        option_b: form.option_b,
        deadline: new Date(form.deadline).toISOString(),
        ...(form.image_url ? { image_url: form.image_url } : {}),
      }
      const { question } = await adminApi.createQuestion(payload)
      setQuestions((prev) => [{ ...question, vote_count: 0 }, ...prev])
      setForm(EMPTY_FORM)
      setShowCreate(false)
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : 'Failed to create question.')
    } finally {
      setCreating(false)
    }
  }

  async function handleResolve(id: number, ground_truth: 'A' | 'B') {
    setResolveState((prev) => ({
      ...prev,
      [id]: { loading: true, error: '', votesUpdated: null },
    }))
    try {
      const { question, votes_updated } = await adminApi.resolveQuestion(id, ground_truth)
      setQuestions((prev) =>
        prev.map((q) => (q.id === id ? { ...question, vote_count: q.vote_count } : q)),
      )
      setResolveState((prev) => ({
        ...prev,
        [id]: { loading: false, error: '', votesUpdated: votes_updated },
      }))
      // Refresh votes panel if it was open so is_correct reflects the resolution
      setVotePanels((prev) => {
        const panel = prev[id]
        if (!panel?.open) return prev
        return { ...prev, [id]: { ...panel, votes: null } }
      })
      await fetchVotes(id)
    } catch (err) {
      setResolveState((prev) => ({
        ...prev,
        [id]: {
          loading: false,
          error: err instanceof ApiError ? err.message : 'Failed to resolve.',
          votesUpdated: null,
        },
      }))
    }
  }

  async function fetchVotes(id: number) {
    setVotePanels((prev) => ({
      ...prev,
      [id]: { open: true, loading: true, votes: prev[id]?.votes ?? null, error: '' },
    }))
    try {
      const { votes } = await adminApi.getQuestionVotes(id)
      setVotePanels((prev) => ({
        ...prev,
        [id]: { open: true, loading: false, votes, error: '' },
      }))
    } catch (err) {
      setVotePanels((prev) => ({
        ...prev,
        [id]: {
          open: true,
          loading: false,
          votes: null,
          error: err instanceof ApiError ? err.message : 'Failed to load votes.',
        },
      }))
    }
  }

  function toggleVotes(id: number) {
    const panel = votePanels[id]
    if (!panel || !panel.open) {
      // First open or was closed — fetch
      fetchVotes(id)
    } else {
      // Close
      setVotePanels((prev) => ({ ...prev, [id]: { ...prev[id], open: false } }))
    }
  }

  async function handleDelete(id: number) {
    setDeleteLoading((prev) => ({ ...prev, [id]: true }))
    try {
      await adminApi.deleteQuestion(id)
      setQuestions((prev) => prev.filter((q) => q.id !== id))
      // If this question came from today's YouTube suggestion, un-approve it in the UI
      setYtSuggestion((prev) =>
        prev?.question_id === id ? { ...prev, approved: 0, question_id: null } : prev,
      )
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Failed to delete question.')
    } finally {
      setDeleteLoading((prev) => ({ ...prev, [id]: false }))
      setDeleteConfirm((prev) => ({ ...prev, [id]: false }))
    }
  }

  async function handleYoutubeSuggest(refresh = false) {
    setYtLoading(true)
    setYtError('')
    if (refresh) setYtSuggestion(null)
    try {
      const { suggestion } = await adminApi.getYoutubeSuggestion(refresh)
      setYtSuggestion(suggestion)
    } catch (err) {
      setYtError(err instanceof ApiError ? err.message : 'Failed to fetch YouTube suggestion.')
    } finally {
      setYtLoading(false)
    }
  }

  async function handleYoutubeApprove() {
    setYtApproving(true)
    setYtApproveError('')
    try {
      const { question } = await adminApi.approveYoutubeSuggestion()
      setQuestions((prev) => [{ ...question, vote_count: 0 }, ...prev])
      setYtSuggestion((prev) => (prev ? { ...prev, approved: 1 } : prev))
    } catch (err) {
      setYtApproveError(err instanceof ApiError ? err.message : 'Failed to approve suggestion.')
    } finally {
      setYtApproving(false)
    }
  }

  async function handleExport(format: 'json' | 'csv') {
    setExportError('')
    try {
      await adminApi.exportVotes(format)
    } catch (err) {
      setExportError(err instanceof ApiError ? err.message : 'Export failed.')
    }
  }

  return (
    <div className="page">
      <div className="admin-toolbar">
        <h1 className="page-title" style={{ marginBottom: 0 }}>
          Admin — Questions
        </h1>
        <div className="admin-toolbar__actions">
          <button
            className="btn btn--sm"
            onClick={() => {
              setShowCreate((v) => !v)
              setCreateError('')
            }}
          >
            {showCreate ? 'Cancel' : '+ New Question'}
          </button>
          <button
            className="btn btn--sm btn--outline"
            onClick={() => {
              setShowYoutube((v) => !v)
              setYtError('')
            }}
          >
            {showYoutube ? 'Hide YouTube' : 'YouTube Suggestion'}
          </button>
          <button className="btn btn--sm btn--outline" onClick={() => handleExport('csv')}>
            Export CSV
          </button>
          <button className="btn btn--sm btn--outline" onClick={() => handleExport('json')}>
            Export JSON
          </button>
        </div>
      </div>

      {exportError && (
        <div className="alert alert--error" style={{ marginTop: 'var(--space-3)' }}>
          {exportError}
        </div>
      )}

      {showYoutube && (
        <div className="card" style={{ marginTop: 'var(--space-4)' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 'var(--space-4)',
            }}
          >
            <h2
              style={{
                fontSize: 'var(--font-size-lg)',
                fontWeight: 'var(--font-weight-bold)',
                margin: 0,
              }}
            >
              YouTube Daily Suggestion
            </h2>
            {!ytSuggestion && (
              <button
                className="btn btn--sm btn--primary"
                onClick={() => handleYoutubeSuggest()}
                disabled={ytLoading}
              >
                {ytLoading ? 'Fetching…' : 'Generate Suggestion'}
              </button>
            )}
            {ytSuggestion && !ytSuggestion.approved && (
              <button
                className="btn btn--sm"
                onClick={() => handleYoutubeSuggest(true)}
                disabled={ytLoading}
              >
                {ytLoading ? 'Fetching…' : 'Regenerate'}
              </button>
            )}
          </div>

          {ytError && (
            <div className="alert alert--error" style={{ marginBottom: 'var(--space-3)' }}>
              {ytError}
            </div>
          )}

          {ytSuggestion && (
            <>
              <div className="admin-options-row" style={{ gap: 'var(--space-4)' }}>
                {(
                  [
                    {
                      label: 'A',
                      id: ytSuggestion.video_a_id,
                      title: ytSuggestion.video_a_title,
                      channel: ytSuggestion.video_a_channel,
                      thumbnail: ytSuggestion.video_a_thumbnail,
                      subscribers: ytSuggestion.video_a_subscribers,
                      views: ytSuggestion.video_a_views,
                      publishedAt: ytSuggestion.video_a_published_at,
                    },
                    {
                      label: 'B',
                      id: ytSuggestion.video_b_id,
                      title: ytSuggestion.video_b_title,
                      channel: ytSuggestion.video_b_channel,
                      thumbnail: ytSuggestion.video_b_thumbnail,
                      subscribers: ytSuggestion.video_b_subscribers,
                      views: ytSuggestion.video_b_views,
                      publishedAt: ytSuggestion.video_b_published_at,
                    },
                  ] as const
                ).map((v) => (
                  <div key={v.label} className="yt-video-card">
                    <span
                      className={`admin-option-pill admin-option-pill--${v.label.toLowerCase()}`}
                      style={{ marginBottom: 'var(--space-2)' }}
                    >
                      Option {v.label}
                    </span>
                    {v.thumbnail && (
                      <a
                        href={`https://www.youtube.com/watch?v=${v.id}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <img src={v.thumbnail} alt={v.title} className="yt-thumbnail" />
                      </a>
                    )}
                    <p className="yt-video-title">
                      <a
                        href={`https://www.youtube.com/watch?v=${v.id}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {v.title}
                      </a>
                    </p>
                    <p className="yt-channel">{v.channel}</p>
                    {v.subscribers != null && (
                      <p className="yt-subscribers">
                        {formatSubscribers(v.subscribers)} subscribers
                      </p>
                    )}
                    {v.views != null && (
                      <p className="yt-subscribers">{formatSubscribers(v.views)} views now</p>
                    )}
                    {v.publishedAt && (
                      <p className="yt-subscribers">
                        Uploaded{' '}
                        {new Date(v.publishedAt).toLocaleString(undefined, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </p>
                    )}
                  </div>
                ))}
              </div>

              <p className="question-description" style={{ marginTop: 'var(--space-4)' }}>
                <strong>Question:</strong> Which video gains more views in the next 24 hours?
              </p>

              {ytSuggestion.approved ? (
                <div className="alert alert--success" style={{ marginTop: 'var(--space-3)' }}>
                  Approved — question #{ytSuggestion.question_id} created.
                </div>
              ) : (
                <div style={{ marginTop: 'var(--space-4)' }}>
                  {ytApproveError && (
                    <div className="alert alert--error" style={{ marginBottom: 'var(--space-2)' }}>
                      {ytApproveError}
                    </div>
                  )}
                  <button
                    className="btn btn--primary"
                    onClick={handleYoutubeApprove}
                    disabled={ytApproving}
                  >
                    {ytApproving ? 'Publishing…' : "Approve as Today's Question"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {showCreate && (
        <div className="card" style={{ marginTop: 'var(--space-4)' }}>
          <h2
            style={{
              fontSize: 'var(--font-size-lg)',
              fontWeight: 'var(--font-weight-bold)',
              marginBottom: 'var(--space-4)',
            }}
          >
            New Question
          </h2>
          <form onSubmit={handleCreate}>
            <div className="form-group">
              <label htmlFor="q-title">Title</label>
              <input
                id="q-title"
                type="text"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                required
                maxLength={200}
              />
            </div>
            <div className="form-group">
              <label htmlFor="q-desc">Description</label>
              <textarea
                id="q-desc"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                required
                rows={3}
              />
            </div>
            <div className="admin-options-row">
              <div className="form-group">
                <label htmlFor="q-a">Option A</label>
                <input
                  id="q-a"
                  type="text"
                  value={form.option_a}
                  onChange={(e) => setForm((f) => ({ ...f, option_a: e.target.value }))}
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="q-b">Option B</label>
                <input
                  id="q-b"
                  type="text"
                  value={form.option_b}
                  onChange={(e) => setForm((f) => ({ ...f, option_b: e.target.value }))}
                  required
                />
              </div>
            </div>
            <div className="form-group">
              <label htmlFor="q-deadline">Deadline</label>
              <input
                id="q-deadline"
                type="datetime-local"
                value={form.deadline}
                onChange={(e) => setForm((f) => ({ ...f, deadline: e.target.value }))}
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="q-image">
                Image URL{' '}
                <span style={{ color: 'var(--color-neutral-400)', fontWeight: 'normal' }}>
                  (optional)
                </span>
              </label>
              <input
                id="q-image"
                type="text"
                value={form.image_url}
                onChange={(e) => setForm((f) => ({ ...f, image_url: e.target.value }))}
              />
            </div>
            {createError && <div className="alert alert--error">{createError}</div>}
            <div style={{ marginTop: 'var(--space-5)' }}>
              <button className="btn btn--primary" type="submit" disabled={creating}>
                {creating ? 'Creating…' : 'Create Question'}
              </button>
            </div>
          </form>
        </div>
      )}

      {loading && <div className="loading">Loading questions…</div>}
      {loadError && (
        <div className="alert alert--error" style={{ marginTop: 'var(--space-4)' }}>
          {loadError}
        </div>
      )}

      {!loading && !loadError && questions.length === 0 && (
        <div className="empty-state">No questions yet. Create one above.</div>
      )}

      {questions.map((q) => {
        const rs = resolveState[q.id]
        const vp = votePanels[q.id]
        const isResolved = !!q.ground_truth
        const deadline = new Date(q.deadline)
        const isOpen = deadline > new Date()

        return (
          <div key={q.id} className="card admin-question-card">
            <div className="admin-question-card__header">
              <div className="admin-question-card__title-group">
                <span className="admin-question-card__id">#{q.id}</span>
                <h2 className="admin-question-card__title">{q.title}</h2>
              </div>
              <div className="admin-question-card__meta">
                {statusBadge(q)}
                <span className="badge badge--closed">
                  {q.vote_count} vote{q.vote_count !== 1 ? 's' : ''}
                </span>
              </div>
            </div>

            <p className="question-description">{q.description}</p>

            <div className="admin-options-display">
              <span className="admin-option-pill admin-option-pill--a">A: {q.option_a}</span>
              <span className="admin-option-pill admin-option-pill--b">B: {q.option_b}</span>
            </div>

            <div className="question-meta">
              <span>Deadline: {deadline.toLocaleString()}</span>
              <span>Created: {new Date(q.created_at).toLocaleDateString()}</span>
            </div>

            {!isResolved && (
              <div className="admin-resolve">
                <span className="admin-resolve__label">
                  {isOpen ? 'Resolve early:' : 'Resolve:'}
                </span>
                <button
                  className="btn btn--sm btn--resolve-a"
                  onClick={() => handleResolve(q.id, 'A')}
                  disabled={rs?.loading}
                >
                  A is correct
                </button>
                <button
                  className="btn btn--sm btn--resolve-b"
                  onClick={() => handleResolve(q.id, 'B')}
                  disabled={rs?.loading}
                >
                  B is correct
                </button>
                {rs?.loading && (
                  <span
                    style={{
                      color: 'var(--color-neutral-400)',
                      fontSize: 'var(--font-size-sm)',
                    }}
                  >
                    Saving…
                  </span>
                )}
                {rs?.error && (
                  <span
                    className="alert alert--error"
                    style={{ padding: 'var(--space-1) var(--space-2)' }}
                  >
                    {rs.error}
                  </span>
                )}
              </div>
            )}

            <div className="admin-delete">
              {deleteConfirm[q.id] ? (
                <>
                  <span className="admin-delete__prompt">
                    Delete this question and all its votes?
                  </span>
                  <button
                    className="btn btn--sm btn--danger"
                    onClick={() => handleDelete(q.id)}
                    disabled={deleteLoading[q.id]}
                  >
                    {deleteLoading[q.id] ? 'Deleting…' : 'Yes, delete'}
                  </button>
                  <button
                    className="btn btn--sm btn--outline"
                    onClick={() => setDeleteConfirm((prev) => ({ ...prev, [q.id]: false }))}
                    disabled={deleteLoading[q.id]}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  className="btn btn--sm btn--outline btn--danger-outline"
                  onClick={() => setDeleteConfirm((prev) => ({ ...prev, [q.id]: true }))}
                >
                  Delete
                </button>
              )}
            </div>

            {rs?.votesUpdated != null && (
              <div className="alert alert--success" style={{ marginTop: 'var(--space-3)' }}>
                Resolved as <strong>{q.ground_truth}</strong> — {rs.votesUpdated} vote
                {rs.votesUpdated !== 1 ? 's' : ''} scored.
              </div>
            )}

            {/* Votes panel */}
            <div className="votes-panel">
              <button
                className="votes-toggle"
                onClick={() => toggleVotes(q.id)}
                disabled={vp?.loading}
              >
                {vp?.open ? '▲ Hide votes' : `▼ Show votes (${q.vote_count})`}
              </button>

              {vp?.open && (
                <div className="votes-panel__body">
                  {vp.loading && (
                    <p
                      style={{ color: 'var(--color-neutral-400)', fontSize: 'var(--font-size-sm)' }}
                    >
                      Loading…
                    </p>
                  )}
                  {vp.error && <div className="alert alert--error">{vp.error}</div>}
                  {vp.votes && (
                    <>
                      <VotesSummary votes={vp.votes} question={q} />
                      <VotesTable votes={vp.votes} question={q} />
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
