import { useMemo } from 'react'
import { useDrop } from '../lib/simpleDnd'
import CanvasDropzoneNode from './CanvasDropzoneNode'
import { DND_ITEM_TYPES, LIBRARY_ENTRY_KINDS } from '../lib/dnd'

const dropAccepts = [DND_ITEM_TYPES.LIBRARY_ENTRY, DND_ITEM_TYPES.CANVAS_NODE]

export default function CanvasDropzone({
  blueprint,
  allNodes,
  nodes,
  onDropItem,
  placeholder,
  activeComponent,
  activeComponentStyle,
}) {
  const [{ isOver, canDrop, item: draggingItem }, dropRef] = useDrop(() => ({
    accept: dropAccepts,
    drop: (item) => {
      onDropItem(blueprint.id, item)
      return { zoneId: blueprint.id }
    },
    collect: (monitor) => ({
      isOver: monitor.isOver(),
      canDrop: monitor.canDrop(),
      item: monitor.getItem(),
    }),
  }))

  const previewNode = useMemo(() => {
    if (!isOver || !canDrop || !draggingItem) {
      return null
    }

    if (draggingItem.entryType === LIBRARY_ENTRY_KINDS.PRIMITIVE && draggingItem.primitive) {
      const { primitive } = draggingItem
      return {
        id: `preview-${primitive.id}`,
        label: primitive.label,
        meta: primitive.description,
        icon: primitive.icon,
        badge: 'Primitive',
        isPreview: true,
      }
    }

    if (draggingItem.nodeId) {
      const originNodes = allNodes[draggingItem.originZoneId] || []
      const existing = originNodes.find((node) => node.id === draggingItem.nodeId)
      if (existing) {
        return {
          ...existing,
          id: `preview-${existing.id}`,
          isPreview: true,
          previewMeta:
            draggingItem.originZoneId === blueprint.id
              ? 'Reorder in this section'
              : 'Move existing block',
        }
      }
    }

    return null
  }, [allNodes, blueprint.id, canDrop, draggingItem, isOver])

  const dropTargetLabel = useMemo(() => {
    if (isOver) {
      if (!canDrop) {
        return 'Cannot drop here'
      }
      if (previewNode) {
        return `Release to place ${previewNode.label}`
      }
      return 'Release to drop'
    }
    return 'Drop component here'
  }, [isOver, canDrop, previewNode])

  const targetClasses = [
    'canvas-workspace__dropzone-target',
    isOver && canDrop ? 'is-active' : '',
    isOver && !canDrop ? 'is-blocked' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const hasNodes = nodes.length > 0
  const shouldShowActivePreview = Boolean(activeComponent) && !hasNodes && !previewNode

  return (
    <section ref={dropRef} className={`canvas-workspace__dropzone${isOver && canDrop ? ' is-hovered' : ''}`} aria-label={`${blueprint.title} drop zone`}>
      <div className="canvas-workspace__dropzone-header">
        <div>
          <h3>{blueprint.title}</h3>
          <p>{blueprint.description}</p>
        </div>
        <button type="button" className="canvas-workspace__dropzone-action">
          {blueprint.actionLabel}
        </button>
      </div>
      <div className={targetClasses} role="button" tabIndex={0}>
        <span className="canvas-workspace__dropzone-icon" aria-hidden="true">
          +
        </span>
        <span className="canvas-workspace__dropzone-hint">{dropTargetLabel}</span>
      </div>
      <div className="canvas-workspace__dropzone-preview">
        {hasNodes || previewNode ? (
          <div className="canvas-workspace__dropzone-items">
            {nodes.map((node) => (
              <CanvasDropzoneNode key={node.id} node={node} zoneId={blueprint.id} />
            ))}
            {previewNode ? (
              <CanvasDropzoneNode node={previewNode} zoneId={blueprint.id} isPreview />
            ) : null}
          </div>
        ) : shouldShowActivePreview ? (
          <div className="canvas-workspace__component-preview" style={activeComponentStyle}>
            <span className="canvas-workspace__component-preview-label">{activeComponent.label}</span>
            <span className="canvas-workspace__component-preview-meta">{activeComponent.type} • Active</span>
          </div>
        ) : (
          <p className="canvas-workspace__dropzone-placeholder">{placeholder}</p>
        )}
      </div>
    </section>
  )
}

