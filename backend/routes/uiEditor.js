const express = require('express')

const {
  getAvailableScreens,
  getRoutesConfig,
  saveRoutesConfig,
} = require('../services/ui/routesStore')
const {
  getProjectSettings,
  saveProjectSettings,
  sanitizeForResponse,
} = require('../services/ui/projectSettingsStore')
const {
  getScreens: getCanvasScreens,
  createScreen: createCanvasScreen,
  updateScreen: updateCanvasScreen,
  updateScreenNodes: updateCanvasScreenNodes,
  deleteScreen: deleteCanvasScreen,
  getSettings: getCanvasSettings,
  updateSettings: updateCanvasSettings,
} = require('../services/ui/canvasStore')
const { publishScreenBundle } = require('../services/ui/publishScreenBundle')

const router = express.Router()

router.get('/screens', async (_req, res) => {
  try {
    const { screens, canvasScreens, canvasMeta } = await getAvailableScreens()
    res.json({ screens, canvasScreens, canvasMeta })
  } catch (error) {
    console.error('[ui-editor] Failed to load screens:', error)
    res.status(500).json({ error: 'Unable to load available screens.' })
  }
})

router.get('/routes', async (_req, res) => {
  try {
    const { routes, updatedAt, screens, canvasScreens, canvasMeta } = await getRoutesConfig()
    res.json({ routes, updatedAt, availableScreens: screens, canvasScreens, canvasMeta })
  } catch (error) {
    console.error('[ui-editor] Failed to load route config:', error)
    res.status(500).json({ error: 'Unable to load route configuration.' })
  }
})

router.put('/routes', async (req, res) => {
  const submitted = req.body?.routes
  if (!Array.isArray(submitted)) {
    return res.status(400).json({ error: 'Request body must include an array of routes.' })
  }

  try {
    const { routes, updatedAt, screens, canvasScreens, canvasMeta } = await saveRoutesConfig(submitted)
    res.json({ routes, updatedAt, availableScreens: screens, canvasScreens, canvasMeta })
  } catch (error) {
    console.error('[ui-editor] Failed to persist route config:', error)
    res.status(500).json({ error: 'Unable to persist route configuration.' })
  }
})

const parseVersionHeader = (req) => {
  const rawHeader = req.headers['if-match']
  if (rawHeader === undefined) {
    const error = new Error('An If-Match header is required to modify canvas resources.')
    error.status = 428
    throw error
  }
  const headerValue = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader
  const parsed = Number.parseInt(headerValue, 10)
  if (!Number.isInteger(parsed) || parsed < 0) {
    const error = new Error('If-Match header must be a non-negative integer version.')
    error.status = 400
    throw error
  }
  return parsed
}

const buildScreenPayload = (candidate) => {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw Object.assign(new Error('Request body must include a screen object.'), { status: 400 })
  }

  const payload = {}

  if (Object.prototype.hasOwnProperty.call(candidate, 'id')) {
    if (candidate.id !== null && candidate.id !== undefined && typeof candidate.id !== 'string') {
      throw Object.assign(new Error('Screen id must be a string when provided.'), { status: 400 })
    }
    payload.id = candidate.id
  }

  if (Object.prototype.hasOwnProperty.call(candidate, 'name')) {
    if (candidate.name !== null && typeof candidate.name !== 'string') {
      throw Object.assign(new Error('Screen name must be a string.'), { status: 400 })
    }
    payload.name = candidate.name
  }

  if (Object.prototype.hasOwnProperty.call(candidate, 'device')) {
    if (candidate.device !== null && typeof candidate.device !== 'string') {
      throw Object.assign(new Error('Screen device must be a string.'), { status: 400 })
    }
    payload.device = candidate.device
  }

  if (Object.prototype.hasOwnProperty.call(candidate, 'description')) {
    if (candidate.description !== null && typeof candidate.description !== 'string') {
      throw Object.assign(new Error('Screen description must be a string when provided.'), {
        status: 400,
      })
    }
    payload.description = candidate.description
  }

  if (Object.prototype.hasOwnProperty.call(candidate, 'tags')) {
    if (!Array.isArray(candidate.tags)) {
      throw Object.assign(new Error('Screen tags must be an array of strings.'), { status: 400 })
    }
    payload.tags = candidate.tags
  }

  if (Object.prototype.hasOwnProperty.call(candidate, 'status')) {
    if (candidate.status !== null && typeof candidate.status !== 'string') {
      throw Object.assign(new Error('Screen status must be a string.'), { status: 400 })
    }
    payload.status = candidate.status
  }

  if (Object.prototype.hasOwnProperty.call(candidate, 'previewImage')) {
    if (candidate.previewImage !== null && typeof candidate.previewImage !== 'string') {
      throw Object.assign(new Error('Screen previewImage must be a string when provided.'), { status: 400 })
    }
    payload.previewImage = candidate.previewImage
  }

  if (Object.prototype.hasOwnProperty.call(candidate, 'nodes')) {
    if (candidate.nodes !== null && candidate.nodes !== undefined && !Array.isArray(candidate.nodes)) {
      throw Object.assign(new Error('Screen nodes must be provided as an array when included.'), {
        status: 400,
      })
    }
    payload.nodes = candidate.nodes
  }

  return payload
}

