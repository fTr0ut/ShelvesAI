import { getProjectSettings } from '../lib/projectSettings'

const stripTrailingSlash = (value) => value.replace(/\/+$/, '')

const resolveFromWindow = () => {
  if (typeof window === 'undefined') return ''
  if (window.__COLLECTOR_API_BASE__) {
    return String(window.__COLLECTOR_API_BASE__)
  }
  return window.location.origin
}

const getEnvironmentApiOrigin = () => {
  const envOrigin = import.meta.env.VITE_API_BASE
  if (envOrigin) {
    return stripTrailingSlash(envOrigin)
  }

  const windowOrigin = resolveFromWindow()
  if (windowOrigin) {
    return stripTrailingSlash(windowOrigin)
  }

  return 'http://localhost:5001'
}

export const getApiOrigin = () => {
  const settingsOrigin = getProjectSettings()?.apiBase
  if (settingsOrigin) {
    return stripTrailingSlash(settingsOrigin)
  }
  return getEnvironmentApiOrigin()
}

export const getDefaultApiOrigin = () => getEnvironmentApiOrigin()

export const resolveApiUrl = (path = '') => {
  const origin = getApiOrigin()
  if (!path) return origin
  if (/^https?:/i.test(path)) return path
  if (path.startsWith('/')) {
    return `${origin}${path}`
  }
  return `${origin}/${path}`
}

export const fetchJson = async (path, options = {}) => {
  const requestInit = {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  }

  const response = await fetch(resolveApiUrl(path), requestInit)
  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText)
    const error = new Error(text || `Request failed with status ${response.status}`)
    error.status = response.status
    throw error
  }
  if (response.status === 204) return null
  return response.json()
}

export const getConfiguredEndpoints = () => getProjectSettings()?.endpointMeta?.endpoints || []

export const getEndpointCatalogue = () => getProjectSettings()?.endpointMeta || { format: null, endpoints: [] }
