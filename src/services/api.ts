/// <reference types="vite/client" />
const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'
const STATIC_BEARER = import.meta.env.VITE_API_AUTH_TOKEN || ''
const API_USERNAME = import.meta.env.VITE_API_USERNAME || ''
const API_PASSWORD = import.meta.env.VITE_API_PASSWORD || ''

// Lightweight logger
function maskToken(t?: string) {
  if (!t) return ''
  return t.length <= 8 ? '****' : `${t.slice(0, 4)}…${t.slice(-4)}`
}
function log(...args: any[]) { console.log('[api]', ...args) }
function errorLog(...args: any[]) { console.error('[api]', ...args) }

type TokenBundle = {
  access_token: string
  refresh_token: string
  token_type?: string
  expires_in?: number // seconds
}

let ACCESS_TOKEN: string = ''
let REFRESH_TOKEN: string = ''
let ACCESS_EXPIRES_AT: number = 15 // epoch ms

function loadTokens() {
  try {
    const a = localStorage.getItem('cb_access_token') || ''
    const r = localStorage.getItem('cb_refresh_token') || ''
    const e = Number(localStorage.getItem('cb_access_expires_at') || '0')
    ACCESS_TOKEN = a
    REFRESH_TOKEN = r
    ACCESS_EXPIRES_AT = e
    log('Loaded tokens from storage', { access: maskToken(ACCESS_TOKEN), refresh: maskToken(REFRESH_TOKEN), expInMs: Math.max(0, e - Date.now()) })
  } catch {}
}

function saveTokens(bundle: TokenBundle) {
  ACCESS_TOKEN = bundle.access_token
  REFRESH_TOKEN = bundle.refresh_token
  const now = Date.now()
  const ttl = (bundle.expires_in ?? 60 * 15) * 1000 // default 15m
  ACCESS_EXPIRES_AT = now + ttl - 5000 // safety buffer
  log('Saving tokens', { access: maskToken(ACCESS_TOKEN), refresh: maskToken(REFRESH_TOKEN), ttlMs: ttl })
  try {
    localStorage.setItem('cb_access_token', ACCESS_TOKEN)
    localStorage.setItem('cb_refresh_token', REFRESH_TOKEN)
    localStorage.setItem('cb_access_expires_at', String(ACCESS_EXPIRES_AT))
  } catch {}
}

async function loginIfNeeded(): Promise<void> {
  if (STATIC_BEARER) {
    // Static token mode (e.g., chatbot-api-token-2024)
    ACCESS_TOKEN = STATIC_BEARER
    ACCESS_EXPIRES_AT = Date.now() + 3600_000
    log('Using static bearer token', { token: maskToken(ACCESS_TOKEN) })
    return
  }
  loadTokens()
  if (ACCESS_TOKEN && Date.now() < ACCESS_EXPIRES_AT) return
  if (!API_USERNAME || !API_PASSWORD) return // cannot login automatically
  log('Logging in via /auth/login', { base: BASE_URL })
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: API_USERNAME, password: API_PASSWORD })
  })
  if (!res.ok) throw new Error(`Auth login failed: HTTP ${res.status}`)
  const data = (await res.json()) as TokenBundle
  saveTokens(data)
}

async function refreshIfPossible(): Promise<boolean> {
  if (!REFRESH_TOKEN) return false
  log('Refreshing access token via /auth/refresh')
  const res = await fetch(`${BASE_URL}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: REFRESH_TOKEN })
  })
  if (!res.ok) return false
  const data = (await res.json()) as { access_token: string; token_type?: string; expires_in?: number }
  saveTokens({ access_token: data.access_token, refresh_token: REFRESH_TOKEN, expires_in: data.expires_in })
  return true
}

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  // Ensure we have an access token (login if possible)
  await loginIfNeeded().catch(() => {})

  const url = `${BASE_URL}${path}`
  log('HTTP request', { method: (init?.method || 'GET'), url, hasBody: !!init?.body })
  const doFetch = () => fetch(url, {
    headers: {
      'Content-Type': 'application/json'
      , ...(ACCESS_TOKEN ? { Authorization: `Bearer ${ACCESS_TOKEN}` } : {})
      // , ...(API_KEY ? { 'x-api-key': API_KEY } : {})
    },
    ...init
  })

  let res = await doFetch()
  // Try refresh on 401
  if (res.status === 401 && !STATIC_BEARER) {
    const refreshed = await refreshIfPossible()
    if (refreshed) {
      log('Retrying request after refresh')
      res = await doFetch()
    }
  }
  if (!res.ok) {
    // Try to extract a meaningful error message
    let detail = ''
    try {
      const txt = await res.text()
      detail = txt?.slice(0, 500) || ''
    } catch {}
    errorLog('HTTP error', { status: res.status, detail })
    throw new Error(`HTTP ${res.status}${detail ? `: ${detail}` : ''}`)
  }
  // Some backends may return empty body on 204
  const text = await res.text()
  if (!text) return {} as T
  try {
    const json = JSON.parse(text) as T
    log('HTTP response OK', { url, size: text.length })
    return json
  } catch {
    throw new Error('Invalid JSON response')
  }
}

export function getChatbotOptions(): Promise<{ prices: number[]; beds: number[]; cities: string[] }> {
  return http('/chatbot/get-chatbot-options')
}

export function propertySearch(query: Record<string, string | number>): Promise<{ properties: any[] }> {
  const usp = new URLSearchParams()
  Object.entries(query).forEach(([k, v]) => usp.append(k, String(v)))
  const qs = usp.toString() ? `?${usp.toString()}` : ''
  return http(`/chatbot/property-search${qs}`)
}

export function extractParams(message: string): Promise<{ type?: string; result: string; properties?: any[]; search_params?: Record<string, unknown> }> {
  return http('/chatbot/extract-params', {
    method: 'POST',
    body: JSON.stringify({ message })
  })
}

export function sendChat(body: { user_id: string; prompt: string; property_data?: Record<string, unknown> }): Promise<{
  type?: string
  response_type?: 'buttons' | 'dropdown' | string
  result: string
  properties?: any[]
  search_params?: Record<string, unknown>
  buttons?: { label: string; value: string }[]
  dropdown?: { label: string; value: string }[]
  html?: string
}> {
  log('sendChat()', { hasUserId: !!body.user_id, promptLen: body.prompt?.length || 0, hasPropertyData: !!body.property_data })
  return http('/chatbot', {
    method: 'POST',
    body: JSON.stringify(body)
  }).then((resp: any) => {
    // FastAPI returns { success: boolean, data: {...} }
    if (resp && typeof resp === 'object' && 'data' in resp) {
      log('sendChat() received wrapped data')
      return resp.data as {
        type?: string
        response_type?: 'buttons' | 'dropdown' | string
        result: string
        properties?: any[]
        search_params?: Record<string, unknown>
        buttons?: { label: string; value: string }[]
        dropdown?: { label: string; value: string }[]
        html?: string
      }
    }
    log('sendChat() received direct data')
    return resp as {
      type?: string
      response_type?: 'buttons' | 'dropdown' | string
      result: string
      properties?: any[]
      search_params?: Record<string, unknown>
      buttons?: { label: string; value: string }[]
      dropdown?: { label: string; value: string }[]
      html?: string
    }
  })
}