const buildSettingsPayload = (candidate) => {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw Object.assign(new Error('Request body must include a settings object.'), { status: 400 })
  }

  const payload = {}

  if (Object.prototype.hasOwnProperty.call(candidate, 'themeTokens')) {
    const theme = candidate.themeTokens
    if (!theme || typeof theme !== 'object' || Array.isArray(theme)) {
      throw Object.assign(new Error('themeTokens must be an object.'), { status: 400 })
    }
    payload.themeTokens = {}
    if (Object.prototype.hasOwnProperty.call(theme, 'colorScheme')) {
      payload.themeTokens.colorScheme = theme.colorScheme
    }
    if (Object.prototype.hasOwnProperty.call(theme, 'accentColor')) {
      payload.themeTokens.accentColor = theme.accentColor
    }
    if (Object.prototype.hasOwnProperty.call(theme, 'background')) {
      payload.themeTokens.background = theme.background
    }
    if (Object.prototype.hasOwnProperty.call(theme, 'surfaceColor')) {
      payload.themeTokens.surfaceColor = theme.surfaceColor
    }
    if (Object.prototype.hasOwnProperty.call(theme, 'textColor')) {
      payload.themeTokens.textColor = theme.textColor
    }
  }

  if (Object.prototype.hasOwnProperty.call(candidate, 'workspace')) {
    const workspace = candidate.workspace
    if (!workspace || typeof workspace !== 'object' || Array.isArray(workspace)) {
      throw Object.assign(new Error('workspace must be an object.'), { status: 400 })
    }
    payload.workspace = {}
    if (Object.prototype.hasOwnProperty.call(workspace, 'headerStyle')) {
      payload.workspace.headerStyle = workspace.headerStyle
    }
    if (Object.prototype.hasOwnProperty.call(workspace, 'footerStyle')) {
      payload.workspace.footerStyle = workspace.footerStyle
    }
    if (Object.prototype.hasOwnProperty.call(workspace, 'showAnnouncement')) {
      payload.workspace.showAnnouncement = workspace.showAnnouncement
    }
  }

  if (Object.prototype.hasOwnProperty.call(candidate, 'pageStyles')) {
    const styles = candidate.pageStyles
    if (!styles || typeof styles !== 'object' || Array.isArray(styles)) {
      throw Object.assign(new Error('pageStyles must be an object.'), { status: 400 })
    }
    payload.pageStyles = { ...styles }
  }

  return payload
}

const buildNodeCollectionPayload = (candidate) => {
  const nodes = candidate?.nodes ?? candidate
  if (nodes === undefined) {
    throw Object.assign(new Error('Request body must include a nodes array.'), { status: 400 })
  }
  if (nodes === null) {
    return []
  }
  if (!Array.isArray(nodes)) {
    throw Object.assign(new Error('Canvas nodes must be provided as an array.'), { status: 400 })
  }
  return nodes
}

router.get('/canvas/screens', async (_req, res) => {
  try {
    const { screens, version, updatedAt } = await getCanvasScreens()
    res.json({ screens, version, updatedAt })
  } catch (error) {
    console.error('[ui-editor] Failed to load canvas screens:', error)
    res.status(500).json({ error: 'Unable to load canvas screens.' })
  }
})

router.post('/canvas/screens', async (req, res) => {
  let expectedVersion
  try {
    expectedVersion = parseVersionHeader(req)
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message || 'Invalid If-Match header.' })
  }

  let screenPayload
  try {
    const candidate = req.body?.screen ?? req.body
    screenPayload = buildScreenPayload(candidate)
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message || 'Invalid screen payload.' })
  }

  try {
    const result = await createCanvasScreen(screenPayload, expectedVersion)
    res.status(201).json(result)
  } catch (error) {
    if (error?.code === 'CANVAS_VERSION_CONFLICT') {
      return res.status(409).json({ error: error.message, actualVersion: error.actual })
    }
    if (error?.code === 'CANVAS_DUPLICATE_SCREEN') {
      return res.status(409).json({ error: error.message })
    }
    if (error?.status === 400 || error?.code === 'CANVAS_INVALID_SCREEN') {
      return res.status(400).json({ error: error.message })
    }
    console.error('[ui-editor] Failed to create canvas screen:', error)
    res.status(500).json({ error: 'Unable to create canvas screen.' })
  }
})

