import { normaliseEndpointSpec } from './endpointSpec'

export const AUTH_METHODS = {
  BROWSER_SESSION: 'browser-session',
  API_TOKEN: 'api-token',
}

const STORAGE_KEY = 'collector.uiEditor.projectSettings.v2'
const LEGACY_STORAGE_KEYS = ['collector.uiEditor.projectSettings.v1']

const defaultRawSettings = {
  apiBase: '',
  endpointDocument: null,
  authMethod: AUTH_METHODS.BROWSER_SESSION,
  authToken: '',
  previewTarget: '',
  productionTarget: '',
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
  const rawAuthMethod = raw?.authMethod
  const authMethod =
    rawAuthMethod === AUTH_METHODS.API_TOKEN ? AUTH_METHODS.API_TOKEN : AUTH_METHODS.BROWSER_SESSION
  const authToken = authMethod === AUTH_METHODS.API_TOKEN && raw?.authToken ? String(raw.authToken) : ''
  const previewTarget = raw?.previewTarget ? String(raw.previewTarget).trim() : ''
  const productionTarget = raw?.productionTarget ? String(raw.productionTarget).trim() : ''
  return {
    apiBase,
    endpointDocument,
    endpointMeta,
    authMethod,
    authToken,
    previewTarget,
    productionTarget,
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
  let stored = safeJsonParse(storage.getItem(STORAGE_KEY))
  let migrated = false
  if (!stored) {
    for (const legacyKey of LEGACY_STORAGE_KEYS) {
      const legacy = safeJsonParse(storage.getItem(legacyKey))
      if (legacy) {
        stored = legacy
        migrated = true
        try {
          storage.removeItem(legacyKey)
        } catch (error) {
          console.warn('Unable to remove legacy project settings key', error)
        }
        break
      }
    }
  }
  if (!stored) {
    currentSettings = computeState(defaultRawSettings, 0)
    return currentSettings
  }
  currentSettings = computeState({ ...defaultRawSettings, ...stored }, 0)
  if (migrated) {
    persistRawSettings({
      apiBase: currentSettings.apiBase,
      endpointDocument: currentSettings.endpointDocument,
      authMethod: currentSettings.authMethod,
      authToken: currentSettings.authToken,
      previewTarget: currentSettings.previewTarget,
      productionTarget: currentSettings.productionTarget,
      updatedAt: currentSettings.updatedAt,
    })
  }
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
    if (
      rawSettings === defaultRawSettings ||
      (!rawSettings.apiBase &&
        !rawSettings.endpointDocument &&
        !rawSettings.updatedAt &&
        !rawSettings.authToken &&
        !rawSettings.previewTarget &&
        !rawSettings.productionTarget)
    ) {
      persistRawSettings(null)
    } else {
      persistRawSettings({
        apiBase: currentSettings.apiBase,
        endpointDocument: currentSettings.endpointDocument,
        authMethod: currentSettings.authMethod,
        authToken: currentSettings.authToken,
        previewTarget: currentSettings.previewTarget,
        productionTarget: currentSettings.productionTarget,
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
    authMethod: partial.authMethod ?? base.authMethod,
    authToken: partial.authToken ?? base.authToken,
    previewTarget: partial.previewTarget ?? base.previewTarget,
    productionTarget: partial.productionTarget ?? base.productionTarget,
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
    authMethod: settings.authMethod,
    authToken: settings.authToken,
    previewTarget: settings.previewTarget,
    productionTarget: settings.productionTarget,
    updatedAt: settings.updatedAt,
  }
}

export const hasCustomApiBase = () => {
  const settings = getProjectSettings()
  return Boolean(settings.apiBase && settings.apiBase.trim())
}
