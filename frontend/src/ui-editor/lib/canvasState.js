const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const cloneForState = (value) => {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneForState(entry))
  }
  if (isPlainObject(value)) {
    const result = {}
    Object.keys(value).forEach((key) => {
      result[key] = cloneForState(value[key])
    })
    return result
  }
  return value
}

const normaliseString = (value, { fallback = '' } = {}) => {
  if (typeof value !== 'string') {
    return fallback
  }
  const trimmed = value.trim()
  return trimmed || fallback
}

const normaliseOptionalString = (value) => {
  if (value === undefined || value === null) {
    return null
  }
  const trimmed = normaliseString(value)
  return trimmed || null
}

const normaliseBoolean = (value, fallback = true) => {
  if (value === undefined) {
    return fallback
  }
  return Boolean(value)
}

const normaliseNumber = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return null
}

const normaliseNode = (rawNode, { parentId = null, parentSlot = null } = {}) => {
  if (!isPlainObject(rawNode)) {
    return null
  }

  const id = normaliseString(rawNode.id)
  if (!id) {
    return null
  }

  const type = normaliseString(rawNode.type, { fallback: 'node' })
  const label = normaliseString(rawNode.label)
  const componentId = normaliseOptionalString(rawNode.componentId)
  const variant = normaliseOptionalString(rawNode.variant)
  const as = normaliseOptionalString(rawNode.as)
  const key = normaliseOptionalString(rawNode.key)
  const role = normaliseOptionalString(rawNode.role)
  const order = normaliseNumber(rawNode.order)
  const visible = normaliseBoolean(rawNode.visible, true)

  const styleSource = isPlainObject(rawNode.style)
    ? rawNode.style
    : isPlainObject(rawNode.styles)
    ? rawNode.styles
    : {}
  const styles = cloneForState(styleSource)

  const node = {
    id,
    type,
    label,
    componentId,
    variant,
    as,
    key,
    role,
    order,
    visible,
    parentId: parentId || null,
    parentSlot: parentSlot || null,
    slot: parentSlot || null,
    props: cloneForState(isPlainObject(rawNode.props) ? rawNode.props : {}),
    bindings: cloneForState(isPlainObject(rawNode.bindings) ? rawNode.bindings : {}),
    metadata: cloneForState(isPlainObject(rawNode.metadata) ? rawNode.metadata : {}),
    layout: cloneForState(isPlainObject(rawNode.layout) ? rawNode.layout : {}),
    data: cloneForState(isPlainObject(rawNode.data) ? rawNode.data : {}),
    state: cloneForState(isPlainObject(rawNode.state) ? rawNode.state : {}),
    transitions: cloneForState(isPlainObject(rawNode.transitions) ? rawNode.transitions : {}),
    style: styles,
    styles,
    childIds: [],
    slotChildIds: {},
  }

  return node
}

const cloneNodeForMutation = (node) => ({
  ...node,
  childIds: [...node.childIds],
  slotChildIds: Object.fromEntries(
    Object.entries(node.slotChildIds || {}).map(([slotName, childIds]) => [slotName, [...childIds]]),
  ),
})

const computeInsertionIndex = (length, index) => {
  if (!Number.isInteger(index)) {
    return length
  }
  return Math.max(0, Math.min(length, index))
}

const flattenSlotChildren = (node) => {
  const result = []
  if (!node || !node.slotChildIds) {
    return result
  }
  Object.values(node.slotChildIds).forEach((children) => {
    children.forEach((childId) => {
      result.push(childId)
    })
  })
  return result
}

const deriveInitialSelectionId = (state) => {
  const visit = (nodeIds, predicate, seen = new Set()) => {
    for (const nodeId of nodeIds) {
      if (seen.has(nodeId)) continue
      seen.add(nodeId)
      const node = state.nodes[nodeId]
      if (!node) continue
      if (predicate(node)) {
        return nodeId
      }
      const childCandidates = [...node.childIds, ...flattenSlotChildren(node)]
      const match = visit(childCandidates, predicate, seen)
      if (match) {
        return match
      }
    }
    return null
  }

  const primary = visit(state.rootIds, (node) => Boolean(node.componentId))
  if (primary) {
    return primary
  }
  return visit(state.rootIds, () => true)
}

export const createEmptyCanvasState = () => ({
  rootIds: [],
  nodes: {},
  selectionId: null,
})

