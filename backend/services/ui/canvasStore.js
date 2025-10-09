const fs = require('fs/promises')
const path = require('path')

const repoRoot = path.join(__dirname, '..', '..', '..')
const storePath = path.join(repoRoot, 'backend', 'cache', 'ui-canvas-store.json')

const defaultThemeTokens = Object.freeze({
  colorScheme: 'light',
  accentColor: '#60a5fa',
  background: 'soft-gradient',
  surfaceColor: '#0b1120',
  textColor: '#e2e8f0',
})

const defaultWorkspacePreferences = Object.freeze({
  headerStyle: 'centered-logo',
  footerStyle: 'minimal',
  showAnnouncement: true,
})

const defaultPageStyles = Object.freeze({
  backgroundColor: '#0b1120',
  textColor: '#e2e8f0',
  fontFamily: 'Inter',
  fontSize: 16,
  layout: 'fixed',
  maxWidth: '1200px',
  gridColumns: 12,
  gap: '24px',
  sectionPadding: '80px',
  blockSpacing: '48px',
  borderRadius: '16px',
  elevation: 'soft',
})

const defaultSettings = Object.freeze({
  themeTokens: { ...defaultThemeTokens },
  workspace: { ...defaultWorkspacePreferences },
  pageStyles: { ...defaultPageStyles },
})

const defaultState = Object.freeze({
  screens: [],
  screensMeta: { version: 0, updatedAt: null },
  settings: { ...defaultSettings },
  settingsMeta: { version: 0, updatedAt: null },
})

const isObjectLike = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const coerceString = (value) => {
  if (typeof value !== 'string') return ''
  return value.trim()
}

const coerceOptionalString = (value) => {
  if (value === undefined || value === null) return ''
  return coerceString(value)
}

const coerceBoolean = (value) => Boolean(value)

const coerceNumber = (value, fallback = 0) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return fallback
}

const cloneDeep = (value) => JSON.parse(JSON.stringify(value))

const ensureStoreDirectory = async () => {
  await fs.mkdir(path.dirname(storePath), { recursive: true })
}

const readJsonFile = async (filePath) => {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    return JSON.parse(raw)
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return null
    }
    console.warn(`[ui.canvasStore] Failed to read ${filePath}:`, error.message)
    throw error
  }
}

