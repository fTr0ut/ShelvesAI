import * as SecureStore from 'expo-secure-store'

export async function saveToken(t) {
  await SecureStore.setItemAsync('token', t)
}

export async function clearToken() {
  await SecureStore.deleteItemAsync('token')
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
    const err = new Error(data?.error || `HTTP ${res.status}`)
    err.status = res.status
    err.data = data
    throw err
  }
  return data
}