export const createCanvasStateFromNodes = (nodes = []) => {
  const state = createEmptyCanvasState()

  const appendChild = (parentId, slotName, childId) => {
    if (!parentId) {
      state.rootIds.push(childId)
      return
    }
    const parent = state.nodes[parentId]
    if (!parent) {
      state.rootIds.push(childId)
      return
    }
    if (slotName) {
      if (!parent.slotChildIds[slotName]) {
        parent.slotChildIds[slotName] = []
      }
      parent.slotChildIds[slotName].push(childId)
    } else {
      parent.childIds.push(childId)
    }
  }

  const traverse = (list, parentId = null, slotName = null) => {
    if (!Array.isArray(list)) {
      return
    }
    list.forEach((rawNode) => {
      const node = normaliseNode(rawNode, { parentId, parentSlot: slotName })
      if (!node || state.nodes[node.id]) {
        return
      }
      state.nodes[node.id] = node
      appendChild(parentId, slotName, node.id)

      if (Array.isArray(rawNode?.children)) {
        traverse(rawNode.children, node.id, null)
      }
      if (isPlainObject(rawNode?.slots)) {
        Object.entries(rawNode.slots).forEach(([childSlot, slotChildren]) => {
          if (Array.isArray(slotChildren)) {
            traverse(slotChildren, node.id, normaliseString(childSlot))
          }
        })
      }
    })
  }

  traverse(Array.isArray(nodes) ? nodes : [], null, null)
  state.selectionId = deriveInitialSelectionId(state)
  return state
}

export const selectCanvasNode = (state, nodeId) => {
  const nextSelection = nodeId && state.nodes[nodeId] ? nodeId : null
  if (state.selectionId === nextSelection) {
    return state
  }
  return {
    ...state,
    selectionId: nextSelection,
  }
}

const mergeNodePatch = (target, patch) => {
  if (!patch || typeof patch !== 'object') {
    return target
  }

  const next = { ...target }
  let changed = false

  const assign = (field, transform = (value) => value) => {
    if (!Object.prototype.hasOwnProperty.call(patch, field)) {
      return
    }
    const nextValue = transform(patch[field])
    if (nextValue === undefined) {
      return
    }
    next[field] = nextValue
    changed = true
  }

  assign('type', (value) => normaliseString(value, { fallback: target.type }))
  assign('label', (value) => normaliseString(value))
  assign('componentId', normaliseOptionalString)
  assign('variant', normaliseOptionalString)
  assign('as', normaliseOptionalString)
  assign('key', normaliseOptionalString)
  assign('role', normaliseOptionalString)
  assign('order', normaliseNumber)
  assign('visible', (value) => normaliseBoolean(value, target.visible))
  assign('props', (value) => cloneForState(isPlainObject(value) ? value : {}))
  assign('bindings', (value) => cloneForState(isPlainObject(value) ? value : {}))
  assign('metadata', (value) => cloneForState(isPlainObject(value) ? value : {}))
  assign('layout', (value) => cloneForState(isPlainObject(value) ? value : {}))
  assign('data', (value) => cloneForState(isPlainObject(value) ? value : {}))
  assign('state', (value) => cloneForState(isPlainObject(value) ? value : {}))
  assign('transitions', (value) => cloneForState(isPlainObject(value) ? value : {}))
  assign('styles', (value) => {
    const result = cloneForState(isPlainObject(value) ? value : {})
    next.style = result
    return result
  })
  assign('style', (value) => {
    const result = cloneForState(isPlainObject(value) ? value : {})
    next.styles = result
    return result
  })

  if (!changed) {
    return target
  }

  return next
}

export const updateCanvasNode = (state, patch) => {
  const nodeId = patch?.id
  if (!nodeId || !state.nodes[nodeId]) {
    return state
  }
  const current = state.nodes[nodeId]
  const nextNode = mergeNodePatch(current, patch)
  if (nextNode === current) {
    return state
  }
  return {
    ...state,
    nodes: {
      ...state.nodes,
      [nodeId]: nextNode,
    },
  }
}

export const insertCanvasNode = (state, rawNode, options = {}) => {
  const parentId = normaliseOptionalString(options.parentId)
  const slotName = normaliseOptionalString(options.slot)
  const index = options.index
  const shouldSelect = Boolean(options.select)

  const node = normaliseNode(rawNode, { parentId, parentSlot: slotName })
  if (!node || state.nodes[node.id]) {
    return state
  }

  let nextNodes = { ...state.nodes, [node.id]: node }
  let nextRootIds = state.rootIds

  if (parentId && state.nodes[parentId]) {
    const parent = cloneNodeForMutation(state.nodes[parentId])
    if (slotName) {
      const existing = parent.slotChildIds[slotName] ? [...parent.slotChildIds[slotName]] : []
      const insertionIndex = computeInsertionIndex(existing.length, index)
      existing.splice(insertionIndex, 0, node.id)
      parent.slotChildIds = {
        ...parent.slotChildIds,
        [slotName]: existing,
      }
    } else {
      const childIds = [...parent.childIds]
      const insertionIndex = computeInsertionIndex(childIds.length, index)
      childIds.splice(insertionIndex, 0, node.id)
      parent.childIds = childIds
    }
    nextNodes[parent.id] = parent
  } else {
    node.parentId = null
    node.parentSlot = null
    node.slot = null
    nextRootIds = [...state.rootIds]
    const insertionIndex = computeInsertionIndex(nextRootIds.length, index)
    nextRootIds.splice(insertionIndex, 0, node.id)
  }

  let nextState = {
    ...state,
    rootIds: nextRootIds,
    nodes: nextNodes,
    selectionId: shouldSelect ? node.id : state.selectionId,
  }

  if (Array.isArray(rawNode?.children)) {
    rawNode.children.forEach((child, childIndex) => {
      nextState = insertCanvasNode(nextState, child, {
        parentId: node.id,
        index: childIndex,
        select: false,
      })
    })
  }

  if (isPlainObject(rawNode?.slots)) {
    Object.entries(rawNode.slots).forEach(([childSlot, slotChildren]) => {
      if (!Array.isArray(slotChildren)) {
        return
      }
      slotChildren.forEach((child, childIndex) => {
        nextState = insertCanvasNode(nextState, child, {
          parentId: node.id,
          slot: childSlot,
          index: childIndex,
          select: false,
        })
      })
    })
  }

  return nextState
}

