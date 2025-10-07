import Constants from 'expo-constants'

const trailingSlashRE = /\/+$/

function getDefaultApiBase() {
  const extra = Constants?.expoConfig?.extra || {}
  const fromExtra = `${extra.API_BASE || ''}`.trim()
  if (fromExtra) {
    return fromExtra.replace(trailingSlashRE, '')
  }
  return ''
}

export function resolveApiBase(apiBase = '') {
  const base = (apiBase || getDefaultApiBase() || '').replace(trailingSlashRE, '')
  return base
}

export function getBrowserToken(explicitToken) {
  if (explicitToken !== undefined && explicitToken !== null) {
    return explicitToken
  }
  return ''
}

export async function apiFetch(path, { apiBase = '', token = '', credentials, ...options } = {}) {
  const base = resolveApiBase(apiBase)
  if (!base) {
    throw new Error('Missing API base URL for Plasmic data request')
  }
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
