import { normaliseEndpointSpec } from './endpointSpec'

export const AUTH_METHODS = {
  BROWSER_SESSION: 'browser-session',
  API_TOKEN: 'api-token',
}

const SETTINGS_ENDPOINT = '/api/ui-editor/settings'

const defaultRawSettings = {
  apiBase: '',
  endpointDocument: null,
  authMethod: AUTH_METHODS.BROWSER_SESSION,
  authToken: '',
  previewTarget: '',
  productionTarget: '',
  updatedAt: null,
}

const defaultMetaState = {
  isHydrated: false,
  isHydrating: false,
  hydrationError: null,
  isSaving: false,
  saveError: null,
}

const listeners = new Set()

const canClone = (value) => Boolean(value) && typeof value === 'object'

const cloneJson = (value) => {
  if (!canClone(value)) return null
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value)
    } catch (error) {
      console.warn('[projectSettings] structuredClone failed, falling back to JSON clone', error)
    }
  }
  try {
    return JSON.parse(JSON.stringify(value))
  } catch (error) {
    console.warn('[projectSettings] Unable to clone value:', error)
    return null
  }
}

const normalizeRawSettings = (raw = {}) => {
  const apiBase = typeof raw.apiBase === 'string' ? raw.apiBase.trim() : ''
  const endpointDocument = raw.endpointDocument == null ? null : cloneJson(raw.endpointDocument)
  const authMethod = raw.authMethod === AUTH_METHODS.API_TOKEN ? AUTH_METHODS.API_TOKEN : AUTH_METHODS.BROWSER_SESSION
  const authToken = authMethod === AUTH_METHODS.API_TOKEN && typeof raw.authToken === 'string' ? raw.authToken : ''
  const previewTarget = typeof raw.previewTarget === 'string' ? raw.previewTarget.trim() : ''
  const productionTarget = typeof raw.productionTarget === 'string' ? raw.productionTarget.trim() : ''
  const updatedAt =
    typeof raw.updatedAt === 'string'
      ? raw.updatedAt
      : raw.updatedAt instanceof Date
        ? raw.updatedAt.toISOString()
        : null

  return {
    apiBase,
    endpointDocument,
    authMethod,
    authToken,
    previewTarget,
    productionTarget,
    updatedAt,
  }
}

const cloneSettings = (settings) => normalizeRawSettings({ ...settings })

let storedSettings = normalizeRawSettings(defaultRawSettings)
let metadata = { ...defaultMetaState }
let version = 0
let currentSettings = buildState()
let hydrationPromise = null
let fetchJsonImpl = null

export const registerFetchJsonImplementation = (fn) => {
  fetchJsonImpl = typeof fn === 'function' ? fn : null
}

function buildState() {
  const documentCopy = cloneJson(storedSettings.endpointDocument)
  const endpointMeta = normaliseEndpointSpec(documentCopy)
  return {
    apiBase: storedSettings.apiBase,
    endpointDocument: documentCopy,
    endpointMeta,
    authMethod: storedSettings.authMethod,
    authToken: storedSettings.authToken,
    hasAuthToken: Boolean(storedSettings.authToken),
    previewTarget: storedSettings.previewTarget,
    productionTarget: storedSettings.productionTarget,
    updatedAt: storedSettings.updatedAt,
    version,
    ...metadata,
  }
}

function emitChange() {
  listeners.forEach((listener) => {
    try {
      listener(currentSettings)
    } catch (error) {
      console.error('Project settings listener failed', error)
    }
  })
}

function updateState({ settings, meta, bumpVersion = true } = {}) {
  if (settings) {
    storedSettings = normalizeRawSettings(settings)
  }
  if (meta) {
    metadata = { ...metadata, ...meta }
  }
  if (bumpVersion) {
    version += 1
  }
  currentSettings = buildState()
  emitChange()
  return currentSettings
}

const ensureFetchJson = () => {
  if (!fetchJsonImpl) {
    throw new Error('[projectSettings] fetchJson implementation not registered. Call registerFetchJsonImplementation before using project settings networking.')
  }
  return fetchJsonImpl
}

