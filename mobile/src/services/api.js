import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'
import * as Sentry from '@sentry/react-native'
import { Buffer } from 'buffer'
import { clearShelvesListCache } from './shelvesListCache'

const TOKEN_KEY = 'token'
const TOKEN_EXPIRY_SKEW_SECONDS = 30
// Attempt refresh when token expires within this window (or has expired within it)
const TOKEN_REFRESH_WINDOW_SECONDS = 5 * 60

// Global auth error handler - set by App.js to trigger logout on invalid/expired token.
let authErrorHandler = null
// Global apiBase - set by App.js so getValidToken() can call the refresh endpoint.
let storedApiBase = null

function notifyAuthError(reason) {
  if (typeof authErrorHandler === 'function') {
    authErrorHandler({ reason })
  }
}

async function secureStoreGetItem(key) {
  try {
    return (await SecureStore.getItemAsync(key)) || ''
  } catch (_err) {
    return ''
  }
}

async function secureStoreSetItem(key, value) {
  try {
    await SecureStore.setItemAsync(key, value)
  } catch (_err) {
    await AsyncStorage.setItem(key, value)
  }
}

async function secureStoreDeleteItem(key) {
  try {
    await SecureStore.deleteItemAsync(key)
  } catch (_err) {
    // Best-effort cleanup only.
  }
}

function decodeBase64Url(input) {
  const base64 = String(input || '').replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  return Buffer.from(padded, 'base64').toString('utf8')
}

function parseJwtPayload(token) {
  try {
    const parts = String(token || '').split('.')
    if (parts.length !== 3) return null
    const payloadText = decodeBase64Url(parts[1])
    const payload = JSON.parse(payloadText)
    if (!payload || typeof payload !== 'object') return null
    return payload
  } catch (_err) {
    return null
  }
}

export function isTokenFormatValid(token) {
  const payload = parseJwtPayload(token)
  return !!payload
}

export function isTokenExpired(token) {
  const payload = parseJwtPayload(token)
  if (!payload) return true
  if (typeof payload.exp !== 'number') return false
  const nowSeconds = Math.floor(Date.now() / 1000)
  return payload.exp <= nowSeconds + TOKEN_EXPIRY_SKEW_SECONDS
}

/**
 * Returns true when the token is within TOKEN_REFRESH_WINDOW_SECONDS of expiry
 * (or has already expired within that window). Used to decide whether to
 * proactively refresh before making an API call.
 */
export function isTokenNearExpiry(token) {
  const payload = parseJwtPayload(token)
  if (!payload || typeof payload.exp !== 'number') return false
  const nowSeconds = Math.floor(Date.now() / 1000)
  return payload.exp <= nowSeconds + TOKEN_REFRESH_WINDOW_SECONDS
}

export function setAuthErrorHandler(handler) {
  authErrorHandler = handler
}

export function setApiBase(base) {
  storedApiBase = base || null
}

export async function saveToken(token) {
  const normalized = String(token || '').trim()
  if (!normalized) {
    await clearToken()
    return
  }
  if (!isTokenFormatValid(normalized)) {
    throw new Error('Invalid token format')
  }
  await secureStoreSetItem(TOKEN_KEY, normalized)
  await AsyncStorage.removeItem(TOKEN_KEY)
}

export async function clearToken() {
  await Promise.all([
    secureStoreDeleteItem(TOKEN_KEY),
    AsyncStorage.removeItem(TOKEN_KEY),
  ])
}

export async function getStoredToken() {
  const secureToken = String(await secureStoreGetItem(TOKEN_KEY) || '').trim()
  if (secureToken) return secureToken

  // Migrate legacy plaintext token from AsyncStorage to SecureStore.
  const legacyToken = String(await AsyncStorage.getItem(TOKEN_KEY) || '').trim()
  if (!legacyToken) return ''

  if (!isTokenFormatValid(legacyToken)) {
    await clearToken()
    return ''
  }

  await secureStoreSetItem(TOKEN_KEY, legacyToken)
  await AsyncStorage.removeItem(TOKEN_KEY)
  return legacyToken
}

/**
 * Attempt to refresh the token via the /api/auth/refresh endpoint.
 * Returns the new token string on success, or null on failure.
 */
