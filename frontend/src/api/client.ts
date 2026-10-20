/** Tiny fetch wrapper used by every page. Adds the login token and turns
 *  backend errors into readable messages. */

const TOKEN_KEY = 'ergosense_token'

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* storage can be blocked (private window); the app still works until refresh */
  }
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

let unauthorizedHandler: (() => void) | null = null

/** AuthProvider registers this so any 401 on a protected call logs the user out. */
export function onUnauthorized(handler: (() => void) | null): void {
  unauthorizedHandler = handler
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: unknown
  /** Set false for login/register so a wrong password does not trigger the logout handler. */
  auth?: boolean
}

function extractMessage(data: unknown, fallback: string): string {
  if (data && typeof data === 'object' && 'detail' in data) {
    const detail = (data as { detail: unknown }).detail
    if (typeof detail === 'string') return detail
    if (Array.isArray(detail)) {
      const msgs = detail
        .map((d) => (d && typeof d === 'object' && 'msg' in d ? String((d as { msg: unknown }).msg) : ''))
        .filter(Boolean)
        .map((m) => m.replace(/^Value error, /, ''))
      if (msgs.length) return msgs.join('. ')
    }
  }
  return fallback
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true } = options
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const token = getToken()
  if (auth && token) headers['Authorization'] = `Bearer ${token}`

  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError(0, "Can't reach the server. Is the backend running?")
  }

  if (res.status === 204) return undefined as T

  let data: unknown = null
  try {
    data = await res.json()
  } catch {
    /* empty or non-JSON body */
  }

  if (!res.ok) {
    if (res.status === 401 && auth && unauthorizedHandler) unauthorizedHandler()
    throw new ApiError(res.status, extractMessage(data, `Request failed (${res.status})`))
  }
  return data as T
}

/** Download a file from an authenticated endpoint (browser downloads cannot
 *  send the bearer token, so we fetch it and hand back a blob URL). */
export async function downloadFile(
  path: string,
  filename: string,
  params: Record<string, string> = {},
): Promise<void> {
  const query = new URLSearchParams(params).toString()
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`/api${path}${query ? `?${query}` : ''}`, { headers })
  if (res.status === 401 && unauthorizedHandler) unauthorizedHandler()
  if (!res.ok) throw new ApiError(res.status, `Download failed (${res.status})`)

  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
