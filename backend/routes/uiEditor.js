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
const { publishScreenBundle } = require('../services/ui/publishScreenBundle')

const router = express.Router()

router.get('/screens', async (_req, res) => {
  try {
    const screens = await getAvailableScreens()
    res.json({ screens })
  } catch (error) {
    console.error('[ui-editor] Failed to load screens:', error)
    res.status(500).json({ error: 'Unable to load available screens.' })
  }
})

router.get('/routes', async (_req, res) => {
  try {
    const { routes, updatedAt, screens } = await getRoutesConfig()
    res.json({ routes, updatedAt, availableScreens: screens })
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
    const { routes, updatedAt, screens } = await saveRoutesConfig(submitted)
    res.json({ routes, updatedAt, availableScreens: screens })
  } catch (error) {
    console.error('[ui-editor] Failed to persist route config:', error)
    res.status(500).json({ error: 'Unable to persist route configuration.' })
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

