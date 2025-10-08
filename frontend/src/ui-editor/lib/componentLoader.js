import { getProjectSettings, subscribeToProjectSettings } from './projectSettings'

const makeSlotKey = (surfaceId, slotId) => `${surfaceId}:${slotId}`

const buildSurface = (definition) => Object.freeze({
  ...definition,
  slots: Object.freeze(definition.slots.map((slot) => Object.freeze({
    ...slot,
    accepts: Object.freeze([...(slot.accepts || [])]),
  }))),
})

const SURFACE_DEFINITIONS = Object.freeze({
  button: buildSurface({
    id: 'button',
    label: 'Button',
    description: 'Trigger backend actions when the user interacts with a button.',
    slots: [
      {
        id: 'action',
        label: 'On click',
        description: 'Invoked when the button is pressed.',
        accepts: ['action'],
        multi: false,
      },
    ],
  }),
  form: buildSurface({
    id: 'form',
    label: 'Form',
    description: 'Manage form submission and initial data requirements.',
    slots: [
      {
        id: 'submit',
        label: 'On submit',
        description: 'Runs when the form is submitted.',
        accepts: ['action'],
        multi: false,
      },
      {
        id: 'initialData',
        label: 'Initial data',
        description: 'Fetch data to prefill the form before display.',
        accepts: ['query'],
        multi: false,
      },
    ],
  }),
})

const SURFACE_LIST = Object.freeze(Object.values(SURFACE_DEFINITIONS))

const SURFACE_SLOT_INDEX = new Map()
const SURFACE_SLOT_LIST = []

SURFACE_LIST.forEach((surface) => {
  surface.slots.forEach((slot) => {
    const entry = Object.freeze({
      key: makeSlotKey(surface.id, slot.id),
      surfaceId: surface.id,
      slotId: slot.id,
      accepts: slot.accepts,
      surface,
      slot,
    })
    SURFACE_SLOT_INDEX.set(entry.key, entry)
    SURFACE_SLOT_LIST.push(entry)
  })
})

const RECOMMENDED_SLOT_KEYS = Object.freeze({
  action: new Set([makeSlotKey('button', 'action'), makeSlotKey('form', 'submit')]),
  query: new Set([makeSlotKey('form', 'initialData')]),
})

const getCapability = (method = '') => {
  const normalised = String(method || 'GET').toUpperCase()
  if (normalised === 'GET' || normalised === 'HEAD') return 'query'
  return 'action'
}

const encodePath = (path = '') => {
  if (!path) return '%2F'
  return encodeURIComponent(path)
}

const buildComponentFromEndpoint = (endpoint) => {
  if (!endpoint || typeof endpoint !== 'object') return null
  const method = String(endpoint.method || 'GET').toUpperCase()
  const path = endpoint.path || '/'
  const capability = getCapability(method)
  const capabilities = Object.freeze([capability])
  const id = `endpoint:${method}:${encodePath(path)}`
  const summary = endpoint.summary ? String(endpoint.summary) : ''
  const description = endpoint.description ? String(endpoint.description) : ''
  const label = summary || `${method} ${path}`
  const slotRecommendations = RECOMMENDED_SLOT_KEYS[capability] || new Set()
  const assignableTo = SURFACE_SLOT_LIST.filter((slot) =>
    slot.accepts.some((accept) => capabilities.includes(accept))
  ).map((slot) => slot.key)

  const recommendedSlots = assignableTo.filter((key) => slotRecommendations.has(key))

  return Object.freeze({
    id,
    type: 'api-endpoint',
    source: 'project-endpoint',
    label,
    summary,
    description,
    method,
    path,
    operationId: endpoint.operationId || null,
    tags: Array.isArray(endpoint.tags) ? [...endpoint.tags] : [],
    capability,
    capabilities,
    assignableTo,
    recommendedSlots,
    endpoint: {
      method,
      path,
      summary,
      description,
      operationId: endpoint.operationId || null,
      tags: Array.isArray(endpoint.tags) ? [...endpoint.tags] : [],
    },
  })
}

const sortComponents = (components) => {
  return [...components].sort((a, b) => {
    if (a.method === b.method) {
      return a.path.localeCompare(b.path)
    }
    return a.method.localeCompare(b.method)
  })
}

const buildLibraryFromSettings = (settings) => {
  const endpoints = settings?.endpointMeta?.endpoints || []
  const deduped = new Map()
  endpoints.forEach((endpoint) => {
    const component = buildComponentFromEndpoint(endpoint)
    if (component && !deduped.has(component.id)) {
      deduped.set(component.id, component)
    }
  })
  const components = sortComponents(Array.from(deduped.values()))

  return {
    version: settings?.version ?? 0,
    generatedAt: new Date().toISOString(),
    meta: {
      format: settings?.endpointMeta?.format || null,
      title: settings?.endpointMeta?.title || '',
      version: settings?.endpointMeta?.version || '',
      description: settings?.endpointMeta?.description || '',
    },
    components,
    byCapability: {
      action: components.filter((component) => component.capability === 'action'),
      query: components.filter((component) => component.capability === 'query'),
    },
    surfaces: SURFACE_LIST,
  }
}

let currentLibrary = buildLibraryFromSettings(getProjectSettings())
let componentIndex = new Map(currentLibrary.components.map((component) => [component.id, component]))

const listeners = new Set()

const emitChange = () => {
  listeners.forEach((listener) => {
    try {
      listener(currentLibrary)
    } catch (error) {
      console.error('Component library listener failed', error)
    }
  })
}

subscribeToProjectSettings((settings) => {
  currentLibrary = buildLibraryFromSettings(settings)
  componentIndex = new Map(currentLibrary.components.map((component) => [component.id, component]))
  emitChange()
})

export const getComponentLibrary = () => currentLibrary

export const subscribeToComponentLibrary = (listener) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const getComponentById = (componentId) => componentIndex.get(componentId) || null

export const getComponentSurfaces = () => SURFACE_LIST

export const getSurfaceDefinition = (surfaceId) => SURFACE_DEFINITIONS[surfaceId] || null

const getSlotEntry = (surfaceId, slotId) => SURFACE_SLOT_INDEX.get(makeSlotKey(surfaceId, slotId)) || null

export const getSurfaceSlot = (surfaceId, slotId) => {
  const entry = getSlotEntry(surfaceId, slotId)
  if (!entry) return null
  return entry.slot
}

export const listSurfaceSlots = () => SURFACE_SLOT_LIST

export const canComponentBindToSlot = (componentId, surfaceId, slotId) => {
  const component = getComponentById(componentId)
  const entry = getSlotEntry(surfaceId, slotId)
  if (!component || !entry) return false
  return component.capabilities.some((capability) => entry.accepts.includes(capability))
}

export const getAssignableComponentsForSurfaceSlot = (surfaceId, slotId) => {
  const entry = getSlotEntry(surfaceId, slotId)
  if (!entry) return []
  const library = getComponentLibrary()
  return library.components.filter((component) =>
    component.capabilities.some((capability) => entry.accepts.includes(capability))
  )
}

export const getAssignableSlotsForComponent = (componentId) => {
  const component = getComponentById(componentId)
  if (!component) return []
  return SURFACE_SLOT_LIST.filter((entry) =>
    component.capabilities.some((capability) => entry.accepts.includes(capability))
  )
}

export { makeSlotKey }
