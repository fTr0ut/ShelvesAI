const fs = require('fs/promises')
const path = require('path')

const repoRoot = path.join(__dirname, '..', '..', '..')
const plasmicConfigPath = path.join(repoRoot, 'plasmic.json')
const storePath = path.join(repoRoot, 'backend', 'cache', 'ui-routes.json')

function coerceString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function ensureLeadingSlash(pathname = '') {
  const trimmed = pathname.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('/')) return trimmed.replace(/\/+$/, '') || '/'
  return `/${trimmed.replace(/^\/+/, '').replace(/\/+$/, '') || ''}` || '/'
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
    console.warn(`[ui.routesStore] Failed to read ${filePath}:`, error.message)
    throw error
  }
}

function buildDefaultRoutesFromScreens(screens = []) {
  return screens
    .filter((screen) => Boolean(screen.path))
    .map((screen) => ({
      id: screen.id,
      path: screen.path,
      screenId: screen.id,
      screenName: screen.name,
      screenPath: screen.path,
      projectId: screen.projectId,
      projectName: screen.projectName,
    }))
}

function normalizeRoutesList(inputRoutes = [], screens = []) {
  if (!Array.isArray(inputRoutes)) return []

  const screenMap = new Map(screens.map((screen) => [screen.id, screen]))

  return inputRoutes
    .map((route, index) => {
      if (!route || typeof route !== 'object') return null

      const rawId = coerceString(route.id)
      const rawPath = coerceString(route.path)
      const normalizedPath = ensureLeadingSlash(rawPath)
      if (!normalizedPath) return null

      const screenId = coerceString(route.screenId)
      const screen = screenMap.get(screenId) || null

      const autoId = rawId
        || (screen ? `${screen.name || 'screen'}-${screen.id}` : null)
        || `route-${index + 1}`

      return {
        id: autoId,
        path: normalizedPath,
        screenId: screenId || null,
        screenName: screen?.name || coerceString(route.screenName) || null,
        screenPath: screen?.path || coerceString(route.screenPath) || null,
        projectId: screen?.projectId || coerceString(route.projectId) || null,
        projectName: screen?.projectName || coerceString(route.projectName) || null,
      }
    })
    .filter(Boolean)
}

async function getAvailableScreens() {
  const config = await readJsonFile(plasmicConfigPath)
  if (!config) return []

  const projects = Array.isArray(config.projects) ? config.projects : []

  const screens = []
  for (const project of projects) {
    const projectId = project.projectId || project.id || null
    const projectName = project.projectName || project.name || null
    const components = Array.isArray(project.components) ? project.components : []

    for (const component of components) {
      if (component?.componentType !== 'page') continue

      screens.push({
        id: component.id,
        name: component.name,
        path: component.path || null,
        projectId,
        projectName,
      })
    }
  }

  return screens
}

async function loadStoredRoutes() {
  const payload = await readJsonFile(storePath)
  if (!payload) {
    return { routes: [], updatedAt: null }
  }

  const routes = Array.isArray(payload.routes) ? payload.routes : []
  const updatedAt = payload.updatedAt || null
  return { routes, updatedAt }
}

async function getRoutesConfig() {
  const screens = await getAvailableScreens()
  const stored = await loadStoredRoutes()
  const normalizedRoutes = normalizeRoutesList(stored.routes, screens)

  const routes = normalizedRoutes.length > 0 ? normalizedRoutes : buildDefaultRoutesFromScreens(screens)

  return {
    routes,
    updatedAt: stored.updatedAt || null,
    screens,
  }
}

async function saveRoutesConfig(inputRoutes = []) {
  const screens = await getAvailableScreens()
  const routes = normalizeRoutesList(inputRoutes, screens)
  const payload = {
    updatedAt: new Date().toISOString(),
    routes,
  }

  await ensureStoreDirectory()
  await fs.writeFile(storePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')

  return {
    routes,
    updatedAt: payload.updatedAt,
    screens,
  }
}

module.exports = {
  getAvailableScreens,
  getRoutesConfig,
  saveRoutesConfig,
  normalizeRoutesList,
}

