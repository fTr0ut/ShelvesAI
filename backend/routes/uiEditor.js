const express = require('express')

const {
  getAvailableScreens,
  getRoutesConfig,
  saveRoutesConfig,
} = require('../services/ui/routesStore')

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

module.exports = router