router.put('/canvas/screens/:screenId', async (req, res) => {
  let expectedVersion
  try {
    expectedVersion = parseVersionHeader(req)
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message || 'Invalid If-Match header.' })
  }

  let screenPayload
  try {
    const candidate = req.body?.screen ?? req.body
    screenPayload = buildScreenPayload(candidate)
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message || 'Invalid screen payload.' })
  }

  if (!Object.keys(screenPayload).length) {
    return res.status(400).json({ error: 'Provide at least one screen property to update.' })
  }

  try {
    const result = await updateCanvasScreen(req.params.screenId, screenPayload, expectedVersion)
    res.json(result)
  } catch (error) {
    if (error?.code === 'CANVAS_VERSION_CONFLICT') {
      return res.status(409).json({ error: error.message, actualVersion: error.actual })
    }
    if (error?.code === 'CANVAS_SCREEN_NOT_FOUND') {
      return res.status(404).json({ error: error.message })
    }
    if (error?.status === 400 || error?.code === 'CANVAS_INVALID_SCREEN') {
      return res.status(400).json({ error: error.message })
    }
    console.error('[ui-editor] Failed to update canvas screen:', error)
    res.status(500).json({ error: 'Unable to update canvas screen.' })
  }
})

router.put('/canvas/screens/:screenId/nodes', async (req, res) => {
  let expectedVersion
  try {
    expectedVersion = parseVersionHeader(req)
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message || 'Invalid If-Match header.' })
  }

  let nodesPayload
  try {
    nodesPayload = buildNodeCollectionPayload(req.body)
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message || 'Invalid canvas nodes payload.' })
  }

  try {
    const result = await updateCanvasScreenNodes(req.params.screenId, nodesPayload, expectedVersion)
    res.json(result)
  } catch (error) {
    if (error?.code === 'CANVAS_VERSION_CONFLICT') {
      return res.status(409).json({ error: error.message, actualVersion: error.actual })
    }
    if (error?.code === 'CANVAS_SCREEN_NOT_FOUND') {
      return res.status(404).json({ error: error.message })
    }
    if (error?.status === 400 || error?.code === 'CANVAS_INVALID_SCREEN') {
      return res.status(400).json({ error: error.message })
    }
    console.error('[ui-editor] Failed to update canvas nodes:', error)
    res.status(500).json({ error: 'Unable to update canvas nodes.' })
  }
})

router.delete('/canvas/screens/:screenId', async (req, res) => {
  let expectedVersion
  try {
    expectedVersion = parseVersionHeader(req)
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message || 'Invalid If-Match header.' })
  }

  try {
    const result = await deleteCanvasScreen(req.params.screenId, expectedVersion)
    res.json(result)
  } catch (error) {
    if (error?.code === 'CANVAS_VERSION_CONFLICT') {
      return res.status(409).json({ error: error.message, actualVersion: error.actual })
    }
    if (error?.code === 'CANVAS_SCREEN_NOT_FOUND') {
      return res.status(404).json({ error: error.message })
    }
    console.error('[ui-editor] Failed to delete canvas screen:', error)
    res.status(500).json({ error: 'Unable to delete canvas screen.' })
  }
})

router.get('/canvas/settings', async (_req, res) => {
  try {
    const { settings, version, updatedAt } = await getCanvasSettings()
    res.json({ settings, version, updatedAt })
  } catch (error) {
    console.error('[ui-editor] Failed to load canvas settings:', error)
    res.status(500).json({ error: 'Unable to load canvas settings.' })
  }
})

router.put('/canvas/settings', async (req, res) => {
  let expectedVersion
  try {
    expectedVersion = parseVersionHeader(req)
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message || 'Invalid If-Match header.' })
  }

  let settingsPayload
  try {
    const candidate = req.body?.settings ?? req.body
    settingsPayload = buildSettingsPayload(candidate)
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message || 'Invalid settings payload.' })
  }

  if (!Object.keys(settingsPayload).length) {
    return res.status(400).json({ error: 'Provide at least one settings property to update.' })
  }

  try {
    const result = await updateCanvasSettings(settingsPayload, expectedVersion)
    res.json(result)
  } catch (error) {
    if (error?.code === 'CANVAS_VERSION_CONFLICT') {
      return res.status(409).json({ error: error.message, actualVersion: error.actual })
    }
    console.error('[ui-editor] Failed to update canvas settings:', error)
    res.status(500).json({ error: 'Unable to update canvas settings.' })
  }
})

