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

export const adminApi = {
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