const writeJsonFile = async (filePath, data) => {
  await ensureStoreDirectory()
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

const normaliseMeta = (rawMeta = {}) => {
  const version = Number.isInteger(rawMeta.version) && rawMeta.version >= 0 ? rawMeta.version : 0
  const updatedAt = typeof rawMeta.updatedAt === 'string' ? rawMeta.updatedAt : null
  return { version, updatedAt }
}

const slugify = (value) => {
  if (!value) return ''
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

const normaliseThemeTokens = (tokens = {}) => {
  const base = { ...defaultThemeTokens }
  if (!isObjectLike(tokens)) {
    return base
  }
  if (Object.prototype.hasOwnProperty.call(tokens, 'colorScheme')) {
    base.colorScheme = coerceString(tokens.colorScheme) || 'light'
  }
  if (Object.prototype.hasOwnProperty.call(tokens, 'accentColor')) {
    base.accentColor = coerceString(tokens.accentColor) || defaultThemeTokens.accentColor
  }
  if (Object.prototype.hasOwnProperty.call(tokens, 'background')) {
    base.background = coerceString(tokens.background) || defaultThemeTokens.background
  }
  if (Object.prototype.hasOwnProperty.call(tokens, 'surfaceColor')) {
    base.surfaceColor = coerceString(tokens.surfaceColor) || defaultThemeTokens.surfaceColor
  }
  if (Object.prototype.hasOwnProperty.call(tokens, 'textColor')) {
    base.textColor = coerceString(tokens.textColor) || defaultThemeTokens.textColor
  }
  return base
}

const normaliseWorkspacePreferences = (preferences = {}) => {
  const base = { ...defaultWorkspacePreferences }
  if (!isObjectLike(preferences)) {
    return base
  }
  if (Object.prototype.hasOwnProperty.call(preferences, 'headerStyle')) {
    base.headerStyle = coerceString(preferences.headerStyle) || defaultWorkspacePreferences.headerStyle
  }
  if (Object.prototype.hasOwnProperty.call(preferences, 'footerStyle')) {
    base.footerStyle = coerceString(preferences.footerStyle) || defaultWorkspacePreferences.footerStyle
  }
  if (Object.prototype.hasOwnProperty.call(preferences, 'showAnnouncement')) {
    base.showAnnouncement = coerceBoolean(preferences.showAnnouncement)
  }
  return base
}

const normalisePageStyles = (styles = {}) => {
  const base = { ...defaultPageStyles }
  if (!isObjectLike(styles)) {
    return base
  }
  if (Object.prototype.hasOwnProperty.call(styles, 'backgroundColor')) {
    base.backgroundColor = coerceString(styles.backgroundColor) || defaultPageStyles.backgroundColor
  }
  if (Object.prototype.hasOwnProperty.call(styles, 'textColor')) {
    base.textColor = coerceString(styles.textColor) || defaultPageStyles.textColor
  }
  if (Object.prototype.hasOwnProperty.call(styles, 'fontFamily')) {
    base.fontFamily = coerceString(styles.fontFamily) || defaultPageStyles.fontFamily
  }
  if (Object.prototype.hasOwnProperty.call(styles, 'fontSize')) {
    base.fontSize = coerceNumber(styles.fontSize, defaultPageStyles.fontSize)
  }
  if (Object.prototype.hasOwnProperty.call(styles, 'layout')) {
    const value = coerceString(styles.layout)
    base.layout = value || defaultPageStyles.layout
  }
  if (Object.prototype.hasOwnProperty.call(styles, 'maxWidth')) {
    base.maxWidth = coerceString(styles.maxWidth) || defaultPageStyles.maxWidth
  }
  if (Object.prototype.hasOwnProperty.call(styles, 'gridColumns')) {
    base.gridColumns = Math.max(1, Math.round(coerceNumber(styles.gridColumns, defaultPageStyles.gridColumns)))
  }
  if (Object.prototype.hasOwnProperty.call(styles, 'gap')) {
    base.gap = coerceString(styles.gap) || defaultPageStyles.gap
  }
  if (Object.prototype.hasOwnProperty.call(styles, 'sectionPadding')) {
    base.sectionPadding = coerceString(styles.sectionPadding) || defaultPageStyles.sectionPadding
  }
  if (Object.prototype.hasOwnProperty.call(styles, 'blockSpacing')) {
    base.blockSpacing = coerceString(styles.blockSpacing) || defaultPageStyles.blockSpacing
  }
  if (Object.prototype.hasOwnProperty.call(styles, 'borderRadius')) {
    base.borderRadius = coerceString(styles.borderRadius) || defaultPageStyles.borderRadius
  }
  if (Object.prototype.hasOwnProperty.call(styles, 'elevation')) {
    base.elevation = coerceString(styles.elevation) || defaultPageStyles.elevation
  }
  return base
}

const normaliseSettings = (settings = {}) => {
  const themeTokens = normaliseThemeTokens(settings.themeTokens)
  const workspace = normaliseWorkspacePreferences(settings.workspace)
  const pageStyles = normalisePageStyles(settings.pageStyles)
  return { themeTokens, workspace, pageStyles }
}

const normaliseScreen = (rawScreen = {}) => {
  const id = coerceString(rawScreen.id)
  const name = coerceString(rawScreen.name)
  const device = coerceString(rawScreen.device) || 'Desktop'
  const description = coerceOptionalString(rawScreen.description)
  const tags = Array.isArray(rawScreen.tags)
    ? rawScreen.tags
        .map((tag) => coerceString(tag))
        .filter((tag) => Boolean(tag))
    : []
  const status = rawScreen.status === 'published' ? 'published' : 'draft'
  const previewImage = coerceOptionalString(rawScreen.previewImage)
  const createdAt = coerceString(rawScreen.createdAt) || null
  const updatedAt = coerceString(rawScreen.updatedAt) || createdAt

  return {
    id,
    name,
    device,
    description,
    tags,
    status,
    previewImage,
    createdAt,
    updatedAt,
  }
}

const mergeSettings = (baseSettings, patch = {}) => {
  const base = normaliseSettings(baseSettings)
  if (!isObjectLike(patch)) {
    return base
  }
  const next = cloneDeep(base)
  if (patch.themeTokens) {
    next.themeTokens = normaliseThemeTokens({ ...next.themeTokens, ...patch.themeTokens })
  }
  if (patch.workspace) {
    next.workspace = normaliseWorkspacePreferences({ ...next.workspace, ...patch.workspace })
  }
  if (patch.pageStyles) {
    next.pageStyles = normalisePageStyles({ ...next.pageStyles, ...patch.pageStyles })
  }
  return next
}

const loadState = async () => {
  const stored = await readJsonFile(storePath)
  if (!stored) {
    return cloneDeep(defaultState)
  }

  const screens = Array.isArray(stored.screens) ? stored.screens.map((entry) => normaliseScreen(entry)) : []
  const screensMeta = normaliseMeta(stored.screensMeta)
  const settings = mergeSettings(defaultSettings, stored.settings)
  const settingsMeta = normaliseMeta(stored.settingsMeta)

  return { screens, screensMeta, settings, settingsMeta }
}

const persistState = async (state) => {
  const payload = {
    screens: state.screens.map((screen) => ({ ...screen })),
    screensMeta: { ...state.screensMeta },
    settings: cloneDeep(state.settings),
    settingsMeta: { ...state.settingsMeta },
  }
  await writeJsonFile(storePath, payload)
}

let writeQueue = Promise.resolve()

const withWriteLock = (operation) => {
  const next = writeQueue.then(() => operation())
  writeQueue = next.catch(() => {})
  return next
}

const generateScreenId = (name, device, existingIds) => {
  const baseSlug = slugify(name) || 'screen'
  const deviceSlug = slugify(device) || 'device'
  const baseId = `${baseSlug}-${deviceSlug}`
  let candidate = baseId
  let attempt = 1
  while (existingIds.has(candidate)) {
    attempt += 1
    candidate = `${baseId}-${attempt}`
  }
  return candidate
}

const assertExpectedVersion = (actual, expected, resource) => {
  if (expected === null || expected === undefined) {
    const error = new Error('An expected version must be provided for canvas mutations.')
    error.code = 'CANVAS_PRECONDITION_REQUIRED'
    error.status = 428
    error.resource = resource
    throw error
  }
  if (actual !== expected) {
    const error = new Error('The canvas resource has changed since it was last loaded.')
    error.code = 'CANVAS_VERSION_CONFLICT'
    error.status = 409
    error.resource = resource
    error.expected = expected
    error.actual = actual
    throw error
  }
}

const getScreens = async () => {
  const state = await loadState()
  return {
    screens: state.screens.map((screen) => ({ ...screen })),
    version: state.screensMeta.version,
    updatedAt: state.screensMeta.updatedAt,
  }
}

const createScreen = async (input = {}, expectedVersion) => {
  return withWriteLock(async () => {
    const state = await loadState()
    assertExpectedVersion(state.screensMeta.version, expectedVersion, 'screens')

    const name = coerceString(input.name)
    if (!name) {
      const error = new Error('Screen name is required.')
      error.code = 'CANVAS_INVALID_SCREEN'
      error.status = 400
      throw error
    }

    const device = coerceString(input.device) || 'Desktop'
    const description = coerceOptionalString(input.description)
    const tags = Array.isArray(input.tags)
      ? input.tags
          .map((tag) => coerceString(tag))
          .filter((tag) => Boolean(tag))
      : []
    const status = input.status === 'published' ? 'published' : 'draft'
    const previewImage = coerceOptionalString(input.previewImage)

    const existingIds = new Set(state.screens.map((screen) => screen.id))
    const id = coerceString(input.id) || generateScreenId(name, device, existingIds)
    if (existingIds.has(id)) {
      const error = new Error(`A screen with id "${id}" already exists.`)
      error.code = 'CANVAS_DUPLICATE_SCREEN'
      error.status = 409
      throw error
    }

    const timestamp = new Date().toISOString()
    const screen = {
      id,
      name,
      device,
      description,
      tags,
      status,
      previewImage,
      createdAt: timestamp,
      updatedAt: timestamp,
    }

    const nextState = {
      ...state,
      screens: [...state.screens, screen],
      screensMeta: {
        version: state.screensMeta.version + 1,
        updatedAt: timestamp,
      },
    }

    await persistState(nextState)

    return {
      screen: { ...screen },
      screens: nextState.screens.map((entry) => ({ ...entry })),
      version: nextState.screensMeta.version,
      updatedAt: nextState.screensMeta.updatedAt,
    }
  })
}

const updateScreen = async (screenId, patch = {}, expectedVersion) => {
  return withWriteLock(async () => {
    const state = await loadState()
    assertExpectedVersion(state.screensMeta.version, expectedVersion, 'screens')

    const index = state.screens.findIndex((screen) => screen.id === screenId)
    if (index === -1) {
      const error = new Error(`Screen "${screenId}" not found.`)
      error.code = 'CANVAS_SCREEN_NOT_FOUND'
      error.status = 404
      throw error
    }

    const current = state.screens[index]
    const next = { ...current }

    if (Object.prototype.hasOwnProperty.call(patch, 'name')) {
      const name = coerceString(patch.name)
      if (!name) {
        const error = new Error('Screen name cannot be empty.')
        error.code = 'CANVAS_INVALID_SCREEN'
        error.status = 400
        throw error
      }
      next.name = name
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'device')) {
      next.device = coerceString(patch.device) || current.device
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'description')) {
      next.description = coerceOptionalString(patch.description)
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'tags')) {
      if (!Array.isArray(patch.tags)) {
        const error = new Error('Screen tags must be an array.')
        error.code = 'CANVAS_INVALID_SCREEN'
        error.status = 400
        throw error
      }
      next.tags = patch.tags
        .map((tag) => coerceString(tag))
        .filter((tag) => Boolean(tag))
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'status')) {
      const status = coerceString(patch.status)
      if (status && status !== 'draft' && status !== 'published') {
        const error = new Error('Screen status must be "draft" or "published".')
        error.code = 'CANVAS_INVALID_SCREEN'
        error.status = 400
        throw error
      }
      next.status = status || 'draft'
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'previewImage')) {
      next.previewImage = coerceOptionalString(patch.previewImage)
    }

    const timestamp = new Date().toISOString()
    next.updatedAt = timestamp

    const nextState = {
      ...state,
      screens: state.screens.map((screen, position) => (position === index ? next : screen)),
      screensMeta: {
        version: state.screensMeta.version + 1,
        updatedAt: timestamp,
      },
    }

    await persistState(nextState)

    return {
      screen: { ...next },
      screens: nextState.screens.map((entry) => ({ ...entry })),
      version: nextState.screensMeta.version,
      updatedAt: nextState.screensMeta.updatedAt,
    }
  })
}

