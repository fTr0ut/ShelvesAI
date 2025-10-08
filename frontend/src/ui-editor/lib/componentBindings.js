import { canComponentBindToSlot, getComponentById, makeSlotKey } from './componentLoader'

const STORAGE_KEY = 'collector.uiEditor.componentBindings.v1'

const defaultState = Object.freeze({
  version: 0,
  bindings: Object.freeze({}),
})

let hasHydrated = false
let state = defaultState

const listeners = new Set()

const safeJsonParse = (value) => {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch (error) {
    console.warn('Unable to parse stored component bindings', error)
    return null
  }
}

const getStorage = () => {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage || null
  } catch (error) {
    console.warn('localStorage unavailable', error)
    return null
  }
}

const freezeBinding = (binding) => {
  if (!binding || typeof binding !== 'object') return null
  const metadata = binding.metadata && typeof binding.metadata === 'object' ? { ...binding.metadata } : undefined
  const componentSnapshot =
    binding.componentSnapshot && typeof binding.componentSnapshot === 'object'
      ? { ...binding.componentSnapshot }
      : undefined
  return Object.freeze({
    componentId: binding.componentId,
    surfaceId: binding.surfaceId,
    slotId: binding.slotId,
    slotKey: makeSlotKey(binding.surfaceId, binding.slotId),
    nodeId: binding.nodeId,
    assignedAt: binding.assignedAt || null,
    metadata: metadata ? Object.freeze(metadata) : undefined,
    componentSnapshot: componentSnapshot ? Object.freeze(componentSnapshot) : undefined,
  })
}

const computeState = (raw) => {
  if (!raw || typeof raw !== 'object') return defaultState
  const version = Number.isFinite(raw.version) ? raw.version : 0
  const bindings = {}
  if (raw.bindings && typeof raw.bindings === 'object') {
    Object.entries(raw.bindings).forEach(([key, binding]) => {
      if (!binding || typeof binding !== 'object') return
      if (typeof binding.componentId !== 'string') return
      if (typeof binding.surfaceId !== 'string') return
      if (typeof binding.slotId !== 'string') return
      if (typeof binding.nodeId !== 'string') return
      bindings[key] = freezeBinding(binding)
    })
  }
  return Object.freeze({
    version,
    bindings: Object.freeze(bindings),
  })
}

const hydrate = () => {
  if (hasHydrated) return state
  hasHydrated = true
  const storage = getStorage()
  if (!storage) {
    state = defaultState
    return state
  }
  const stored = safeJsonParse(storage.getItem(STORAGE_KEY))
  state = computeState(stored)
  return state
}

const persist = (nextState) => {
  const storage = getStorage()
  if (!storage) return
  storage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      version: nextState.version,
      bindings: nextState.bindings,
    })
  )
}

const emitChange = () => {
  listeners.forEach((listener) => {
    try {
      listener(state)
    } catch (error) {
      console.error('Component binding listener failed', error)
    }
  })
}

const normaliseTarget = (target = {}) => {
  const surfaceId = String(target.surfaceId || '').trim()
  const slotId = String(target.slotId || '').trim()
  const nodeId = String(target.nodeId || '').trim()
  if (!surfaceId || !slotId || !nodeId) {
    throw new Error('Binding target must include surfaceId, slotId, and nodeId')
  }
  return { surfaceId, slotId, nodeId }
}

const getBindingKey = ({ surfaceId, slotId, nodeId }) => `${makeSlotKey(surfaceId, slotId)}::${nodeId}`

const createSnapshot = (component) => {
  if (!component) return null
  return {
    id: component.id,
    label: component.label,
    method: component.method,
    path: component.path,
    capability: component.capability,
  }
}

const updateState = (updater) => {
  const base = hydrate()
  const draft = {
    version: base.version,
    bindings: { ...base.bindings },
  }
  const result = updater(draft)
  if (!result) {
    state = Object.freeze({
      version: draft.version,
      bindings: Object.freeze(draft.bindings),
    })
  } else {
    state = result
  }
  persist(state)
  emitChange()
  return state
}

export const getComponentBindings = () => hydrate()

export const subscribeToComponentBindings = (listener) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const getBindingForTarget = (target) => {
  const normalised = normaliseTarget(target)
  const current = hydrate()
  const key = getBindingKey(normalised)
  return current.bindings[key] || null
}

export const assignComponentBinding = (target, componentId, { metadata, captureSnapshot = true } = {}) => {
  if (typeof componentId !== 'string' || !componentId) {
    throw new Error('componentId must be a non-empty string')
  }
  const normalised = normaliseTarget(target)
  if (!canComponentBindToSlot(componentId, normalised.surfaceId, normalised.slotId)) {
    throw new Error('Component is not compatible with the requested slot')
  }
  const key = getBindingKey(normalised)
  const component = getComponentById(componentId)
  const binding = freezeBinding({
    componentId,
    surfaceId: normalised.surfaceId,
    slotId: normalised.slotId,
    nodeId: normalised.nodeId,
    assignedAt: new Date().toISOString(),
    metadata: metadata && typeof metadata === 'object' ? { ...metadata } : undefined,
    componentSnapshot: captureSnapshot ? createSnapshot(component) : undefined,
  })

  return updateState((draft) => {
    draft.version += 1
    draft.bindings[key] = binding
    return Object.freeze({
      version: draft.version,
      bindings: Object.freeze({ ...draft.bindings }),
    })
  }).bindings[key]
}

export const clearComponentBinding = (target) => {
  const normalised = normaliseTarget(target)
  const key = getBindingKey(normalised)
  const current = hydrate()
  if (!current.bindings[key]) return false
  updateState((draft) => {
    if (!draft.bindings[key]) return draft
    draft.version += 1
    delete draft.bindings[key]
    return Object.freeze({
      version: draft.version,
      bindings: Object.freeze({ ...draft.bindings }),
    })
  })
  return true
}

export const clearBindingsForNode = (nodeId) => {
  const trimmed = String(nodeId || '').trim()
  if (!trimmed) return 0
  const current = hydrate()
  const entries = Object.entries(current.bindings)
  if (entries.length === 0) return 0
  let removed = 0
  updateState((draft) => {
    let didChange = false
    Object.entries(draft.bindings).forEach(([key, binding]) => {
      if (binding.nodeId === trimmed) {
        delete draft.bindings[key]
        removed += 1
        didChange = true
      }
    })
    if (!didChange) return draft
    draft.version += 1
    return Object.freeze({
      version: draft.version,
      bindings: Object.freeze({ ...draft.bindings }),
    })
  })
  return removed
}

export const exportComponentBindings = () => {
  const current = hydrate()
  return {
    version: current.version,
    bindings: current.bindings,
  }
}

export const resetComponentBindings = () => {
  state = defaultState
  persist(state)
  emitChange()
}

export const buildBindingKey = (target) => {
  const normalised = normaliseTarget(target)
  return getBindingKey(normalised)
}
