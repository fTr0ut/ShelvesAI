const fs = require('fs/promises')
const path = require('path')

const repoRoot = path.join(__dirname, '..', '..', '..')
const storePath = path.join(repoRoot, 'backend', 'cache', 'ui-project-settings.json')

const AUTH_METHODS = {
  BROWSER_SESSION: 'browser-session',
  API_TOKEN: 'api-token',
}

const defaultSettings = {
  apiBase: '',
  endpointDocument: null,
  authMethod: AUTH_METHODS.BROWSER_SESSION,
  authToken: '',
  previewTarget: '',
  productionTarget: '',
  updatedAt: null,
}

const isObjectLike = (value) => Boolean(value) && typeof value === 'object'

const sanitizeEndpointDocument = (value) => {
  if (!isObjectLike(value)) return null
  try {
    return JSON.parse(JSON.stringify(value))
  } catch (error) {
    console.warn('[ui.projectSettingsStore] Unable to serialise endpoint document:', error.message)
    return null
  }
}

const coerceString = (value) => {
  if (typeof value !== 'string') return ''
  return value.trim()
}

async function ensureStoreDirectory() {
  await fs.mkdir(path.dirname(storePath), { recursive: true })
}

async function readJsonFile(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    return JSON.parse(raw)
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return null
    }
    console.warn(`[ui.projectSettingsStore] Failed to read ${filePath}:`, error.message)
    throw error
  }
}

function normalizeRawSettings(raw = {}) {
  const apiBase = coerceString(raw.apiBase)
  const endpointDocument = sanitizeEndpointDocument(raw.endpointDocument)
  const authMethod = raw.authMethod === AUTH_METHODS.API_TOKEN ? AUTH_METHODS.API_TOKEN : AUTH_METHODS.BROWSER_SESSION
  const rawToken = typeof raw.authToken === 'string' ? raw.authToken : ''
  const authToken = authMethod === AUTH_METHODS.API_TOKEN ? rawToken : ''
  const previewTarget = coerceString(raw.previewTarget)
  const productionTarget = coerceString(raw.productionTarget)
  const updatedAt = typeof raw.updatedAt === 'string' ? raw.updatedAt : raw.updatedAt instanceof Date ? raw.updatedAt.toISOString() : null

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

async function loadStoredSettings() {
  const stored = await readJsonFile(storePath)
  if (!stored) {
    return { ...defaultSettings }
  }
  return normalizeRawSettings({ ...defaultSettings, ...stored })
}

async function getProjectSettings() {
  return loadStoredSettings()
}

function applyPartial(base, partial = {}) {
  const next = { ...base }

  if (Object.prototype.hasOwnProperty.call(partial, 'apiBase')) {
    next.apiBase = coerceString(partial.apiBase)
  }

  if (Object.prototype.hasOwnProperty.call(partial, 'endpointDocument')) {
    next.endpointDocument = sanitizeEndpointDocument(partial.endpointDocument)
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
    next.previewTarget = coerceString(partial.previewTarget)
  }

  if (Object.prototype.hasOwnProperty.call(partial, 'productionTarget')) {
    next.productionTarget = coerceString(partial.productionTarget)
  }

  if (Object.prototype.hasOwnProperty.call(partial, 'updatedAt')) {
    const value = partial.updatedAt
    next.updatedAt = typeof value === 'string' ? value : value instanceof Date ? value.toISOString() : null
  }

  return normalizeRawSettings(next)
}

async function saveProjectSettings(partial = {}) {
  const current = await loadStoredSettings()
  const nextSettings = applyPartial(current, partial)
  const payload = {
    ...nextSettings,
    updatedAt: new Date().toISOString(),
  }

  await ensureStoreDirectory()
  await fs.writeFile(storePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')

  return payload
}

function sanitizeForResponse(settings) {
  const normalized = normalizeRawSettings(settings)
  return {
    ...normalized,
    updatedAt: normalized.updatedAt,
    hasAuthToken: Boolean(normalized.authToken),
  }
}

module.exports = {
  AUTH_METHODS,
  defaultSettings,
  getProjectSettings,
  saveProjectSettings,
  sanitizeForResponse,
  __storePath: storePath,
}
