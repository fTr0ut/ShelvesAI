const express = require('express')

const {
  getAvailableScreens,
  getRoutesConfig,
  saveRoutesConfig,
} = require('../services/ui/routesStore')
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

