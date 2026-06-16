const BASE_URL: string = import.meta.env.VITE_API_URL ?? ''

function getToken(): string | null {
  return localStorage.getItem('token')
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
  register(pseudonym: string, password: string, consent: boolean) {
    return request<{ token: string; pseudonym: string }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ pseudonym, password, consent }),
    })
  },

  login(pseudonym: string, password: string) {
    return request<{ token: string; pseudonym: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ pseudonym, password }),
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

// Shared response types used by the frontend
export interface Question {
  id: number
  title: string
  description: string
  option_a: string
  option_b: string
  image_url: string | null
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