const deleteScreen = async (screenId, expectedVersion) => {
  return withWriteLock(async () => {
    const state = await loadState()
    assertExpectedVersion(state.screensMeta.version, expectedVersion, 'screens')

    const index = state.screens.findIndex((screen) => screen.id === screenId)
    if (index === -1) {
      const error = new Error(`Screen "${screenId}" not found.`)
      error.code = 'CANVAS_SCREEN_NOT_FOUND'
      error.status = 404
      throw error
    }

    const nextScreens = state.screens.filter((screen) => screen.id !== screenId)
    const timestamp = new Date().toISOString()

    const nextState = {
      ...state,
      screens: nextScreens,
      screensMeta: {
        version: state.screensMeta.version + 1,
        updatedAt: timestamp,
      },
    }

    await persistState(nextState)

    return {
      screens: nextScreens.map((entry) => ({ ...entry })),
      version: nextState.screensMeta.version,
      updatedAt: nextState.screensMeta.updatedAt,
    }
  })
}

const getSettings = async () => {
  const state = await loadState()
  return {
    settings: cloneDeep(state.settings),
    version: state.settingsMeta.version,
    updatedAt: state.settingsMeta.updatedAt,
  }
}

const updateSettings = async (patch = {}, expectedVersion) => {
  return withWriteLock(async () => {
    const state = await loadState()
    assertExpectedVersion(state.settingsMeta.version, expectedVersion, 'settings')

    const nextSettings = mergeSettings(state.settings, patch)
    const timestamp = new Date().toISOString()

    const nextState = {
      ...state,
      settings: nextSettings,
      settingsMeta: {
        version: state.settingsMeta.version + 1,
        updatedAt: timestamp,
      },
    }

    await persistState(nextState)

    return {
      settings: cloneDeep(nextSettings),
      version: nextState.settingsMeta.version,
      updatedAt: nextState.settingsMeta.updatedAt,
    }
  })
}

const resetStoreForTests = async () => {
  await withWriteLock(async () => {
    await persistState(cloneDeep(defaultState))
  })
}

module.exports = {
  defaultThemeTokens,
  defaultWorkspacePreferences,
  defaultPageStyles,
  defaultSettings,
  getScreens,
  createScreen,
  updateScreen,
  deleteScreen,
  getSettings,
  updateSettings,
  __storePath: storePath,
  __resetStoreForTests: resetStoreForTests,
}
