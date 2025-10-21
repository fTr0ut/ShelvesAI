import { Fragment, createElement, useCallback, useMemo } from 'react'
import { useDrag, useDrop } from '../lib/simpleDnd'
import { DND_ITEM_TYPES } from '../lib/dnd'
import { getCanvasNodeDisplayName } from '../lib/canvasState'

const dropAccepts = [DND_ITEM_TYPES.LIBRARY_ENTRY, DND_ITEM_TYPES.CANVAS_NODE]

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const collectChildIds = (node) => {
  if (!node) {
    return { defaultChildren: [], slotChildren: [] }
  }
  const defaultChildren = Array.isArray(node.childIds) ? [...node.childIds] : []
  const slotChildren = []
  if (node.slotChildIds && typeof node.slotChildIds === 'object') {
    Object.entries(node.slotChildIds).forEach(([slotName, childIds]) => {
      if (Array.isArray(childIds)) {
        slotChildren.push({ slot: slotName, childIds: [...childIds] })
      }
    })
  }
  return { defaultChildren, slotChildren }
}

const buildElementClassName = (nodeType = '', additional = '') => {
  const type = String(nodeType || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-')
  const classes = ['canvas-workspace__element']
  if (type) {
    classes.push(`canvas-workspace__element--${type}`)
  }
  if (additional) {
    classes.push(additional)
  }
  return classes.join(' ')
}

const filterElementProps = (props = {}) => {
  if (!isPlainObject(props)) {
    return { className: '', otherProps: {} }
  }
  const otherProps = {}
  let className = ''
  Object.entries(props).forEach(([key, value]) => {
    if (key === 'children' || key === 'style') {
      return
    }
    if (key === 'className' && typeof value === 'string') {
      className = value
      return
    }
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      value === null
    ) {
      otherProps[key] = value
    }
  })
  return { className, otherProps }
}

const mergeNodeStyles = (node) => {
  const merged = {}
  if (isPlainObject(node?.style)) {
    Object.assign(merged, node.style)
  }
  if (isPlainObject(node?.styles)) {
    Object.assign(merged, node.styles)
  }
  return merged
}

const getNodeTextContent = (node) => {
  if (!node) return ''
  const props = isPlainObject(node?.props) ? node.props : {}
  const candidates = [
    props.text,
    props.heading,
    props.title,
    props.label,
    props.content,
    node.label,
  ]
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }
  return ''
}

const doesNodeContain = (state, nodeId, candidateId) => {
  if (!nodeId || !candidateId || !state.nodes[nodeId]) {
    return false
  }
  if (nodeId === candidateId) {
    return true
  }
  const visited = new Set()
  const queue = [nodeId]
  while (queue.length) {
    const currentId = queue.shift()
    if (visited.has(currentId)) {
      continue
    }
    visited.add(currentId)
    if (currentId === candidateId) {
      return true
    }
    const current = state.nodes[currentId]
    if (!current) {
      continue
    }
    if (Array.isArray(current.childIds)) {
      current.childIds.forEach((childId) => {
        if (!visited.has(childId)) {
          queue.push(childId)
        }
      })
    }
    if (current.slotChildIds && typeof current.slotChildIds === 'object') {
      Object.values(current.slotChildIds).forEach((childIds) => {
        if (Array.isArray(childIds)) {
          childIds.forEach((childId) => {
            if (!visited.has(childId)) {
              queue.push(childId)
            }
          })
        }
      })
    }
  }
  return false
}

const getSiblingIds = (state, parentId, slotName) => {
  if (!parentId) {
    return state.rootIds || []
  }
  const parent = state.nodes[parentId]
  if (!parent) {
    return []
  }
  if (slotName) {
    return Array.isArray(parent.slotChildIds?.[slotName]) ? parent.slotChildIds[slotName] : []
  }
  return Array.isArray(parent.childIds) ? parent.childIds : []
}

