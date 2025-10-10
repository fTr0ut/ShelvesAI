const fs = require('fs/promises')
const path = require('path')

const { getRoutesConfig } = require('./routesStore')

const repoRoot = path.join(__dirname, '..', '..', '..')
const DEFAULT_BUNDLE_FILENAME = 'screen-bundle.json'

const TARGET_ALIASES = new Map([
  ['prod', 'production'],
  ['production', 'production'],
  ['staging', 'staging'],
  ['stage', 'staging'],
])

function normalizeIdentifier(value) {
  if (!value) return ''
  return String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')
}

function resolveTargetKey(value) {
  const normalized = normalizeIdentifier(value)
  if (!normalized) return ''
  return TARGET_ALIASES.get(normalized) || normalized
}

function parseDirectoryList(value) {
  const directories = new Set()

  const add = (entry) => {
    if (!entry && entry !== 0) return
    const trimmed = String(entry).trim()
    if (!trimmed) return
    const resolved = path.isAbsolute(trimmed) ? trimmed : path.resolve(repoRoot, trimmed)
    directories.add(resolved)
  }

  if (Array.isArray(value)) {
    value.forEach(add)
  } else if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) {
      return []
    }

    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) {
        parsed.forEach(add)
        return Array.from(directories)
      }
      if (parsed && typeof parsed === 'object') {
        Object.values(parsed).forEach((entry) => {
          if (Array.isArray(entry)) {
            entry.forEach(add)
          } else if (entry) {
            add(entry)
          }
        })
        return Array.from(directories)
      }
    } catch (error) {
      // Fall through to parsing as a delimited string
    }

    trimmed
      .split(/[;,]/)
      .map((part) => part.trim())
      .filter(Boolean)
      .forEach((part) => {
        part.split('|').forEach((section) => add(section))
      })
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach((entry) => {
      if (Array.isArray(entry)) {
        entry.forEach(add)
      } else if (entry) {
        add(entry)
      }
    })
  }

  return Array.from(directories)
}

function addTarget(config, target, directories) {
  if (!directories?.length) return
  const key = resolveTargetKey(target)
  if (!key) return
  const existing = config.get(key) || []
  const merged = new Set(existing)
  directories.forEach((dir) => {
    if (dir) merged.add(dir)
  })
  if (merged.size) {
    config.set(key, Array.from(merged))
  }
}

function parseTargetsPayload(config, payload) {
  if (!payload) return
  if (Array.isArray(payload)) {
    payload.forEach((entry) => {
      if (!entry || typeof entry !== 'object') return
      const target = entry.target || entry.id || entry.name
      const directories = parseDirectoryList(entry.directories || entry.paths || entry.dirs)
      addTarget(config, target, directories)
    })
    return
  }
  if (typeof payload === 'object') {
    Object.entries(payload).forEach(([target, value]) => {
      addTarget(config, target, parseDirectoryList(value))
    })
  }
}

function parseTargetsString(config, raw) {
  raw
    .split(/[,;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .forEach((entry) => {
      const match = entry.match(/^([^:=\s]+)\s*[:=]\s*(.+)$/)
      if (!match) return
      const [, target, value] = match
      addTarget(config, target, parseDirectoryList(value))
    })
}

function loadPublishConfig() {
  const config = new Map()

  const rawTargets = process.env.UI_PUBLISH_TARGETS
  if (rawTargets) {
    try {
      const parsed = JSON.parse(rawTargets)
      parseTargetsPayload(config, parsed)
    } catch (error) {
      parseTargetsString(config, rawTargets)
    }
  }

  Object.entries(process.env).forEach(([key, value]) => {
    const match = key.match(/^UI_PUBLISH_([A-Z0-9_]+)_(?:PATHS|DIRS)$/)
    if (!match) return
    const targetToken = match[1].toLowerCase().replace(/_/g, '-')
    addTarget(config, targetToken, parseDirectoryList(value))
  })

  return config
}

async function buildScreenBundle() {
  const { routes, updatedAt, screens, canvasScreens, canvasMeta } = await getRoutesConfig()
  const generatedAt = new Date().toISOString()
  return {
    generatedAt,
    routesUpdatedAt: updatedAt || null,
    routes,
    screens,
    canvasScreens: Array.isArray(canvasScreens) ? canvasScreens : [],
    canvasMeta: canvasMeta || { version: 0, updatedAt: null },
  }
}

function resolveOutput(entry) {
  const filePath = entry
  if (path.extname(filePath)) {
    const directory = path.dirname(filePath)
    return { source: entry, directory, file: filePath }
  }
  return {
    source: entry,
    directory: entry,
    file: path.join(entry, DEFAULT_BUNDLE_FILENAME),
  }
}

async function publishScreenBundle(target) {
  const config = loadPublishConfig()
  const availableTargets = Array.from(config.keys())
  const resolvedTarget = resolveTargetKey(target)
  if (!resolvedTarget) {
    const error = new Error('A publish target must be provided.')
    error.code = 'UI_PUBLISH_INVALID_TARGET'
    error.details = { availableTargets }
    throw error
  }

  const directories = config.get(resolvedTarget) || []
  if (!directories.length) {
    const error = new Error(
      `No publish directories configured for target "${resolvedTarget}". Set UI_PUBLISH_TARGETS or UI_PUBLISH_${resolvedTarget
        .toUpperCase()
        .replace(/-/g, '_')}_PATHS to continue.`,
    )
    error.code = 'UI_PUBLISH_NO_DIRECTORIES'
    error.details = { target: resolvedTarget, availableTargets }
    throw error
  }

  const bundle = await buildScreenBundle()
  const meta = {
    generatedAt: bundle.generatedAt,
    routesUpdatedAt: bundle.routesUpdatedAt,
    routeCount: Array.isArray(bundle.routes) ? bundle.routes.length : 0,
    screenCount: Array.isArray(bundle.screens) ? bundle.screens.length : 0,
    canvasScreenCount: Array.isArray(bundle.canvasScreens) ? bundle.canvasScreens.length : 0,
  }
  const payload = `${JSON.stringify(bundle, null, 2)}\n`

  const outputs = directories.map((entry) => resolveOutput(entry))
  const writtenFiles = []
  const failures = []

  for (const output of outputs) {
    try {
      await fs.mkdir(output.directory, { recursive: true })
      await fs.writeFile(output.file, payload, 'utf8')
      writtenFiles.push(output.file)
    } catch (error) {
      failures.push({
        directory: output.directory,
        file: output.file,
        message: error?.message || 'Unknown error',
        code: error?.code || null,
      })
    }
  }

  if (!writtenFiles.length) {
    const error = new Error(`Failed to publish screen bundle for target "${resolvedTarget}".`)
    error.code = 'UI_PUBLISH_FAILED'
    error.details = { target: resolvedTarget, failures, availableTargets }
    throw error
  }

  const status = failures.length ? 'partial' : 'success'

  return {
    target: resolvedTarget,
    status,
    meta,
    writtenFiles,
    failures,
    destinations: outputs,
    availableTargets,
  }
}

module.exports = {
  publishScreenBundle,
  loadPublishConfig,
}