export const reparentCanvasNode = (state, nodeId, options = {}) => {
  if (!nodeId || !state.nodes[nodeId]) {
    return state
  }

  const target = state.nodes[nodeId]
  const nextParentId = normaliseOptionalString(options.parentId)
  const nextSlot = normaliseOptionalString(options.slot)
  const index = options.index
  const shouldSelect = options.select === undefined ? true : Boolean(options.select)

  let nextNodes = { ...state.nodes }
  let nextRootIds = [...state.rootIds]

  if (target.parentId && nextNodes[target.parentId]) {
    const currentParent = cloneNodeForMutation(nextNodes[target.parentId])
    if (target.parentSlot && currentParent.slotChildIds[target.parentSlot]) {
      const filtered = currentParent.slotChildIds[target.parentSlot].filter((childId) => childId !== nodeId)
      if (filtered.length) {
        currentParent.slotChildIds[target.parentSlot] = filtered
      } else {
        delete currentParent.slotChildIds[target.parentSlot]
      }
    } else {
      currentParent.childIds = currentParent.childIds.filter((childId) => childId !== nodeId)
    }
    nextNodes[currentParent.id] = currentParent
  } else {
    nextRootIds = nextRootIds.filter((id) => id !== nodeId)
  }

  if (nextParentId && nextNodes[nextParentId]) {
    const parent = cloneNodeForMutation(nextNodes[nextParentId])
    if (nextSlot) {
      const existing = parent.slotChildIds[nextSlot] ? [...parent.slotChildIds[nextSlot]] : []
      const insertionIndex = computeInsertionIndex(existing.length, index)
      existing.splice(insertionIndex, 0, nodeId)
      parent.slotChildIds = {
        ...parent.slotChildIds,
        [nextSlot]: existing,
      }
    } else {
      const childIds = [...parent.childIds]
      const insertionIndex = computeInsertionIndex(childIds.length, index)
      childIds.splice(insertionIndex, 0, nodeId)
      parent.childIds = childIds
    }
    nextNodes[parent.id] = parent
    nextNodes[nodeId] = {
      ...target,
      parentId: parent.id,
      parentSlot: nextSlot,
      slot: nextSlot,
    }
  } else {
    const insertionIndex = computeInsertionIndex(nextRootIds.length, index)
    nextRootIds.splice(insertionIndex, 0, nodeId)
    nextNodes[nodeId] = {
      ...target,
      parentId: null,
      parentSlot: null,
      slot: null,
    }
  }

  return {
    ...state,
    rootIds: nextRootIds,
    nodes: nextNodes,
    selectionId: shouldSelect ? nodeId : state.selectionId,
  }
}

export const getCanvasNodeDisplayName = (node) => {
  if (!node) {
    return ''
  }
  if (node.label) {
    return node.label
  }
  const props = isPlainObject(node.props) ? node.props : {}
  const candidates = ['title', 'heading', 'label', 'name', 'id']
  for (const key of candidates) {
    if (typeof props[key] === 'string' && props[key].trim()) {
      return props[key].trim()
    }
  }
  if (node.componentId) {
    return node.componentId
  }
  return node.type
}

export const getCanvasNodeMeta = (node) => {
  if (!node) {
    return ''
  }
  const parts = []
  if (node.type) {
    parts.push(node.type)
  }
  if (node.componentId) {
    parts.push(node.componentId)
  }
  if (node.variant) {
    parts.push(node.variant)
  }
  return parts.join(' • ')
}

export const getCanvasNodeChildren = (state, nodeId) => {
  const node = state.nodes[nodeId]
  if (!node) {
    return []
  }
  const items = []
  node.childIds.forEach((childId) => {
    const child = state.nodes[childId]
    if (child) {
      items.push({ node: child, slot: null })
    }
  })
  Object.entries(node.slotChildIds).forEach(([slotName, childIds]) => {
    childIds.forEach((childId) => {
      const child = state.nodes[childId]
      if (child) {
        items.push({ node: child, slot: slotName })
      }
    })
  })
  return items
}

