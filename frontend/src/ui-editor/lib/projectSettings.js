import { normaliseEndpointSpec } from './endpointSpec'

const STORAGE_KEY = 'collector.uiEditor.projectSettings.v1'

const defaultRawSettings = {
  apiBase: '',
  endpointDocument: null,
  updatedAt: null,
}

let hasHydrated = false
let currentSettings = null

const listeners = new Set()

const safeJsonParse = (value) => {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch (error) {
    console.warn('Unable to parse stored project settings', error)
    return null
  }
}

const getStorage = () => {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage || null
  } catch (error) {
    console.warn('localStorage unavailable', error)
    return null
  }
}

const computeState = (raw, version) => {
  const apiBase = raw?.apiBase ? String(raw.apiBase).trim() : ''
  const endpointDocument = raw?.endpointDocument ?? null
  const endpointMeta = normaliseEndpointSpec(endpointDocument)
  return {
    apiBase,
    endpointDocument,
    endpointMeta,
    updatedAt: raw?.updatedAt ?? null,
    version,
  }
}

const hydrateFromStorage = () => {
  if (hasHydrated) return currentSettings
  hasHydrated = true
  const storage = getStorage()
  if (!storage) {
    currentSettings = computeState(defaultRawSettings, 0)
    return currentSettings
  }
  const stored = safeJsonParse(storage.getItem(STORAGE_KEY))
  if (!stored) {
    currentSettings = computeState(defaultRawSettings, 0)
    return currentSettings
  }
  currentSettings = computeState({ ...defaultRawSettings, ...stored }, 0)
  return currentSettings
}

const persistRawSettings = (raw) => {
  const storage = getStorage()
  if (!storage) return
  if (!raw) {
    storage.removeItem(STORAGE_KEY)
    return
  }
  storage.setItem(STORAGE_KEY, JSON.stringify(raw))
}

const emitChange = () => {
  listeners.forEach((listener) => {
    try {
      listener(currentSettings)
    } catch (error) {
      console.error('Project settings listener failed', error)
    }
  })
}

const replaceSettings = (rawSettings, { persist = true, bumpVersion = true } = {}) => {
  const base = hydrateFromStorage()
  const nextVersion = bumpVersion ? base.version + 1 : base.version
  currentSettings = computeState({ ...defaultRawSettings, ...rawSettings }, nextVersion)
  if (persist) {
    if (rawSettings === defaultRawSettings || (!rawSettings.apiBase && !rawSettings.endpointDocument && !rawSettings.updatedAt)) {
      persistRawSettings(null)
    } else {
      persistRawSettings({
        apiBase: currentSettings.apiBase,
        endpointDocument: currentSettings.endpointDocument,
        updatedAt: currentSettings.updatedAt,
      })
    }
  }
  emitChange()
  return currentSettings
}

export const getProjectSettings = () => {
  if (!hasHydrated || !currentSettings) {
    return hydrateFromStorage()
  }
  return currentSettings
}

export const updateProjectSettings = (partial = {}) => {
  const base = getProjectSettings()
  const raw = {
    apiBase: partial.apiBase ?? base.apiBase,
    endpointDocument: partial.endpointDocument ?? base.endpointDocument,
    updatedAt: new Date().toISOString(),
  }
  return replaceSettings(raw)
}

export const resetProjectSettings = () => {
  return replaceSettings({ ...defaultRawSettings, updatedAt: null })
}

export const subscribeToProjectSettings = (listener) => {
  const subscription = (settings) => {
    listener(settings)
  }
  listeners.add(subscription)
  return () => {
    listeners.delete(subscription)
  }
}

export const exportProjectSettings = () => {
  const settings = getProjectSettings()
  return {
    apiBase: settings.apiBase,
    endpointDocument: settings.endpointDocument,
    updatedAt: settings.updatedAt,
  }
}

export const hasCustomApiBase = () => {
  const settings = getProjectSettings()
  return Boolean(settings.apiBase && settings.apiBase.trim())
}