const mergePartial = (partial = {}, base = storedSettings, { timestamp } = {}) => {
  const next = { ...base }

  if (Object.prototype.hasOwnProperty.call(partial, 'apiBase')) {
    next.apiBase = typeof partial.apiBase === 'string' ? partial.apiBase : ''
  }

  if (Object.prototype.hasOwnProperty.call(partial, 'endpointDocument')) {
    next.endpointDocument = partial.endpointDocument == null ? null : cloneJson(partial.endpointDocument)
  }

  if (Object.prototype.hasOwnProperty.call(partial, 'authMethod')) {
    next.authMethod = partial.authMethod === AUTH_METHODS.API_TOKEN ? AUTH_METHODS.API_TOKEN : AUTH_METHODS.BROWSER_SESSION
    if (next.authMethod !== AUTH_METHODS.API_TOKEN) {
      next.authToken = ''
    }
  }

  if (Object.prototype.hasOwnProperty.call(partial, 'authToken')) {
    const token = typeof partial.authToken === 'string' ? partial.authToken : ''
    next.authToken = next.authMethod === AUTH_METHODS.API_TOKEN ? token : ''
  }

  if (Object.prototype.hasOwnProperty.call(partial, 'previewTarget')) {
    next.previewTarget = typeof partial.previewTarget === 'string' ? partial.previewTarget : ''
  }

  if (Object.prototype.hasOwnProperty.call(partial, 'productionTarget')) {
    next.productionTarget = typeof partial.productionTarget === 'string' ? partial.productionTarget : ''
  }

  if (timestamp) {
    next.updatedAt = timestamp
  } else if (Object.prototype.hasOwnProperty.call(partial, 'updatedAt')) {
    const value = partial.updatedAt
    next.updatedAt =
      typeof value === 'string'
        ? value
        : value instanceof Date
          ? value.toISOString()
          : null
  }

  return normalizeRawSettings(next)
}

const buildRequestPayload = (settings) => ({
  apiBase: settings.apiBase,
  endpointDocument: settings.endpointDocument == null ? null : cloneJson(settings.endpointDocument),
  authMethod: settings.authMethod,
  authToken: settings.authToken,
  previewTarget: settings.previewTarget,
  productionTarget: settings.productionTarget,
})

function ensureHydrationRequested() {
  if (metadata.isHydrated || metadata.isHydrating || hydrationPromise) {
    return hydrationPromise
  }

  metadata = { ...metadata, isHydrating: true, hydrationError: null }
  version += 1
  currentSettings = buildState()
  emitChange()

  const promise = (async () => {
    try {
      const fetchJson = await ensureFetchJson()
      const response = await fetchJson(SETTINGS_ENDPOINT, { method: 'GET' })
      const payload = response?.settings || response || {}
      const normalized = normalizeRawSettings({ ...defaultRawSettings, ...payload })
      updateState({ settings: normalized, meta: { isHydrated: true, isHydrating: false, hydrationError: null } })
      return currentSettings
    } catch (error) {
      console.error('[projectSettings] Failed to load project settings', error)
      updateState({ meta: { isHydrating: false, hydrationError: error.message || 'Unable to load project settings.' } })
      throw error
    } finally {
      hydrationPromise = null
    }
  })()

  hydrationPromise = promise
  return promise
}

const ensureHydrated = async () => {
  const promise = ensureHydrationRequested()
  if (!promise) return
  try {
    await promise
  } catch (error) {
    // swallow errors so callers can continue working with local state
  }
}

export const getProjectSettings = () => {
  ensureHydrationRequested()
  return currentSettings
}

export const subscribeToProjectSettings = (listener) => {
  listeners.add(listener)
  ensureHydrationRequested()
  return () => {
    listeners.delete(listener)
  }
}

export const updateProjectSettings = async (partial = {}) => {
  await ensureHydrated()

  const previousSettings = cloneSettings(storedSettings)
  const previousMeta = { ...metadata }
  const timestamp = new Date().toISOString()
  const nextSettings = mergePartial(partial, storedSettings, { timestamp })

  updateState({ settings: nextSettings, meta: { isSaving: true, saveError: null } })

  try {
    const fetchJson = await ensureFetchJson()
    const response = await fetchJson(SETTINGS_ENDPOINT, {
      method: 'PUT',
      body: JSON.stringify({ settings: buildRequestPayload(nextSettings) }),
    })
    const payload = response?.settings || response || {}
    const normalized = normalizeRawSettings({ ...defaultRawSettings, ...payload })
    updateState({ settings: normalized, meta: { isHydrated: true, isSaving: false, saveError: null } })
    return currentSettings
  } catch (error) {
    console.error('[projectSettings] Failed to save project settings', error)
    updateState({ settings: previousSettings, meta: { ...previousMeta, isSaving: false, saveError: error.message || 'Unable to save project settings.' } })
    throw error
  }
}

export const resetProjectSettings = async () => {
  return updateProjectSettings({ ...defaultRawSettings })
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

export const __setFetchJsonImplementation = (fn) => {
  registerFetchJsonImplementation(fn)
}

export const __resetProjectSettingsForTests = () => {
  storedSettings = normalizeRawSettings(defaultRawSettings)
  metadata = { ...defaultMetaState }
  version = 0
  currentSettings = buildState()
  hydrationPromise = null
  registerFetchJsonImplementation(null)
}



