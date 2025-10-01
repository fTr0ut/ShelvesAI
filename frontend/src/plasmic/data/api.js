const trailingSlashRE = /\/+$/

export function resolveApiBase(apiBase = '') {
  const envBase = (import.meta?.env?.VITE_API_BASE || '').replace(trailingSlashRE, '')
  const base = (apiBase || envBase || '').replace(trailingSlashRE, '')
  return base
}

export function getBrowserToken(explicitToken) {
  if (explicitToken !== undefined && explicitToken !== null) {
    return explicitToken
  }
  if (typeof window === 'undefined') {
    return ''
  }
  try {
    return localStorage.getItem('token') || ''
  } catch (err) {
    console.warn('Unable to read auth token from localStorage', err)
    return ''
  }
}

export async function apiFetch(path, { apiBase = '', token = '', credentials, ...options } = {}) {
  const base = resolveApiBase(apiBase)
  const url = `${base}${path}`
  const headers = new Headers(options.headers || {})
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  const fetchOptions = { ...options, headers }
  if (credentials) {
    fetchOptions.credentials = credentials
  }
  const response = await fetch(url, fetchOptions)
  let data = null
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    try {
      data = await response.json()
    } catch (err) {
      console.warn('Failed to parse JSON response', err)
    }
  }
  if (!response.ok) {
    const errorMessage = data?.error || data?.message || `${response.status} ${response.statusText}`
    const error = new Error(errorMessage)
    error.status = response.status
    error.payload = data
    throw error
  }
  return data
}
