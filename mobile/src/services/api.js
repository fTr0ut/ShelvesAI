import AsyncStorage from '@react-native-async-storage/async-storage'

const TOKEN_KEY = 'token'

// Global auth error handler - set by App.js to trigger logout on invalid token
let authErrorHandler = null

export function setAuthErrorHandler(handler) {
  authErrorHandler = handler
}

export async function saveToken(token) {
  if (!token) {
    await AsyncStorage.removeItem(TOKEN_KEY)
  } else {
    await AsyncStorage.setItem(TOKEN_KEY, token)
  }
}

export async function clearToken() {
  await AsyncStorage.removeItem(TOKEN_KEY)
}

export async function getStoredToken() {
  const value = await AsyncStorage.getItem(TOKEN_KEY)
  return value || ''
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

export async function apiRequest({ apiBase, path, method = 'GET', token, body, headers = {} }) {
  if (!apiBase) throw new Error('Missing apiBase for apiRequest')
  if (!path) throw new Error('Missing path for apiRequest')
  const res = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data
  try {
    data = text ? JSON.parse(text) : {}
  } catch (err) {
    data = { raw: text }
  }
  if (!res.ok) {
    const errorMessage = data?.error || `HTTP ${res.status}`

    // Check for invalid token and trigger logout
    if (errorMessage === 'Invalid token' && authErrorHandler) {
      authErrorHandler()
    }

    const err = new Error(errorMessage)
    err.status = res.status
    err.data = data
    throw err
  }
  return data
}