const canDropOnTarget = (state, item, target) => {
  if (!item) {
    return false
  }
  if (item.nodeId) {
    const movingNode = state.nodes[item.nodeId]
    if (!movingNode) {
      return false
    }
    const { parentId, slot: currentSlot = null } = movingNode
    const targetParentId = target.parentId || null
    const targetSlot = target.slot || null
    if (targetParentId && doesNodeContain(state, item.nodeId, targetParentId)) {
      return false
    }
    if (targetParentId === item.nodeId) {
      return false
    }
    if (parentId === targetParentId && currentSlot === targetSlot) {
      const siblings = getSiblingIds(state, parentId, currentSlot)
      const currentIndex = siblings.indexOf(item.nodeId)
      if (currentIndex !== -1) {
        if (target.index === currentIndex || target.index === currentIndex + 1) {
          return false
        }
      }
    }
    return true
  }
  return true
}

const guessElementTag = (node) => {
  if (!node) {
    return 'div'
  }
  if (node.as && typeof node.as === 'string') {
    return node.as
  }
  const type = String(node.type || '').toLowerCase()
  if (type.includes('button')) return 'button'
  if (type === 'heading' || type === 'title') return 'h2'
  if (type === 'text' || type === 'paragraph') return 'p'
  if (type === 'image' || type === 'img') return 'img'
  if (type === 'link') return 'a'
  if (type === 'form') return 'form'
  if (type === 'input' || type.includes('field')) return 'div'
  return 'div'
}

const renderPrimitiveContent = (node) => {
  const metadata = isPlainObject(node?.metadata) ? node.metadata : {}
  const primitiveId = metadata.primitiveId
  const props = isPlainObject(node?.props) ? node.props : {}
  switch (primitiveId) {
    case 'page-section':
      return [
        <span key="eyebrow" className="canvas-workspace__primitive-eyebrow">
          {props.eyebrow || 'Section'}
        </span>,
        <h2 key="heading" className="canvas-workspace__primitive-heading">
          {props.heading || getNodeTextContent(node) || 'Section heading'}
        </h2>,
        <p key="body" className="canvas-workspace__primitive-body">
          {props.description || 'Use this area to describe the intent of this section before adding nested components.'}
        </p>,
        <button key="cta" type="button" className="canvas-workspace__primitive-button">
          {props.ctaLabel || 'Primary action'}
        </button>,
      ]
    case 'form':
      return [
        <h3 key="heading" className="canvas-workspace__primitive-heading">
          {props.heading || 'Form title'}
        </h3>,
        <p key="description" className="canvas-workspace__primitive-body">
          {props.description || 'Collect structured input before handing off to an automation pipeline.'}
        </p>,
        <label key="field" className="canvas-workspace__primitive-label">
          {props.fieldLabel || 'Email address'}
          <input
            className="canvas-workspace__primitive-input"
            placeholder={props.fieldPlaceholder || 'name@example.com'}
          />
        </label>,
        <button key="submit" type="submit" className="canvas-workspace__primitive-button">
          {props.submitLabel || 'Submit'}
        </button>,
      ]
    case 'columns':
    case 'responsive-columns':
      return [
        <div key="col-1" className="canvas-workspace__primitive-column">
          <h4>{props.columnOneHeading || 'Primary column'}</h4>
          <p>{props.columnOneBody || 'Drop components into this column to continue composing the layout.'}</p>
        </div>,
        <div key="col-2" className="canvas-workspace__primitive-column">
          <h4>{props.columnTwoHeading || 'Secondary column'}</h4>
          <p>{props.columnTwoBody || 'Use this area for supporting content, media, or automation hooks.'}</p>
        </div>,
      ]
    case 'grid':
      return new Array(3).fill(null).map((_, index) => (
        <div key={`grid-${index}`} className="canvas-workspace__primitive-grid-item">
          <strong>Grid item {index + 1}</strong>
          <p>Compose a reusable block before duplicating across this responsive grid.</p>
        </div>
      ))
    case 'horizontal-stack':
    case 'vertical-stack':
      return [
        <div key="item-1" className="canvas-workspace__primitive-stack-item">
          <strong>Stack item</strong>
          <p>Stacks help orchestrate consistent spacing for grouped content.</p>
        </div>,
        <div key="item-2" className="canvas-workspace__primitive-stack-item">
          <strong>Another item</strong>
          <p>Drag real components into this structure to replace placeholder content.</p>
        </div>,
      ]
    case 'button':
      return [props.label || 'Primary action']
    case 'text-field':
      return [
        <label key="label" className="canvas-workspace__primitive-label">
          {props.label || 'Input label'}
          <input
            className="canvas-workspace__primitive-input"
            placeholder={props.placeholder || 'Describe the expected value'}
          />
        </label>,
      ]
    case 'link-container':
      return [
        <span key="label" className="canvas-workspace__primitive-heading">
          {props.heading || 'Linked container'}
        </span>,
        <p key="body" className="canvas-workspace__primitive-body">
          {props.description || 'This wrapper turns nested components into a unified interaction target.'}
        </p>,
      ]
    case 'free-box':
      return [
        <p key="body" className="canvas-workspace__primitive-body">
          {props.description || 'Use this freeform region to layer media, typography, and components with custom positioning.'}
        </p>,
      ]
    default:
      return null
  }
}