async function attemptRefresh(currentToken) {
  const apiBase = storedApiBase
  if (!apiBase || !currentToken) return null
  try {
    const res = await fetch(`${apiBase}/api/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true',
        Authorization: `Bearer ${currentToken}`,
      },
    })
    if (!res.ok) return null
    const data = await res.json()
    const newToken = data?.token
    if (!newToken || !isTokenFormatValid(newToken)) return null
    await saveToken(newToken)
    Sentry.addBreadcrumb({
      category: 'auth',
      level: 'info',
      message: 'Auth token refreshed',
      data: { endpoint: '/api/auth/refresh' },
    })
    return newToken
  } catch (err) {
    Sentry.captureException(err, {
      tags: {
        area: 'auth_refresh',
      },
      extra: {
        endpoint: '/api/auth/refresh',
      },
    })
    return null
  }
}

export async function getValidToken(preferredToken = '') {
  // Always read from secure storage as the source of truth.
  // A caller-supplied preferredToken may be stale (e.g. a previous in-memory
  // copy that was superseded by a silent refresh).  We only fall back to it
  // when secure storage returns nothing (e.g. first-run before any token is
  // saved).
  const stored = await getStoredToken()
  const resolved = stored || String(preferredToken || '').trim()
  if (!resolved) return ''

  if (!isTokenFormatValid(resolved)) {
    await clearToken()
    notifyAuthError('invalid_format')
    return ''
  }

  // If the token is near expiry (or recently expired within the grace window),
  // attempt a silent refresh before falling back to hard logout.
  if (isTokenNearExpiry(resolved)) {
    const refreshed = await attemptRefresh(resolved)
    if (refreshed) return refreshed

    // Refresh failed — if the token is actually expired, hard logout.
    if (isTokenExpired(resolved)) {
      await clearToken()
      notifyAuthError('expired')
      return ''
    }
    // Token is near expiry but still valid — use it as-is.
    return resolved
  }

  return resolved
}

export async function exchangeAuth0Token({ apiBase, accessToken }) {
  if (!accessToken) throw new Error('Missing Auth0 access token')
  return apiRequest({
    apiBase,
    path: '/api/auth0/consume',
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
}

function headersToObject(inputHeaders) {
  if (!inputHeaders || typeof inputHeaders.forEach !== 'function') return {}
  const out = {}
  inputHeaders.forEach((value, key) => {
    out[String(key).toLowerCase()] = value
  })
  return out
}

export async function apiRequest({
  apiBase,
  path,
  method = 'GET',
  token,
  body,
  headers = {},
  allowNotModified = false,
  ifNoneMatch = '',
  onNotModified = null,
  returnMeta = false,
}) {
  if (!apiBase) throw new Error('Missing apiBase for apiRequest')
  if (!path) throw new Error('Missing path for apiRequest')

  const normalizedMethod = String(method || 'GET').toUpperCase()
  const authToken = await getValidToken(token)
  const requestHeaders = {
    'Content-Type': 'application/json',
    'ngrok-skip-browser-warning': 'true',
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    ...headers,
  }
  if (ifNoneMatch) {
    requestHeaders['If-None-Match'] = ifNoneMatch
  }

  let res
  try {
    res = await fetch(`${apiBase}${path}`, {
      method: normalizedMethod,
      headers: requestHeaders,
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch (err) {
    Sentry.captureException(err, {
      tags: {
        area: 'api_network',
        method: normalizedMethod,
      },
      extra: {
        path,
        apiBase,
      },
    })
    throw err
  }

  if (res.status === 304 && allowNotModified) {
    const fallback = typeof onNotModified === 'function' ? await onNotModified() : null
    const metaPayload = {
      data: fallback,
      status: 304,
      notModified: true,
      headers: headersToObject(res.headers),
    }
    return returnMeta ? metaPayload : fallback
  }

  const text = await res.text()
  let data
  try {
    data = text ? JSON.parse(text) : {}
  } catch (_err) {
    data = { raw: text }
  }
  if (!res.ok) {
    const errorMessage = data?.error || `HTTP ${res.status}`
    const isAuthFailure = res.status === 401 || errorMessage === 'Invalid token'
    if (isAuthFailure) {
      await clearToken()
      notifyAuthError('server_rejected')
    }

    const err = new Error(errorMessage)
    err.status = res.status
    err.data = data

    if (res.status >= 500) {
      Sentry.captureException(err, {
        tags: {
          area: 'api_server',
          method: normalizedMethod,
        },
        extra: {
          path,
          status: res.status,
          response: data,
        },
      })
    }

    throw err
  }

  if (normalizedMethod !== 'GET' && String(path || '').startsWith('/api/shelves')) {
    clearShelvesListCache()
  }

  if (returnMeta) {
    return {
      data,
      status: res.status,
      notModified: false,
      headers: headersToObject(res.headers),
    }
  }

  return data
}
