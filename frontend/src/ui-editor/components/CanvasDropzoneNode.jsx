import { useDrag } from '../lib/simpleDnd'
import { DND_ITEM_TYPES } from '../lib/dnd'

export default function CanvasDropzoneNode({ node, zoneId, isPreview = false }) {
  const [{ isDragging }, dragRef] = useDrag(() => ({
    type: DND_ITEM_TYPES.CANVAS_NODE,
    item: { nodeId: node.id, originZoneId: zoneId },
    canDrag: () => !isPreview,
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  }))

  const classes = [
    'canvas-workspace__dropzone-item',
    isPreview ? 'is-preview' : '',
    isDragging ? 'is-dragging' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const meta = node.previewMeta || node.meta

  return (
    <div ref={isPreview ? undefined : dragRef} className={classes} aria-disabled={isPreview}>
      {node.icon ? (
        <span className="canvas-workspace__dropzone-item-icon" aria-hidden="true">
          {node.icon}
        </span>
      ) : null}
      <div className="canvas-workspace__dropzone-item-text">
        <span className="canvas-workspace__dropzone-item-label">{node.label}</span>
        {meta ? <span className="canvas-workspace__dropzone-item-meta">{meta}</span> : null}
      </div>
      {node.badge ? <span className="canvas-workspace__dropzone-item-badge">{node.badge}</span> : null}
    </div>
  )
}

