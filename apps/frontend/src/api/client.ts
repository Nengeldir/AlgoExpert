const BASE_URL: string = import.meta.env.VITE_API_URL ?? ''

function getToken(): string | null {
  return localStorage.getItem('token')
}

export function getAdminToken(): string | null {
  return localStorage.getItem('admin-token')
}

export function setAdminToken(token: string) {
  localStorage.setItem('admin-token', token)
}

export function clearAdminToken() {
  localStorage.removeItem('admin-token')
}

export function isAdminLoggedIn(): boolean {
  return !!getAdminToken()
}

export function setToken(token: string) {
  localStorage.setItem('token', token)
}

export function clearToken() {
  localStorage.removeItem('token')
}

export function isLoggedIn(): boolean {
  return !!getToken()
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers })

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new ApiError(body.error ?? `HTTP ${res.status}`, res.status)
  }

  // 204 No Content
  if (res.status === 204) return undefined as T

  return res.json() as Promise<T>
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

// Auth
export const api = {
  register(pseudonym: string, email: string, password: string, consent: boolean) {
    return request<{ token: string; pseudonym: string }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ pseudonym, email, password, consent }),
    })
  },

  login(identifier: string, password: string) {
    return request<{ token: string; pseudonym: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier, password }),
    })
  },

  forgotPassword(email: string) {
    return request<{ message: string }>('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    })
  },

  resetPassword(token: string, password: string) {
    return request<{ message: string }>('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    })
  },

  getQuestions() {
    return request<{ questions: Question[] }>('/api/questions')
  },

  castVote(question_id: number, choice: 'A' | 'B') {
    return request<{ question_id: number; choice: string }>('/api/votes', {
      method: 'POST',
      body: JSON.stringify({ question_id, choice }),
    })
  },

  getHistory() {
    return request<{ history: HistoryItem[] }>('/api/history')
  },

  getMe() {
    return request<{ profile: UserProfile }>('/api/me')
  },

  updateSettings(email_notifications: boolean) {
    return request<{ email_notifications: boolean }>('/api/me/settings', {
      method: 'PATCH',
      body: JSON.stringify({ email_notifications }),
    })
  },

  getVapidPublicKey() {
    return request<{ publicKey: string }>('/api/push/vapid-public-key')
  },

  subscribePush(subscription: { endpoint: string; keys: { p256dh: string; auth: string } }) {
    return request<{ ok: boolean }>('/api/push/subscribe', {
      method: 'POST',
      body: JSON.stringify(subscription),
    })
  },

  unsubscribePush(endpoint: string) {
    return request<void>('/api/push/unsubscribe', {
      method: 'POST',
      body: JSON.stringify({ endpoint }),
    })
  },
}

async function adminRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getAdminToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers })

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new ApiError(body.error ?? `HTTP ${res.status}`, res.status)
  }

  if (res.status === 204) return undefined as T

  return res.json() as Promise<T>
}

export interface QuestionVote {
  pseudonym: string
  choice: 'A' | 'B'
  is_correct: 0 | 1 | null
  voted_at: string
}

export interface AdminQuestion {
  id: number
  title: string
  description: string
  option_a: string
  option_b: string
  image_url: string | null
  deadline: string
  resolved_at: string | null
  ground_truth: 'A' | 'B' | null
  created_at: string
  vote_count: number
}

export interface YoutubeSuggestion {
  id: number
  suggested_date: string
  video_a_id: string
  video_a_title: string
  video_a_channel: string
  video_a_thumbnail: string | null
  video_a_subscribers: number | null
  video_a_published_at: string | null
  video_a_views: number | null
  video_b_id: string
  video_b_title: string
  video_b_channel: string
  video_b_thumbnail: string | null
  video_b_subscribers: number | null
  video_b_published_at: string | null
  video_b_views: number | null
  approved: number
  question_id: number | null
  created_at: string
}

export interface PredictorRound {
  round_index: number
  batch_key: string
  question_id: number
  title: string
  source: 'smi' | 'youtube' | 'manual'
  deadline: string
  committed_at: string
  learning_rate: number
  weight_a: number
  weight_b: number
  n_voters: number
  n_manual: number
  wm_prediction: 'A' | 'B'
  mv_prediction: 'A' | 'B'
  truth: 'A' | 'B' | null
  wm_correct: 0 | 1 | null
  mv_correct: 0 | 1 | null
  p_follow_i: number | null
  scored_at: string | null
}

export interface PredictorSeriesPoint {
  round_index: number
  label: string
  wm: number
  follow_i: number
  plain_majority: number
  best_expert: number
  mean_expert: number
}

export interface PredictorExpert {
  pseudonym: string
  answered: number
  manual_answered: number
  correct: number
  rate_over_all_rounds: number
  rate_over_answered: number
  final_weight_share: number
}