const buildNodeChildren = (node, childContent) => {
  const primitiveContent = renderPrimitiveContent(node)
  const children = []
  if (primitiveContent && primitiveContent.length) {
    primitiveContent.forEach((entry, index) => {
      children.push(
        <div key={`primitive-${index}`} className="canvas-workspace__primitive-block">
          {entry}
        </div>,
      )
    })
  }
  if (childContent.length) {
    childContent.forEach((child) => children.push(child))
  } else if (!primitiveContent || primitiveContent.length === 0) {
    const textContent = getNodeTextContent(node)
    if (textContent) {
      children.push(
        <p key="text" className="canvas-workspace__primitive-body">
          {textContent}
        </p>,
      )
    }
  }
  if (!children.length) {
    children.push(
      <p key="placeholder" className="canvas-workspace__primitive-placeholder">
        Drop components here to continue composing this block.
      </p>,
    )
  }
  return children
}

function CanvasInsertionZone({
  parentId,
  slot,
  index,
  onInsert,
  canDropItem,
  label,
  isEmpty = false,
}) {
  const [{ isOver, canDrop }, dropRef] = useDrop(() => ({
    accept: dropAccepts,
    canDrop: (item) => canDropItem(item, { parentId, slot, index }),
    drop: (item) => {
      if (canDropItem(item, { parentId, slot, index })) {
        onInsert({ parentId, slot, index }, item)
      }
    },
    collect: (monitor) => ({
      isOver: monitor.isOver(),
      canDrop: monitor.canDrop(),
    }),
  }))

  const message = useMemo(() => {
    if (!isOver) {
      return 'Drop component here'
    }
    return canDrop ? 'Release to drop' : 'Cannot drop here'
  }, [canDrop, isOver])

  return (
    <div
      ref={dropRef}
      className={`canvas-workspace__insertion${isEmpty ? ' canvas-workspace__insertion--empty' : ''}`}
      data-active={isOver && canDrop ? 'true' : undefined}
      data-blocked={isOver && !canDrop ? 'true' : undefined}
      role="presentation"
      aria-label={label || 'Insert position'}
      onClick={(event) => event.stopPropagation()}
    >
      <span className="canvas-workspace__insertion-line" aria-hidden="true" />
      {isEmpty ? <span className="canvas-workspace__insertion-label">{message}</span> : null}
    </div>
  )
}