function extractSettingsPayload(body = {}) {
  if (!body || typeof body !== 'object') return {}

  const candidate = body.settings && typeof body.settings === 'object' ? body.settings : body

  const payload = {}

  if (Object.prototype.hasOwnProperty.call(candidate, 'apiBase')) {
    const value = candidate.apiBase
    if (value !== null && typeof value !== 'string') {
      throw new Error('apiBase must be a string.')
    }
    payload.apiBase = value ?? ''
  }

  if (Object.prototype.hasOwnProperty.call(candidate, 'endpointDocument')) {
    const value = candidate.endpointDocument
    if (value !== null && (typeof value !== 'object' || Array.isArray(value))) {
      throw new Error('endpointDocument must be null or an object.')
    }
    payload.endpointDocument = value
  }

  if (
    Object.prototype.hasOwnProperty.call(candidate, 'authMethod') ||
    Object.prototype.hasOwnProperty.call(candidate, 'authToken') ||
    Object.prototype.hasOwnProperty.call(candidate, 'auth')
  ) {
    const authBlock = candidate.auth && typeof candidate.auth === 'object' ? candidate.auth : {}
    const method = Object.prototype.hasOwnProperty.call(candidate, 'authMethod')
      ? candidate.authMethod
      : authBlock.method
    const token = Object.prototype.hasOwnProperty.call(candidate, 'authToken')
      ? candidate.authToken
      : authBlock.token

    if (method !== undefined && method !== null && typeof method !== 'string') {
      throw new Error('authMethod must be a string.')
    }

    if (token !== undefined && token !== null && typeof token !== 'string') {
      throw new Error('authToken must be a string when provided.')
    }

    if (method !== undefined) {
      payload.authMethod = method
    }
    if (token !== undefined) {
      payload.authToken = token
    }
  }

  if (
    Object.prototype.hasOwnProperty.call(candidate, 'previewTarget') ||
    (candidate.publishTargets && typeof candidate.publishTargets === 'object')
  ) {
    const source = candidate.publishTargets && typeof candidate.publishTargets === 'object' ? candidate.publishTargets : {}
    const preview = Object.prototype.hasOwnProperty.call(candidate, 'previewTarget')
      ? candidate.previewTarget
      : source.preview
    if (preview !== undefined && preview !== null && typeof preview !== 'string') {
      throw new Error('previewTarget must be a string when provided.')
    }
    if (preview !== undefined) {
      payload.previewTarget = preview
    }
  }

  if (
    Object.prototype.hasOwnProperty.call(candidate, 'productionTarget') ||
    (candidate.publishTargets && typeof candidate.publishTargets === 'object')
  ) {
    const source = candidate.publishTargets && typeof candidate.publishTargets === 'object' ? candidate.publishTargets : {}
    const production = Object.prototype.hasOwnProperty.call(candidate, 'productionTarget')
      ? candidate.productionTarget
      : source.production
    if (production !== undefined && production !== null && typeof production !== 'string') {
      throw new Error('productionTarget must be a string when provided.')
    }
    if (production !== undefined) {
      payload.productionTarget = production
    }
  }

  return payload
}

router.get('/settings', async (_req, res) => {
  try {
    const settings = await getProjectSettings()
    res.json({ settings: sanitizeForResponse(settings) })
  } catch (error) {
    console.error('[ui-editor] Failed to load project settings:', error)
    res.status(500).json({ error: 'Unable to load project settings.' })
  }
})

router.put('/settings', async (req, res) => {
  let payload
  try {
    payload = extractSettingsPayload(req.body)
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Invalid project settings payload.' })
  }

  try {
    const settings = await saveProjectSettings(payload)
    res.json({ settings: sanitizeForResponse(settings) })
  } catch (error) {
    console.error('[ui-editor] Failed to persist project settings:', error)
    res.status(500).json({ error: 'Unable to persist project settings.' })
  }
})

router.post('/publish', async (req, res) => {
  const rawTarget = req.body?.target
  const target = typeof rawTarget === 'string' ? rawTarget.trim() : ''
  if (!target) {
    return res
      .status(400)
      .json({ error: 'Request body must include a publish target (e.g., "staging" or "production").' })
  }

  try {
    const result = await publishScreenBundle(target)
    const response = {
      status: result.status,
      target: result.target,
      meta: result.meta,
      writtenFiles: result.writtenFiles,
      failures: result.failures,
      destinations: result.destinations,
    }
    res.json(response)
  } catch (error) {
    const errorDetails =
      error?.details && typeof error.details === 'object'
        ? {
            ...error.details,
            message: error.message,
          }
        : undefined

    if (error?.code === 'UI_PUBLISH_NO_DIRECTORIES' || error?.code === 'UI_PUBLISH_INVALID_TARGET') {
      return res.status(400).json({ error: error.message, details: errorDetails })
    }

    console.error(`[ui-editor] Failed to publish screen bundle for target "${target}":`, error)

    if (error?.code === 'UI_PUBLISH_FAILED') {
      return res.status(500).json({
        error: error.message || 'Failed to publish screen bundle.',
        details: errorDetails,
      })
    }

    res.status(500).json({ error: 'Unable to publish screen bundle.' })
  }
})

module.exports = router