/** SMI and YouTube are separate predictors with separate ledgers. */
export type PredictorSeries = 'smi' | 'youtube'
export const PREDICTOR_SERIES: readonly PredictorSeries[] = ['smi', 'youtube']

export interface PredictorView {
  season: {
    series: PredictorSeries
    window_start: string
    window_end: string
    t_planned: number
    rate_mode: 'fixed' | 'anytime'
    tie_break: 'A' | 'B'
    fill_seed: number
    n_experts: number | null
    current_eta: number
    current_growth_rate: number
    locked: boolean
  }
  pool: string[]
  rounds: PredictorRound[]
  series: PredictorSeriesPoint[]
  weight_history: { round_index: number; shares: Record<string, number> }[]
  experts: PredictorExpert[]
  headline: {
    n_committed: number
    n_scored: number
    n_pending: number
    wm_correct: number
    wm_rate: number
    follow_i_rate: number
    plain_majority_rate: number
    best_expert_rate: number
    mean_expert_rate: number
    median_expert_rate: number
    manual_participation: number
  }
  bounds: {
    follow_i_loss: number
    best_expert_loss: number
    hedge_loss_bound: number
    hedge_holds: boolean
    regret_term: number
    regret_label: string
    wm_mistakes: number
    best_expert_mistakes: number
    wm_mistake_bound: number
    wm_holds: boolean
    slides_guarantee: number
    slides_holds: boolean
    not_yet_informative: boolean
  }
}

export const adminApi = {
  getPredictor(series: PredictorSeries = 'smi') {
    return adminRequest<PredictorView>(`/admin/predictor?series=${series}`)
  },

  tickPredictor() {
    return adminRequest<{ ok: boolean; log: string[] }>('/admin/predictor/tick', {
      method: 'POST',
      body: JSON.stringify({}),
    })
  },

  listQuestions() {
    return adminRequest<{ questions: AdminQuestion[] }>('/admin/questions')
  },

  createQuestion(data: {
    title: string
    description: string
    option_a: string
    option_b: string
    image_url?: string
    deadline: string
  }) {
    return adminRequest<{ question: AdminQuestion }>('/admin/questions', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  resolveQuestion(id: number, ground_truth: 'A' | 'B') {
    return adminRequest<{ question: AdminQuestion; votes_updated: number }>(
      `/admin/questions/${id}/resolve`,
      { method: 'POST', body: JSON.stringify({ ground_truth }) },
    )
  },

  getQuestionVotes(id: number) {
    return adminRequest<{ votes: QuestionVote[] }>(`/admin/questions/${id}/votes`)
  },

  deleteQuestion(id: number) {
    return adminRequest<void>(`/admin/questions/${id}`, { method: 'DELETE' })
  },

  getYoutubeSuggestion(refresh = false) {
    const qs = refresh ? '?refresh=true' : ''
    return adminRequest<{ suggestion: YoutubeSuggestion; already_generated: boolean }>(
      `/admin/youtube/suggest${qs}`,
    )
  },

  publishSmiQuestion() {
    return adminRequest<{ ok: boolean; log: string[] }>('/admin/smi/daily', {
      method: 'POST',
      body: JSON.stringify({}),
    })
  },

  approveYoutubeSuggestion() {
    return adminRequest<{ question: AdminQuestion }>('/admin/youtube/approve', {
      method: 'POST',
      body: JSON.stringify({}),
    })
  },

  async exportVotes(format: 'json' | 'csv'): Promise<void> {
    const token = getAdminToken()
    const res = await fetch(`${BASE_URL}/admin/export?format=${format}`, {
      headers: { Authorization: `Bearer ${token ?? ''}` },
    })
    if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status)
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `votes-export.${format}`
    a.click()
    URL.revokeObjectURL(url)
  },
}

// Shared response types used by the frontend
export interface UserProfile {
  pseudonym: string
  email: string
  email_notifications: boolean
  created_at: string
}

export interface Question {
  id: number
  title: string
  description: string
  option_a: string
  option_b: string
  image_url: string | null
  option_a_image: string | null
  option_b_image: string | null
  option_a_views: number | null
  option_b_views: number | null
  deadline: string
  is_open: boolean
  is_resolved: boolean
  ground_truth: 'A' | 'B' | null
  user_vote: 'A' | 'B' | null
  is_correct: 0 | 1 | null
}

export interface HistoryItem {
  id: number
  title: string
  description: string
  option_a: string
  option_b: string
  image_url: string | null
  deadline: string
  is_resolved: boolean
  ground_truth: 'A' | 'B' | null
  user_vote: 'A' | 'B' | null
  is_correct: 0 | 1 | null
}