function CanvasNode({
  nodeId,
  canvasState,
  onInsert,
  onSelect,
  canDropItem,
  selectionId,
}) {
  const node = canvasState.nodes[nodeId]
  if (!node) {
    return null
  }
  const displayName = getCanvasNodeDisplayName(node)
  const [{ isDragging }, dragRef] = useDrag(() => ({
    type: DND_ITEM_TYPES.CANVAS_NODE,
    item: { nodeId },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  }))

  const { defaultChildren, slotChildren } = useMemo(
    () => collectChildIds(node),
    [node],
  )

  const buildChildCollection = useCallback(
    (childIds, slotName) => {
      const elements = []
      const isEmpty = childIds.length === 0
      elements.push(
        <CanvasInsertionZone
          key={`${nodeId}-${slotName || 'default'}-start`}
          parentId={nodeId}
          slot={slotName}
          index={0}
          onInsert={onInsert}
          canDropItem={canDropItem}
          isEmpty={isEmpty}
          label={slotName ? `Insert into ${slotName}` : `Insert into ${displayName}`}
        />,
      )
      childIds.forEach((childId, childIndex) => {
        elements.push(
          <CanvasNode
            key={childId}
            nodeId={childId}
            canvasState={canvasState}
            onInsert={onInsert}
            onSelect={onSelect}
            canDropItem={canDropItem}
            selectionId={selectionId}
          />,
        )
        elements.push(
          <CanvasInsertionZone
            key={`${nodeId}-${slotName || 'default'}-${childId}-after`}
            parentId={nodeId}
            slot={slotName}
            index={childIndex + 1}
            onInsert={onInsert}
            canDropItem={canDropItem}
            label={slotName ? `Insert into ${slotName}` : `Insert into ${displayName}`}
          />,
        )
      })
      return elements
    },
    [canvasState, canDropItem, displayName, nodeId, onInsert, onSelect, selectionId],
  )

  const childContent = useMemo(() => {
    const sections = []
    if (defaultChildren.length) {
      sections.push(...buildChildCollection(defaultChildren, null))
    } else {
      sections.push(
        <CanvasInsertionZone
          key={`${nodeId}-default-empty`}
          parentId={nodeId}
          slot={null}
          index={0}
          onInsert={onInsert}
          canDropItem={canDropItem}
          isEmpty
          label={`Insert into ${displayName}`}
        />,
      )
    }
    slotChildren.forEach(({ slot, childIds }) => {
      sections.push(
        <div key={`${nodeId}-slot-${slot}`} className="canvas-workspace__slot">
          <span className="canvas-workspace__slot-label">{slot}</span>
          <div className="canvas-workspace__slot-body">
            {buildChildCollection(childIds, slot)}
          </div>
        </div>,
      )
    })
    return sections
  }, [buildChildCollection, canDropItem, defaultChildren, displayName, nodeId, onInsert, slotChildren])

  const handleClick = useCallback(
    (event) => {
      event.stopPropagation()
      onSelect(nodeId)
    },
    [nodeId, onSelect],
  )

  const elementTag = guessElementTag(node)
  const { className: nodeClassName, otherProps } = filterElementProps(node?.props)
  const mergedStyle = mergeNodeStyles(node)
  const elementChildren = buildNodeChildren(node, childContent)
  const element = createElement(
    elementTag,
    {
      ...otherProps,
      className: buildElementClassName(node?.type, nodeClassName),
      style: mergedStyle,
      'data-node-id': nodeId,
    },
    ...elementChildren,
  )

  return (
    <div
      className="canvas-workspace__node"
      data-selected={selectionId === nodeId ? 'true' : undefined}
      data-dragging={isDragging ? 'true' : undefined}
      onClick={handleClick}
    >
      <button
        type="button"
        className="canvas-workspace__node-handle"
        ref={dragRef}
        aria-label={`Drag ${displayName}`}
        onClick={(event) => event.stopPropagation()}
      >
        ⋮⋮
      </button>
      <div className="canvas-workspace__node-content">{element}</div>
    </div>
  )
}

export default function LiveCanvas({ canvasState, onInsert, onSelect }) {
  const safeState = useMemo(() => {
    if (!canvasState || typeof canvasState !== 'object') {
      return { rootIds: [], nodes: {}, selectionId: null }
    }
    return {
      rootIds: Array.isArray(canvasState.rootIds) ? canvasState.rootIds : [],
      nodes: canvasState.nodes || {},
      selectionId: canvasState.selectionId || null,
    }
  }, [canvasState])

  const canDropItem = useCallback(
    (item, target) => canDropOnTarget(safeState, item, target),
    [safeState],
  )

  const rootInsertion = (
    <CanvasInsertionZone
      key="root-start"
      parentId={null}
      slot={null}
      index={0}
      onInsert={onInsert}
      canDropItem={canDropItem}
      isEmpty={safeState.rootIds.length === 0}
      label="Insert at start of canvas"
    />
  )

  return (
    <div className="canvas-workspace__surface" role="presentation">
      {rootInsertion}
      {safeState.rootIds.map((nodeId, index) => (
        <Fragment key={nodeId}>
          <CanvasNode
            nodeId={nodeId}
            canvasState={safeState}
            onInsert={onInsert}
            onSelect={onSelect}
            canDropItem={canDropItem}
            selectionId={safeState.selectionId}
          />
          <CanvasInsertionZone
            parentId={null}
            slot={null}
            index={index + 1}
            onInsert={onInsert}
            canDropItem={canDropItem}
            label="Insert on canvas"
          />
        </Fragment>
      ))}
    </div>
  )
}
