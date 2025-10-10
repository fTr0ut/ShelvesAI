import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DndProvider, HTML5Backend, useDrag, useDrop } from '../lib/simpleDnd'
import { fetchJson, getApiOrigin, getDefaultApiOrigin, resolveApiUrl } from '../api/client'
import { publishUiBundle } from '../api/routes'
import {
  createCanvasScreen,
  deleteCanvasScreen,
  fetchCanvasScreens,
  fetchCanvasSettings,
  updateCanvasSettings,
  updateCanvasScreenNodes,
} from '../api/canvas'
import {
  createCanvasStateFromNodes,
  createEmptyCanvasState,
  getCanvasNodeDisplayName,
  getCanvasNodeMeta,
  serialiseCanvasStateToNodes,
  insertCanvasNode,
  reparentCanvasNode,
  selectCanvasNode,
  updateCanvasNode,
} from '../lib/canvasState'
import ComponentLibraryPanel from '../components/ComponentLibraryPanel'
import CanvasScreenSelector from '../components/CanvasScreenSelector'
import PropertiesPanel from '../components/PropertiesPanel'
import { useProjectSettings } from '../lib/useProjectSettings'
import { DND_ITEM_TYPES, LIBRARY_ENTRY_KINDS } from '../lib/dnd'
import './CanvasWorkspace.css'

const defaultStatus = {
  phase: 'idle',
  message: 'Ready to initialise editor.',
  meta: null,
}

const defaultPublishState = {
  status: 'idle',
  message: 'Choose a target to publish the current screen bundle.',
  detail: null,
}

const createDefaultThemeTokens = () => ({
  colorScheme: 'light',
  accentColor: '#60a5fa',
  background: 'soft-gradient',
  surfaceColor: '#0b1120',
  textColor: '#e2e8f0',
})

const createDefaultWorkspacePreferences = () => ({
  headerStyle: 'centered-logo',
  footerStyle: 'minimal',
  showAnnouncement: true,
})

const createDefaultPageStyles = () => ({
  backgroundColor: '#0b1120',
  textColor: '#e2e8f0',
  fontFamily: 'Inter',
  fontSize: 16,
  layout: 'fixed',
  maxWidth: '1200px',
  gridColumns: 12,
  gap: '24px',
  sectionPadding: '80px',
  blockSpacing: '48px',
  borderRadius: '16px',
  elevation: 'soft',
})

const createDefaultWorkspaceSettings = () => ({
  themeTokens: createDefaultThemeTokens(),
  workspace: createDefaultWorkspacePreferences(),
  pageStyles: createDefaultPageStyles(),
})

const coerceWorkspaceSettings = (raw) => {
  if (!raw || typeof raw !== 'object') {
    return createDefaultWorkspaceSettings()
  }

  const defaults = createDefaultWorkspaceSettings()
  const themeTokens = {
    ...defaults.themeTokens,
    ...(raw.themeTokens && typeof raw.themeTokens === 'object' ? raw.themeTokens : {}),
  }
  const workspace = {
    ...defaults.workspace,
    ...(raw.workspace && typeof raw.workspace === 'object' ? raw.workspace : {}),
  }
  const pageStyles = {
    ...defaults.pageStyles,
    ...(raw.pageStyles && typeof raw.pageStyles === 'object' ? raw.pageStyles : {}),
  }

  const parsedFontSize = Number.parseFloat(pageStyles.fontSize)
  if (Number.isFinite(parsedFontSize)) {
    pageStyles.fontSize = parsedFontSize
  } else {
    pageStyles.fontSize = defaults.pageStyles.fontSize
  }

  return {
    themeTokens,
    workspace: {
      ...workspace,
      showAnnouncement: Boolean(workspace.showAnnouncement),
    },
    pageStyles,
  }
}

const mergeWorkspaceSettings = (base, patch = {}) => {
  const startingPoint = coerceWorkspaceSettings(base)
  if (!patch || typeof patch !== 'object') {
    return startingPoint
  }

  const next = {
    themeTokens: { ...startingPoint.themeTokens },
    workspace: { ...startingPoint.workspace },
    pageStyles: { ...startingPoint.pageStyles },
  }

  if (patch.themeTokens && typeof patch.themeTokens === 'object') {
    next.themeTokens = coerceWorkspaceSettings({ themeTokens: patch.themeTokens }).themeTokens
  }

  if (patch.workspace && typeof patch.workspace === 'object') {
    next.workspace = {
      ...next.workspace,
      ...patch.workspace,
      showAnnouncement: patch.workspace.showAnnouncement !== undefined
        ? Boolean(patch.workspace.showAnnouncement)
        : next.workspace.showAnnouncement,
    }
  }

  if (patch.pageStyles && typeof patch.pageStyles === 'object') {
    next.pageStyles = coerceWorkspaceSettings({ pageStyles: patch.pageStyles }).pageStyles
  }

  return next
}

const layoutPrimitives = [
  {
    id: 'primitive-stack',
    label: 'Stack',
    description: 'Vertical spacing system for hero copy or onboarding journeys.',
    badge: 'Layout',
  },
  {
    id: 'primitive-grid',
    label: 'Responsive grid',
    description: 'Multi-column scaffold mapped to the workspace grid tokens.',
    badge: `${createDefaultPageStyles().gridColumns}-col`,
  },
  {
    id: 'primitive-rail',
    label: 'Right rail',
    description: 'Secondary column for automation, filters or key actions.',
    badge: 'Add-on',
  },
  {
    id: 'primitive-zone',
    label: 'Freeform zone',
    description: 'Absolute positioning surface for immersive hero compositions.',
    badge: 'Canvas',
  },
]

const primitiveStyleBase = Object.freeze({
  backgroundColor: 'rgba(15, 23, 42, 0.62)',
  border: '1px solid rgba(148, 163, 184, 0.28)',
  borderRadius: '18px',
  padding: '28px',
  display: 'flex',
  flexDirection: 'column',
  gap: '18px',
  position: 'relative',
  boxShadow: '0 28px 48px rgba(15, 23, 42, 0.28)',
})

const createPrimitiveNode = (primitive) => {
  if (!primitive) {
    return null
  }
  const id = createCanvasNodeId(primitive.id || 'primitive')
  const metadata = {
    primitiveId: primitive.id || 'primitive',
    source: LIBRARY_ENTRY_KINDS.PRIMITIVE,
    description: primitive.description || '',
  }

  const baseStyles = { ...primitiveStyleBase }

  switch (primitive.id) {
    case 'form':
      return {
        id,
        type: 'form',
        label: primitive.label || 'Form',
        metadata,
        props: {
          heading: 'Lead capture form',
          description: 'Collect structured input with validation and automation handoff.',
          fieldLabel: 'Email address',
          fieldPlaceholder: 'name@example.com',
          submitLabel: 'Submit',
        },
        styles: { ...baseStyles, display: 'grid', gap: '18px' },
      }
    case 'columns':
      return {
        id,
        type: 'layout',
        label: primitive.label || 'Columns',
        metadata,
        props: {
          columnOneHeading: 'Primary column',
          columnTwoHeading: 'Secondary column',
        },
        styles: {
          ...baseStyles,
          display: 'grid',
          gap: '24px',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
        },
      }
    case 'responsive-columns':
      return {
        id,
        type: 'layout',
        label: primitive.label || 'Responsive columns',
        metadata,
        props: {
          columnOneHeading: 'Left column',
          columnTwoHeading: 'Right column',
        },
        styles: {
          ...baseStyles,
          display: 'grid',
          gap: '20px',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        },
      }
    case 'grid':
      return {
        id,
        type: 'grid',
        label: primitive.label || 'Grid',
        metadata,
        props: {},
        styles: {
          ...baseStyles,
          display: 'grid',
          gap: '20px',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        },
      }
    case 'horizontal-stack':
      return {
        id,
        type: 'stack',
        label: primitive.label || 'Horizontal stack',
        metadata,
        props: {},
        styles: {
          ...baseStyles,
          flexDirection: 'row',
          alignItems: 'stretch',
          gap: '20px',
        },
      }
    case 'vertical-stack':
      return {
        id,
        type: 'stack',
        label: primitive.label || 'Vertical stack',
        metadata,
        props: {},
        styles: { ...baseStyles, flexDirection: 'column' },
      }
    case 'page-section':
      return {
        id,
        type: 'section',
        as: 'section',
        label: primitive.label || 'Page section',
        metadata,
        props: {
          eyebrow: 'Featured',
          heading: 'Compose a compelling section headline',
          description: 'Use nested components to expand this story and guide the visitor toward action.',
          ctaLabel: 'Explore more',
        },
        styles: { ...baseStyles },
      }
    case 'button':
      return {
        id,
        type: 'button',
        as: 'button',
        label: primitive.label || 'Button',
        metadata,
        props: {
          label: primitive.label || 'Primary action',
        },
        styles: {
          backgroundColor: '#2563eb',
          color: '#f8fafc',
          border: 'none',
          borderRadius: '999px',
          padding: '14px 28px',
          fontWeight: '600',
          fontSize: '1rem',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.5rem',
          boxShadow: '0 20px 44px rgba(37, 99, 235, 0.35)',
          cursor: 'pointer',
        },
      }
    case 'text-field':
      return {
        id,
        type: 'input',
        label: primitive.label || 'Text field',
        metadata,
        props: {
          label: 'Input label',
          placeholder: 'Describe the expected value',
        },
        styles: { ...baseStyles },
      }
    case 'link-container':
      return {
        id,
        type: 'link-container',
        label: primitive.label || 'Link container',
        metadata,
        props: {
          heading: 'Link wrapper',
          description: 'Turn the contents of this block into a unified navigation target.',
        },
        styles: { ...baseStyles, borderStyle: 'dashed', borderColor: 'rgba(96, 165, 250, 0.45)' },
      }
    case 'free-box':
      return {
        id,
        type: 'free-box',
        label: primitive.label || 'Free box',
        metadata,
        props: {
          description: 'Layer content with absolute positioning to stage immersive hero compositions.',
        },
        styles: {
          ...baseStyles,
          minHeight: '240px',
          borderStyle: 'dashed',
          borderColor: 'rgba(96, 165, 250, 0.45)',
        },
      }
    default:
      return {
        id,
        type: 'primitive',
        label: primitive.label || 'Primitive block',
        metadata,
        props: {
          description: primitive.description || 'Drop components into this primitive to begin composing the experience.',
        },
        styles: { ...baseStyles },
      }
  }
}

const createComponentNode = (component) => {
  if (!component || typeof component !== 'object') {
    return null
  }
  const id = createCanvasNodeId(component.id || 'component')
  return {
    id,
    type: 'component',
    label: component.label || component.id || 'Component',
    componentId: component.id || null,
    metadata: {
      source: component.source || 'library-component',
      capability: component.capability || '',
    },
    props: {
      summary: component.summary || '',
      description: component.description || '',
    },
    styles: {
      ...primitiveStyleBase,
      borderColor: 'rgba(59, 130, 246, 0.55)',
      boxShadow: '0 32px 60px rgba(37, 99, 235, 0.25)',
    },
  }
}

const nodeContainsTarget = (state, nodeId, candidateId) => {
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

const createCanvasNodeId = (prefix) =>
  `${prefix}-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`

const surfaceDropTypes = [DND_ITEM_TYPES.LIBRARY_ENTRY, DND_ITEM_TYPES.CANVAS_NODE]

function CanvasSurfaceInsertionZone({ index, onInsert }) {
  const [{ isOver, canDrop }, dropRef] = useDrop(
    () => ({
      accept: surfaceDropTypes,
      drop: (item) => {
        onInsert({ parentId: null, slot: null, index }, item)
        return { index }
      },
      collect: (monitor) => ({
        isOver: monitor.isOver(),
        canDrop: monitor.canDrop(),
      }),
    }),
    [index, onInsert],
  )

  const classes = [
    'canvas-surface__insertion',
    isOver && canDrop ? 'is-active' : '',
    isOver && !canDrop ? 'is-blocked' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const label = !canDrop ? 'Cannot drop here' : isOver ? 'Release to drop' : 'Drop component here'

  return (
    <div ref={dropRef} className={classes} role="presentation">
      <span className="canvas-surface__insertion-label">{label}</span>
    </div>
  )
}

function CanvasSurfaceNode({ node, onSelect, isSelected }) {
  const displayName = getCanvasNodeDisplayName(node)
  const meta = getCanvasNodeMeta(node)
  const [{ isDragging }, dragRef] = useDrag(
    () => ({
      type: DND_ITEM_TYPES.CANVAS_NODE,
      item: { nodeId: node.id },
      collect: (monitor) => ({
        isDragging: monitor.isDragging(),
      }),
    }),
    [node.id],
  )

  const classes = [
    'canvas-surface__node',
    isSelected ? 'is-selected' : '',
    isDragging ? 'is-dragging' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const description =
    typeof node?.metadata === 'object' && node?.metadata
      ? node.metadata.description || node.metadata.summary || ''
      : ''

  return (
    <button
      type="button"
      ref={dragRef}
      className={classes}
      onClick={() => onSelect(node.id)}
    >
      <div className="canvas-surface__node-header">
        <span className="canvas-surface__node-badge">{node.type || 'Node'}</span>
        {meta ? <span className="canvas-surface__node-meta">{meta}</span> : null}
      </div>
      <strong className="canvas-surface__node-title">{displayName || 'Untitled node'}</strong>
      {description ? <p className="canvas-surface__node-summary">{description}</p> : null}
    </button>
  )
}

function CanvasDragSurface({ canvasState, onInsert, onSelect }) {
  const nodes = useMemo(
    () => canvasState.rootIds.map((nodeId) => canvasState.nodes[nodeId]).filter(Boolean),
    [canvasState],
  )

  const handleInsert = useCallback(
    (target, item) => {
      onInsert(target, item)
    },
    [onInsert],
  )

  if (!nodes.length) {
    return (
      <div className="canvas-workspace__surface">
        <CanvasSurfaceInsertionZone index={0} onInsert={handleInsert} />
        <div className="canvas-surface__empty">
          <h3>Surface ready</h3>
          <p>Drag components or layout primitives into this surface to start composing your screen.</p>
        </div>
        <CanvasSurfaceInsertionZone index={1} onInsert={handleInsert} />
      </div>
    )
  }

  return (
    <div className="canvas-workspace__surface">
      {nodes.map((node, index) => (
        <Fragment key={node.id}>
          <CanvasSurfaceInsertionZone index={index} onInsert={handleInsert} />
          <CanvasSurfaceNode
            node={node}
            onSelect={onSelect}
            isSelected={canvasState.selectionId === node.id}
          />
        </Fragment>
      ))}
      <CanvasSurfaceInsertionZone index={nodes.length} onInsert={handleInsert} />
    </div>
  )
}
export default function CanvasWorkspace() {
  const projectSettings = useProjectSettings()
  const projectSettingsVersion = projectSettings?.version
  const [status, setStatus] = useState(defaultStatus)
  const [publishState, setPublishState] = useState(defaultPublishState)
  const [publishTarget, setPublishTarget] = useState('staging')
  const [screensState, setScreensState] = useState({
    items: [],
    version: null,
    updatedAt: null,
    isLoading: true,
    error: '',
  })
  const [settingsState, setSettingsState] = useState({
    value: createDefaultWorkspaceSettings(),
    version: null,
    updatedAt: null,
    isLoading: true,
    error: '',
  })
  const [isSavingSettings, setIsSavingSettings] = useState(false)
  const screens = screensState.items
  const settings = settingsState.value || createDefaultWorkspaceSettings()
  const [selectedScreenId, setSelectedScreenId] = useState('')
  const activeScreen = useMemo(
    () => screens.find((option) => option.id === selectedScreenId) ?? screens[0],
    [screens, selectedScreenId],
  )
  const [isCreateScreenOpen, setIsCreateScreenOpen] = useState(false)
  const [newScreenForm, setNewScreenForm] = useState({
    name: '',
    device: 'Desktop',
    description: '',
  })
  const [createScreenError, setCreateScreenError] = useState('')
  const [isCreatingScreen, setIsCreatingScreen] = useState(false)
  const [isDeletingScreen, setIsDeletingScreen] = useState(false)
  const [settingsError, setSettingsError] = useState('')
  const [pageStyles, setPageStyles] = useState(() => createDefaultPageStyles())
  const [canvasState, setCanvasState] = useState(() => createEmptyCanvasState())
  const [canvasSaveState, setCanvasSaveState] = useState({
    status: 'idle',
    updatedAt: null,
    version: null,
    error: '',
  })
  const [isSidebarOpen, setSidebarOpen] = useState(false)
  const [activeSidebarTool, setActiveSidebarTool] = useState('component-loader')
  const [sidebarOffsetTop, setSidebarOffsetTop] = useState(0)
  const [isNavigatorOpen, setNavigatorOpen] = useState(false)
  const [isHeaderPanelOpen, setHeaderPanelOpen] = useState(false)
  const [isThemePanelOpen, setThemePanelOpen] = useState(false)
  const [navigatorSearch, setNavigatorSearch] = useState('')
  const [openNavigatorSections, setOpenNavigatorSections] = useState({
    currentScreens: true,
    liveLayout: true,
  })
  const workspaceRef = useRef(null)
  const canvasAutosaveRef = useRef(null)
  const canvasSaveInFlightRef = useRef(false)
  const pendingCanvasNodesRef = useRef(null)
  const lastCommittedSnapshotRef = useRef('')
  const screensStateRef = useRef(screensState)
  const selectedScreenIdRef = useRef(selectedScreenId)
  const publishTargetInputId = 'ui-editor-publish-target'
  const isPublishing = publishState.status === 'pending'
  useEffect(() => {
    screensStateRef.current = screensState
  }, [screensState])
  useEffect(() => {
    selectedScreenIdRef.current = selectedScreenId
  }, [selectedScreenId])
  useEffect(() => {
    if (canvasAutosaveRef.current) {
      clearTimeout(canvasAutosaveRef.current)
      canvasAutosaveRef.current = null
    }
    pendingCanvasNodesRef.current = null

    if (!activeScreen) {
      setCanvasState(() => createEmptyCanvasState())
      lastCommittedSnapshotRef.current = JSON.stringify([])
      setCanvasSaveState((previous) => ({
        ...previous,
        status: 'idle',
        error: '',
        updatedAt: null,
        version: screensState.version,
      }))
      return
    }

    setCanvasState((previous) => {
      const nextState = createCanvasStateFromNodes(activeScreen.nodes || [])
      const previousSelection = previous?.selectionId || null
      if (previousSelection && nextState.nodes[previousSelection]) {
        nextState.selectionId = previousSelection
      }
      return nextState
    })

    lastCommittedSnapshotRef.current = JSON.stringify(activeScreen.nodes || [])
    setCanvasSaveState((previous) => ({
      ...previous,
      status: 'idle',
      error: '',
      updatedAt: activeScreen.updatedAt || screensState.updatedAt || null,
      version: screensState.version,
    }))
  }, [activeScreen, screensState.version, screensState.updatedAt])

  const activeComponent = useMemo(() => {
    if (!canvasState.selectionId) {
      return null
    }
    return canvasState.nodes[canvasState.selectionId] || null
  }, [canvasState])

  const activeComponentLabel = activeComponent
    ? getCanvasNodeDisplayName(activeComponent)
    : 'No component selected'
  const activeComponentMeta = activeComponent ? getCanvasNodeMeta(activeComponent) : ''
  const activeComponentChip = activeComponent?.type || 'Node'
  const activeComponentDescription = activeComponent
    ? activeComponentMeta || 'Component ready to edit.'
    : 'Select a node in the canvas to inspect its properties.'
  const componentPreviewStyle = useMemo(() => {
    if (!activeComponent?.styles || typeof activeComponent.styles !== 'object') {
      return {}
    }

    const nextStyle = {}
    previewStyleAllowlist.forEach((property) => {
      if (activeComponent.styles[property] !== undefined) {
        nextStyle[property] = activeComponent.styles[property]
      }
    })
    return nextStyle
  }, [activeComponent])

  const canvasStatusMessage = useMemo(() => {
    if (canvasSaveState.error) {
      return { variant: 'error', text: canvasSaveState.error, live: true }
    }
    if (canvasSaveState.status === 'saving') {
      return { variant: 'note', text: 'Saving canvas changes…', live: true }
    }
    if (canvasSaveState.status === 'dirty') {
      return { variant: 'note', text: 'Unsaved changes', live: false }
    }
    if (canvasSaveState.status === 'saved') {
      const formatted = canvasSaveState.updatedAt
        ? formatPublishTimestamp(canvasSaveState.updatedAt)
        : 'just now'
      return { variant: 'note', text: `Saved ${formatted}`, live: false }
    }
    return null
  }, [canvasSaveState])

  const stageArtboardStyle = useMemo(() => {
    const layoutWidth = pageStyles.layout === 'fluid' ? '100%' : pageStyles.maxWidth || '1200px'
    const resolvedFontSize =
      typeof pageStyles.fontSize === 'number' ? `${pageStyles.fontSize}px` : pageStyles.fontSize || '16px'

    return {
      maxWidth: layoutWidth,
      backgroundColor: pageStyles.backgroundColor,
      color: pageStyles.textColor,
      fontFamily: pageStyles.fontFamily,
      fontSize: resolvedFontSize,
      gap: pageStyles.blockSpacing,
      borderRadius: pageStyles.borderRadius,
      boxShadow:
        pageStyles.elevation === 'soft'
          ? '0 32px 64px rgba(15, 23, 42, 0.32)'
          : '0 40px 100px rgba(15, 23, 42, 0.45)',
    }
  }, [pageStyles])

  const stageLayoutLabel = useMemo(() => {
    if (pageStyles.layout === 'fluid') {
      return 'Fluid layout'
    }
    if (pageStyles.maxWidth) {
      return `Max width ${pageStyles.maxWidth}`
    }
    return 'Fixed width'
  }, [pageStyles.layout, pageStyles.maxWidth])

  const loadScreens = useCallback(async () => {
    setScreensState((previous) => ({ ...previous, isLoading: true, error: '' }))
    try {
      const response = await fetchCanvasScreens()
      const items = Array.isArray(response?.screens) ? response.screens : []
      setScreensState({
        items,
        version: response?.version ?? 0,
        updatedAt: response?.updatedAt ?? null,
        isLoading: false,
        error: '',
      })
      setSelectedScreenId((previousSelected) => {
        if (previousSelected && items.some((screen) => screen.id === previousSelected)) {
          return previousSelected
        }
        return items[0]?.id ?? ''
      })
      setCreateScreenError('')
    } catch (error) {
      const message = error?.message || 'Unable to load canvas screens.'
      setScreensState((previous) => ({ ...previous, isLoading: false, error: message }))
      setCreateScreenError(message)
    }
  }, [])

  const loadSettings = useCallback(async () => {
    setSettingsState((previous) => ({ ...previous, isLoading: true, error: '' }))
    try {
      const response = await fetchCanvasSettings()
      const value = coerceWorkspaceSettings(response?.settings)
      setSettingsState({
        value,
        version: response?.version ?? 0,
        updatedAt: response?.updatedAt ?? null,
        isLoading: false,
        error: '',
      })
      setPageStyles(value.pageStyles)
      setSettingsError('')
      setIsSavingSettings(false)
    } catch (error) {
      const message = error?.message || 'Unable to load canvas settings.'
      setSettingsState((previous) => ({ ...previous, isLoading: false, error: message }))
      setSettingsError(message)
      setIsSavingSettings(false)
    }
  }, [])

  const applySettingsPatch = useCallback(
    async (patch) => {
      setSettingsError('')
      if (settingsState.version === null) {
        setSettingsError('Settings are still loading. Please try again once available.')
        return
      }

      setIsSavingSettings(true)
      const optimistic = mergeWorkspaceSettings(settingsState.value, patch)
      setSettingsState((previous) => ({
        ...previous,
        value: optimistic,
      }))

      if (patch?.pageStyles) {
        setPageStyles(optimistic.pageStyles)
      }

      try {
        const response = await updateCanvasSettings(patch, settingsState.version)
        const nextValue = coerceWorkspaceSettings(response?.settings)
        setSettingsState({
          value: nextValue,
          version: response?.version ?? settingsState.version + 1,
          updatedAt: response?.updatedAt ?? null,
          isLoading: false,
          error: '',
        })
        setPageStyles(nextValue.pageStyles)
      } catch (error) {
        if (error?.status === 409) {
          setSettingsError('Settings changed in another session. Reloading latest values…')
          await loadSettings()
        } else {
          setSettingsError(error?.message || 'Unable to update settings.')
        }
      } finally {
        setIsSavingSettings(false)
      }
    },
    [settingsState.version, settingsState.value, loadSettings],
  )

  useEffect(() => {
    loadScreens()
    loadSettings()
  }, [loadScreens, loadSettings])

  const formatPublishTimestamp = (value) => {
    if (!value) return '—'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) {
      return value
    }
    return date.toLocaleString()
  }

  const handleThemeTokenChange = (field) => (event) => {
    applySettingsPatch({ themeTokens: { [field]: event.target.value } })
  }

  const handleWorkspacePreferenceChange = (field) => (event) => {
    applySettingsPatch({ workspace: { [field]: event.target.value } })
  }

  const handleWorkspaceToggle = (field) => (event) => {
    applySettingsPatch({ workspace: { [field]: event.target.checked } })
  }

  const handlePublishTargetChange = (event) => {
    setPublishTarget(event.target.value)
  }

  const handlePublish = async (event) => {
    event.preventDefault()
    const target = publishTarget.trim()
    if (!target) {
      setPublishState({
        status: 'error',
        message: 'Enter a publish target to continue.',
        detail: null,
      })
      return
    }

    setPublishState({
      status: 'pending',
      message: `Publishing ${target} bundle…`,
      detail: null,
    })

    try {
      const result = await publishUiBundle({ target })
      const successCount = Array.isArray(result?.writtenFiles) ? result.writtenFiles.length : 0
      const failureCount = Array.isArray(result?.failures) ? result.failures.length : 0
      const pluralise = (count) => (count === 1 ? '' : 's')

      let nextStatus = 'success'
      let message
      if (failureCount && successCount) {
        nextStatus = 'warning'
        message = `Published bundle to ${successCount} destination${pluralise(successCount)}, but ${failureCount} destination${pluralise(
          failureCount,
        )} failed.`
      } else if (failureCount) {
        nextStatus = 'error'
        message = `Publish to ${target} failed. ${failureCount} destination${pluralise(failureCount)} reported an error.`
      } else {
        message = `Publish to ${target} completed successfully across ${successCount} destination${pluralise(successCount)}.`
      }

      setPublishState({
        status: nextStatus,
        message,
        detail: {
          ...result,
          target,
        },
      })
    } catch (error) {
      let message = error?.message || 'Failed to publish screen bundle.'
      let detail = null

      if (typeof message === 'string') {
        const trimmed = message.trim()
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
          try {
            const parsed = JSON.parse(trimmed)
            message = parsed?.error || message
            detail = parsed?.details || parsed || null
          } catch (parseError) {
            // Ignore parse failures and keep the original message
          }
        }
      }

      if (!detail) {
        detail = { status: error?.status ?? null }
      }

      if (typeof detail !== 'object' || Array.isArray(detail)) {
        detail = { info: detail }
      }

      detail.target = target
      if (detail.status === undefined) {
        detail.status = error?.status ?? null
      }

      setPublishState({
        status: 'error',
        message,
        detail,
      })
    }
  }

  const publishDetail =
    publishState.detail && typeof publishState.detail === 'object' && !Array.isArray(publishState.detail)
      ? publishState.detail
      : {}
  const publishMeta = publishDetail?.meta || null
  const publishWrittenFiles = Array.isArray(publishDetail?.writtenFiles) ? publishDetail.writtenFiles : []
  const publishFailures = Array.isArray(publishDetail?.failures) ? publishDetail.failures : []
  const publishAvailableTargets = Array.isArray(publishDetail?.availableTargets)
    ? publishDetail.availableTargets
    : []
  const publishStatusCode = publishDetail?.status ?? null
  const publishInfo = publishDetail?.info ?? null

  const handleSelectScreen = (screenId) => {
    setSelectedScreenId(screenId)
  }

  const handleToggleCreateScreen = () => {
    setIsCreateScreenOpen((previous) => {
      const next = !previous
      if (!next) {
        setNewScreenForm({ name: '', device: 'Desktop', description: '' })
      }
      return next
    })
    setCreateScreenError('')
  }

  const handleCreateScreenFieldChange = (field) => (event) => {
    const { value } = event.target
    setNewScreenForm((previous) => ({
      ...previous,
      [field]: value,
    }))
  }

  const handleCreateScreen = async (event) => {
    event.preventDefault()
    const trimmedName = newScreenForm.name.trim()
    if (!trimmedName) {
      setCreateScreenError('Please provide a screen name to continue.')
      return
    }

    if (screensState.version === null) {
      setCreateScreenError('Screen metadata is still loading. Please try again shortly.')
      return
    }

    const device = (newScreenForm.device || 'Desktop').trim() || 'Desktop'
    const description = newScreenForm.description.trim() || `${device} layout`

    setIsCreatingScreen(true)
    setCreateScreenError('')

    try {
      const response = await createCanvasScreen(
        { name: trimmedName, device, description },
        screensState.version,
      )
      const nextScreens = Array.isArray(response?.screens) ? response.screens : []
      setScreensState({
        items: nextScreens,
        version: response?.version ?? screensState.version + 1,
        updatedAt: response?.updatedAt ?? null,
        isLoading: false,
        error: '',
      })
      const createdScreenId =
        response?.screen?.id || nextScreens[nextScreens.length - 1]?.id || nextScreens[0]?.id || ''
      setSelectedScreenId(createdScreenId)
      setIsCreateScreenOpen(false)
      setNewScreenForm({ name: '', device: 'Desktop', description: '' })
    } catch (error) {
      if (error?.status === 409) {
        setCreateScreenError('Another editor updated the screen list. Reloading the latest data…')
        await loadScreens()
      } else {
        setCreateScreenError(error?.message || 'Unable to create screen.')
      }
    } finally {
      setIsCreatingScreen(false)
    }
  }

  const handleDeleteScreen = async () => {
    if (!selectedScreenId) return
    if (screensState.version === null) {
      setCreateScreenError('Screen metadata is still loading. Please try again shortly.')
      return
    }

    setIsDeletingScreen(true)
    setCreateScreenError('')

    try {
      const response = await deleteCanvasScreen(selectedScreenId, screensState.version)
      const nextScreens = Array.isArray(response?.screens) ? response.screens : []
      setScreensState({
        items: nextScreens,
        version: response?.version ?? screensState.version + 1,
        updatedAt: response?.updatedAt ?? null,
        isLoading: false,
        error: '',
      })
      setSelectedScreenId((previousSelected) => {
        if (nextScreens.some((screen) => screen.id === previousSelected)) {
          return previousSelected
        }
        return nextScreens[0]?.id ?? ''
      })
    } catch (error) {
      if (error?.status === 409) {
        setCreateScreenError('Another editor updated the screen list. Reloading the latest data…')
        await loadScreens()
      } else if (error?.status === 404) {
        setCreateScreenError('The selected screen no longer exists. Reloading the latest data…')
        await loadScreens()
      } else {
        setCreateScreenError(error?.message || 'Unable to delete screen.')
      }
    } finally {
      setIsDeletingScreen(false)
    }
  }

  const pageStylesSaveRef = useRef(null)

  const handlePageStyleChange = (nextStyles) => {
    const merged = { ...pageStyles, ...nextStyles }
    setPageStyles(merged)
    if (pageStylesSaveRef.current) {
      clearTimeout(pageStylesSaveRef.current)
    }
    pageStylesSaveRef.current = setTimeout(() => {
      applySettingsPatch({ pageStyles: merged })
      pageStylesSaveRef.current = null
    }, 400)
  }

  const persistCanvasNodes = useCallback(
    async (nodesPayload, snapshotString) => {
      const currentScreenId = selectedScreenIdRef.current
      const currentScreensState = screensStateRef.current

      if (!currentScreenId) {
        pendingCanvasNodesRef.current = null
        setCanvasSaveState((previous) => ({
          status: 'error',
          updatedAt: previous.updatedAt,
          version: previous.version,
          error: 'Select a screen to save its canvas.',
        }))
        return
      }

      if (!Array.isArray(nodesPayload)) {
        pendingCanvasNodesRef.current = null
        return
      }

      if (canvasSaveInFlightRef.current) {
        pendingCanvasNodesRef.current = { nodes: nodesPayload, snapshot: snapshotString }
        return
      }

      if (currentScreensState.version === null || currentScreensState.version === undefined) {
        setCanvasSaveState((previous) => ({
          status: 'dirty',
          updatedAt: previous.updatedAt,
          version: previous.version,
          error: '',
        }))
        pendingCanvasNodesRef.current = { nodes: nodesPayload, snapshot: snapshotString }
        if (!canvasAutosaveRef.current) {
          canvasAutosaveRef.current = setTimeout(() => {
            canvasAutosaveRef.current = null
            const payload = pendingCanvasNodesRef.current
            if (payload) {
              persistCanvasNodes(payload.nodes, payload.snapshot)
            }
          }, 300)
        }
        return
      }

      canvasSaveInFlightRef.current = true
      if (pendingCanvasNodesRef.current?.snapshot === snapshotString) {
        pendingCanvasNodesRef.current = null
      }

      setCanvasSaveState({
        status: 'saving',
        updatedAt: currentScreensState.updatedAt ?? null,
        version: currentScreensState.version,
        error: '',
      })

      try {
        const response = await updateCanvasScreenNodes(
          currentScreenId,
          nodesPayload,
          currentScreensState.version,
        )
        const nextVersion =
          typeof response?.version === 'number' ? response.version : currentScreensState.version
        const nextUpdatedAt = response?.updatedAt ?? new Date().toISOString()

        setScreensState((previous) => ({
          items: Array.isArray(response?.screens) ? response.screens : previous.items,
          version: nextVersion,
          updatedAt: nextUpdatedAt,
          isLoading: false,
          error: '',
        }))

        setCanvasSaveState({
          status: 'saved',
          updatedAt: nextUpdatedAt,
          version: nextVersion,
          error: '',
        })

        const savedSnapshot = JSON.stringify(response?.screen?.nodes ?? nodesPayload)
        lastCommittedSnapshotRef.current = savedSnapshot

        if (response?.screen?.id === currentScreenId) {
          setCanvasState((previous) => {
            const nextState = createCanvasStateFromNodes(response.screen.nodes || [])
            const previousSelection = previous?.selectionId || null
            if (previousSelection && nextState.nodes[previousSelection]) {
              nextState.selectionId = previousSelection
            }
            return nextState
          })
        }
      } catch (error) {
        if (error?.status === 409) {
          setCanvasSaveState({
            status: 'error',
            updatedAt: null,
            version: currentScreensState.version,
            error: 'Canvas changed in another session. Reloading latest layout…',
          })
          await loadScreens()
        } else {
          setCanvasSaveState((previous) => ({
            status: 'error',
            updatedAt: previous.updatedAt,
            version: previous.version ?? currentScreensState.version ?? null,
            error: error?.message || 'Unable to save canvas.',
          }))
        }
      } finally {
        canvasSaveInFlightRef.current = false
        const pending = pendingCanvasNodesRef.current
        if (pending && pending.snapshot !== lastCommittedSnapshotRef.current) {
          if (canvasAutosaveRef.current) {
            clearTimeout(canvasAutosaveRef.current)
          }
          canvasAutosaveRef.current = setTimeout(() => {
            canvasAutosaveRef.current = null
            if (!pendingCanvasNodesRef.current) {
              return
            }
            persistCanvasNodes(
              pendingCanvasNodesRef.current.nodes,
              pendingCanvasNodesRef.current.snapshot,
            )
          }, 200)
        }
      }
    },
    [loadScreens],
  )

  const scheduleCanvasAutosave = useCallback(
    (nextState) => {
      if (!nextState) {
        return
      }

      const currentScreenId = selectedScreenIdRef.current
      if (!currentScreenId) {
        setCanvasSaveState((previous) => ({
          status: 'error',
          updatedAt: previous.updatedAt,
          version: previous.version,
          error: 'Select a screen to edit the canvas.',
        }))
        return
      }

      const serialisedNodes = serialiseCanvasStateToNodes(nextState)
      const snapshotString = JSON.stringify(serialisedNodes)

      if (snapshotString === lastCommittedSnapshotRef.current) {
        return
      }

      pendingCanvasNodesRef.current = { nodes: serialisedNodes, snapshot: snapshotString }

      setCanvasSaveState((previous) => {
        if (previous.status === 'saving') {
          return previous
        }
        return {
          status: 'dirty',
          updatedAt: previous.updatedAt,
          version: previous.version,
          error: '',
        }
      })

      if (canvasSaveInFlightRef.current) {
        return
      }

      if (canvasAutosaveRef.current) {
        clearTimeout(canvasAutosaveRef.current)
      }
      canvasAutosaveRef.current = setTimeout(() => {
        canvasAutosaveRef.current = null
        const payload = pendingCanvasNodesRef.current
        if (!payload) {
          return
        }
        persistCanvasNodes(payload.nodes, payload.snapshot)
      }, 600)
    },
    [persistCanvasNodes],
  )

  const handleComponentChange = useCallback(
    (nextComponent) => {
      if (!nextComponent?.id) {
        return
      }
      setCanvasState((previous) => {
        const nextState = updateCanvasNode(previous, nextComponent)
        if (nextState !== previous) {
          scheduleCanvasAutosave(nextState)
        }
        return nextState
      })
    },
    [scheduleCanvasAutosave],
  )

  const handleSelectNode = useCallback((nodeId) => {
    if (!nodeId) {
      return
    }
    setCanvasState((previous) => selectCanvasNode(previous, nodeId))
  }, [])

  const handleInsertNode = useCallback((target, item) => {
    if (!target) {
      return
    }
    setCanvasState((previous) => {
      if (!item) {
        return previous
      }

      if (item.entryType === LIBRARY_ENTRY_KINDS.PRIMITIVE && item.primitive) {
        const nextNode = createPrimitiveNode(item.primitive)
        if (!nextNode) {
          return previous
        }
        return insertCanvasNode(previous, nextNode, {
          parentId: target.parentId || null,
          slot: target.slot || null,
          index: target.index,
          select: true,
        })
      }

      if (item.entryType === LIBRARY_ENTRY_KINDS.COMPONENT && item.component) {
        const nextNode = createComponentNode(item.component)
        if (!nextNode) {
          return previous
        }
        return insertCanvasNode(previous, nextNode, {
          parentId: target.parentId || null,
          slot: target.slot || null,
          index: target.index,
          select: true,
        })
      }

      if (item.nodeId && previous.nodes[item.nodeId]) {
        const targetParentId = target.parentId || null
        if (targetParentId && nodeContainsTarget(previous, item.nodeId, targetParentId)) {
          return previous
        }
        return reparentCanvasNode(previous, item.nodeId, {
          parentId: targetParentId,
          slot: target.slot || null,
          index: target.index,
          select: true,
        })
      }

      return previous
    })
  }, [])

  useEffect(() => {
    return () => {
      if (pageStylesSaveRef.current) {
        clearTimeout(pageStylesSaveRef.current)
      }
    }
  }, [])

  useEffect(() => {
    return () => {
      if (canvasAutosaveRef.current) {
        clearTimeout(canvasAutosaveRef.current)
      }
    }
  }, [])

  const navigatorSections = useMemo(() => {
    const screenItems = screens.map((screen) => ({
      id: screen.id,
      title: screen.name,
      badge: screen.device,
      description: screen.description,
      isActive: screen.id === selectedScreenId,
      onSelect: () => handleSelectScreen(screen.id),
    }))

    const layoutItems = []
    const visitNode = (nodeId, depth = 0, slotName = null) => {
      const node = canvasState.nodes[nodeId]
      if (!node) {
        return
      }
      const title = getCanvasNodeDisplayName(node)
      const meta = getCanvasNodeMeta(node)
      const descriptionParts = []
      if (slotName) {
        descriptionParts.push(`Slot: ${slotName}`)
      }
      if (meta) {
        descriptionParts.push(meta)
      }
      const description = descriptionParts.length
        ? descriptionParts.join(' • ')
        : depth
        ? 'Nested node'
        : 'Root node'

      layoutItems.push({
        id: node.id,
        title,
        badge: slotName ? 'Slot content' : node.type,
        description,
        isActive: canvasState.selectionId === node.id,
        onSelect: () => handleSelectNode(node.id),
      })

      const children = getCanvasNodeChildren(canvasState, nodeId)
      children.forEach(({ node: childNode, slot }) => {
        visitNode(childNode.id, depth + 1, slot)
      })
    }

    canvasState.rootIds.forEach((nodeId) => visitNode(nodeId, 0, null))

    return [
      {
        id: 'currentScreens',
        label: 'Current screens',
        count: screenItems.length,
        items: screenItems,
      },
      {
        id: 'liveLayout',
        label: 'Live layout',
        count: layoutItems.length,
        items: layoutItems,
      },
    ]
  }, [screens, selectedScreenId, canvasState, handleSelectScreen, handleSelectNode])

  useEffect(() => {
    let active = true

    const normaliseOrigin = (origin) => (origin ? origin.replace(/\/+$/, '') : '')
    const originCandidates = []
    const pushOrigin = (origin) => {
      const normalised = normaliseOrigin(origin)
      if (!normalised) return
      if (originCandidates.includes(normalised)) return
      originCandidates.push(normalised)
    }

    const attemptLog = []
    const seenEndpoints = new Set()

    const tryEndpoint = async (target) => {
      const finalUrl = target.startsWith('http') ? target : resolveApiUrl(target)
      if (seenEndpoints.has(finalUrl)) {
        return false
      }
      seenEndpoints.add(finalUrl)

      try {
        const payload = await fetchJson(target, { method: 'GET' })
        if (!active) {
          return true
        }
        const origin = new URL(finalUrl).origin
        setStatus({
          phase: 'success',
          message: `Backend reachable.`,
          meta: { endpoint: finalUrl, payload, attempts: attemptLog },
        })
        return true
      } catch (error) {
        attemptLog.push({ endpoint: finalUrl, error: error?.message || String(error) })
        return false
      }
    }

    const checkBackend = async () => {
      setStatus({ phase: 'loading', message: 'Checking Collector backend...', meta: null })

      const initialTargets = ['/__debug', '/api/__debug']
      for (const target of initialTargets) {
        if (await tryEndpoint(target)) {
          return
        }
      }

      pushOrigin(projectSettings?.apiBase)
      pushOrigin(getApiOrigin())
      pushOrigin(getDefaultApiOrigin())
      ;['http://localhost:5001', 'http://localhost:5000', 'http://127.0.0.1:5001', 'http://127.0.0.1:5000'].forEach(pushOrigin)

      for (const origin of originCandidates) {
        if (await tryEndpoint(`${origin}/__debug`)) {
          return
        }
        if (await tryEndpoint(`${origin}/api/__debug`)) {
          return
        }
      }

      if (!active) {
        return
      }
      setStatus({
        phase: 'error',
        message: 'Unable to reach Collector backend. Configure an API base in Project settings or start the local API.',
        meta: { attempts: attemptLog },
      })
    }

    checkBackend()

    return () => {
      active = false
    }
  }, [projectSettingsVersion, projectSettings?.apiBase])

  const toggleSidebar = () => {
    setSidebarOpen((previous) => !previous)
  }

  const handleSelectSidebarTool = (toolId) => {
    setActiveSidebarTool(toolId)
    if (!isSidebarOpen) {
      setSidebarOpen(true)
    }
  }

  const toggleNavigator = () => {
    setNavigatorOpen((previous) => !previous)
  }

  const toggleHeaderPanel = () => {
    setHeaderPanelOpen((previous) => !previous)
  }

  const toggleThemePanel = () => {
    setThemePanelOpen((previous) => !previous)
  }

  const handleNavigatorSearchChange = (event) => {
    setNavigatorSearch(event.target.value)
  }

  const handleToggleNavigatorSection = (sectionId) => {
    setOpenNavigatorSections((previous) => ({
      ...previous,
      [sectionId]: !previous[sectionId],
    }))
  }

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined
    }

    const workspaceElement = workspaceRef.current
    if (!workspaceElement) {
      return undefined
    }

    const editorRoot = workspaceElement.closest('.ui-editor')
    if (!editorRoot) {
      return undefined
    }

    let frameId
    let resizeObserver
    const observedStickyElements = new Set()

    const computeOffset = () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId)
      }
      frameId = window.requestAnimationFrame(() => {
        const stickyElements = Array.from(editorRoot.querySelectorAll('[data-editor-sticky]'))
        if (resizeObserver) {
          observedStickyElements.forEach((element) => {
            if (!stickyElements.includes(element)) {
              resizeObserver.unobserve(element)
              observedStickyElements.delete(element)
            }
          })
          stickyElements.forEach((element) => {
            if (!observedStickyElements.has(element)) {
              resizeObserver.observe(element)
              observedStickyElements.add(element)
            }
          })
        }

        const totalOffset = stickyElements.reduce((total, element) => {
          const styles = window.getComputedStyle(element)
          const isSticky = styles.position === 'sticky' || styles.position === 'fixed'
          const isHidden = styles.display === 'none' || styles.visibility === 'hidden'
          if (!isSticky || isHidden) {
            return total
          }
          const rect = element.getBoundingClientRect()
          if (!rect.height) {
            return total
          }
          const marginBottom = parseFloat(styles.marginBottom) || 0
          return total + rect.height + marginBottom
        }, 0)

        const safeOffset = Math.max(0, Math.min(totalOffset, window.innerHeight))
        setSidebarOffsetTop(safeOffset)
        frameId = undefined
      })
    }

    const handleResize = () => {
      computeOffset()
    }

    window.addEventListener('resize', handleResize)

    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(handleResize)
    }

    let mutationObserver
    if (typeof MutationObserver !== 'undefined') {
      mutationObserver = new MutationObserver(handleResize)
      mutationObserver.observe(editorRoot, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class'],
      })
    }

    computeOffset()

    return () => {
      window.removeEventListener('resize', handleResize)
      if (mutationObserver) {
        mutationObserver.disconnect()
      }
      if (resizeObserver) {
        observedStickyElements.forEach((element) => resizeObserver.unobserve(element))
        resizeObserver.disconnect()
      }
      if (frameId) {
        window.cancelAnimationFrame(frameId)
      }
    }
  }, [])

  return (
    <DndProvider backend={HTML5Backend}>
      <div
        ref={workspaceRef}
        className={`canvas-workspace ${isSidebarOpen ? 'canvas-workspace--sidebar-open' : ''}`}
        style={{ '--sidebar-offset-top': `${sidebarOffsetTop}px` }}
      >
      <aside
        className={`canvas-workspace__sidebar ${isSidebarOpen ? 'is-open' : ''}`}
        aria-label="Editor tool panel"
      >
        <button
          type="button"
          className="canvas-workspace__sidebar-toggle"
          onClick={toggleSidebar}
          aria-expanded={isSidebarOpen}
          aria-controls="canvas-workspace-sidebar"
        >
          <span className="canvas-workspace__toggle-icon" aria-hidden="true">
            {isSidebarOpen ? '×' : '+'}
          </span>
          <span className="canvas-workspace__toggle-label" aria-hidden="true">
            {isSidebarOpen ? 'Close' : 'Tools'}
          </span>
          <span className="sr-only">{isSidebarOpen ? 'Collapse tools panel' : 'Expand tools panel'}</span>
        </button>

        <div className="canvas-workspace__sidebar-body" id="canvas-workspace-sidebar">
          <div className="canvas-workspace__sidebar-header">
            <h2>Canvas tools</h2>
            <p>Access configuration helpers while you design the Collector experience.</p>
          </div>

          <nav className="canvas-workspace__sidebar-nav" aria-label="Editor tools">
            <button
              type="button"
              className={`canvas-workspace__sidebar-nav-button ${activeSidebarTool === 'component-loader' ? 'is-active' : ''}`}
              onClick={() => handleSelectSidebarTool('component-loader')}
            >
              Component loader
            </button>
          </nav>

          <div className="canvas-workspace__sidebar-content">
            {activeSidebarTool === 'component-loader' && <ComponentLibraryPanel />}
          </div>
        </div>
      </aside>

      <div className="canvas-workspace__main">
        <div className="editor-home">
          <div className="editor-home__masthead">
            <header className="editor-home__intro">
              <h1>Collector experience settings</h1>
              <p className="editor-home__lead">
                Configure the global presentation system for Collector before diving into collection-level layouts. These
                settings feed downstream canvases, ensuring both mobile and desktop experiences inherit a consistent tone.
              </p>
            </header>


            <header className="canvas-workspace__header" data-editor-sticky="true">
              <button
                type="button"
                className="canvas-workspace__panel-toggle canvas-workspace__panel-toggle--compact"
                onClick={toggleHeaderPanel}
                aria-expanded={isHeaderPanelOpen}
                aria-controls="canvas-workspace-overview-panel"
              >
                {isHeaderPanelOpen ? 'Hide workspace overview' : 'Show workspace overview'}
              </button>
            </header>


            {screensState.error && !isCreateScreenOpen ? (
              <p className="canvas-workspace__form-error" role="alert">
                {screensState.error}
              </p>
            ) : null}

            <div className="canvas-workspace__panel-launchers" aria-label="Workspace quick panels">
              <span className="canvas-workspace__panel-launchers-label">Workspace panels</span>
              <div className="canvas-workspace__panel-launchers-buttons">
                <button
                  type="button"
                  className="canvas-workspace__panel-toggle"
                  onClick={toggleNavigator}
                  aria-expanded={isNavigatorOpen}
                  aria-controls="canvas-workspace-navigator-panel"
                  data-expanded={isNavigatorOpen}
                >
                  {isNavigatorOpen ? 'Hide workspace navigator' : 'workspace navigator'}
                </button>
                <button
                  type="button"
                  className="canvas-workspace__panel-toggle"
                  onClick={toggleThemePanel}
                  aria-expanded={isThemePanelOpen}
                  aria-controls="canvas-workspace-theme-panel"
                  data-expanded={isThemePanelOpen}
                >
                  {isThemePanelOpen ? 'Hide workspace theme' : 'workspace theme'}
                </button>
              </div>
            </div>

            <div className="canvas-workspace__panel-dock">
              {isHeaderPanelOpen ? (
                <section
                  id="canvas-workspace-overview-panel"
                  className="canvas-workspace__floating-panel canvas-workspace__overview-panel"
                  aria-label="Workspace overview"
                >
                  <div className="canvas-workspace__overview-header">
                    <div>
                      <p className="canvas-workspace__header-label">Workspace overview</p>
                      <h2 className="canvas-workspace__overview-title">
                        {activeScreen ? activeScreen.name : 'No screen selected'}
                      </h2>
                    </div>
                    <button
                      type="button"
                      className="canvas-workspace__panel-toggle canvas-workspace__panel-toggle--compact"
                      onClick={toggleHeaderPanel}
                    >
                      Close
                    </button>
                  </div>
                  <div className="canvas-workspace__overview-body">
                    <div className="canvas-workspace__header-info">
                      <span className="canvas-workspace__header-label">Current screen</span>
                      <div className="canvas-workspace__header-title" aria-live="polite">
                        {activeScreen ? (
                          <>
                            <strong>{activeScreen.name}</strong>
                            <span className="canvas-workspace__header-device">{activeScreen.device}</span>
                          </>
                        ) : (
                          <strong>No screen selected</strong>
                        )}
                      </div>
                      {activeScreen?.description ? (
                        <p className="canvas-workspace__header-description">{activeScreen.description}</p>
                      ) : null}
                    </div>
                    <div className="canvas-workspace__overview-controls">
                      <div className="canvas-workspace__overview-buttons">
                        <button
                          type="button"
                          className="canvas-workspace__header-button"
                          onClick={handleToggleCreateScreen}
                          aria-expanded={isCreateScreenOpen}
                        >
                          {isCreateScreenOpen ? 'Close' : 'New screen'}
                        </button>
                        <button
                          type="button"
                          className="canvas-workspace__link-button"
                          onClick={handleDeleteScreen}
                          disabled={!selectedScreenId || isDeletingScreen || screens.length === 0}
                        >
                          {isDeletingScreen ? 'Deleting…' : 'Delete screen'}
                        </button>
                      </div>
                      <form className="canvas-workspace__publish-form" onSubmit={handlePublish}>
                        <label className="canvas-workspace__publish-label" htmlFor={publishTargetInputId}>
                          <span className="canvas-workspace__publish-label-text">Publish target</span>
                          <input
                            id={publishTargetInputId}
                            name="publish-target"
                            className="canvas-workspace__publish-input"
                            type="text"
                            value={publishTarget}
                            onChange={handlePublishTargetChange}
                            placeholder="e.g. staging"
                            list="canvas-workspace-publish-targets"
                            disabled={isPublishing}
                          />
                        </label>
                        <datalist id="canvas-workspace-publish-targets">
                          <option value="staging" />
                          <option value="production" />
                        </datalist>
                        <button type="submit" className="canvas-workspace__header-button" disabled={isPublishing}>
                          {isPublishing ? 'Publishing…' : 'Publish'}
                        </button>
                      </form>
                      <label className="canvas-workspace__header-select">
                        <span className="canvas-workspace__header-select-label">Switch screen</span>
                        <select
                          value={selectedScreenId}
                          onChange={(event) => handleSelectScreen(event.target.value)}
                          disabled={screensState.isLoading || screens.length === 0}
                        >
                          {screens.length ? (
                            screens.map((screen) => (
                              <option key={screen.id} value={screen.id}>
                                {screen.name} — {screen.device}
                              </option>
                            ))
                          ) : (
                            <option value="">No screens available</option>
                          )}
                        </select>
                      </label>
                    </div>
                  </div>
                </section>
              ) : null}
              {isNavigatorOpen ? (
                <aside
                  id="canvas-workspace-navigator-panel"
                  className="canvas-workspace__floating-panel canvas-workspace__navigator-panel"
                  aria-label="Workspace navigator"
                >
                  <div className="canvas-workspace__navigator-header">
                    <div>
                      <p className="canvas-workspace__navigator-eyebrow">Screens &amp; layout</p>
                      <h2>Workspace navigator</h2>
                    </div>
                    <div className="canvas-workspace__navigator-actions">
                      <button type="button" className="canvas-workspace__navigator-new">New</button>
                      <button
                        type="button"
                        className="canvas-workspace__panel-toggle canvas-workspace__panel-toggle--compact"
                        onClick={toggleNavigator}
                        aria-label="Close workspace navigator"
                      >
                        Close
                      </button>
                    </div>
                  </div>
                  <label className="canvas-workspace__navigator-search" htmlFor="canvas-workspace-navigator-search">
                    <span className="sr-only">Search navigator</span>
                    <input
                      id="canvas-workspace-navigator-search"
                      type="search"
                      value={navigatorSearch}
                      onChange={handleNavigatorSearchChange}
                      placeholder="Search…"
                    />
                  </label>
                  <div className="canvas-workspace__navigator-sections">
                    {navigatorSections.map((section) => {
                      const isOpen = openNavigatorSections[section.id] ?? false
                      const searchQuery = navigatorSearch.trim().toLowerCase()
                      const items = searchQuery
                        ? section.items.filter((item) => {
                            const haystack = [item.title, item.badge, item.description]
                              .filter(Boolean)
                              .join(' ')
                              .toLowerCase()
                            return haystack.includes(searchQuery)
                          })
                        : section.items
                      return (
                        <section key={section.id} className="canvas-workspace__navigator-section">
                          <button
                            type="button"
                            className="canvas-workspace__navigator-section-toggle"
                            onClick={() => handleToggleNavigatorSection(section.id)}
                            aria-expanded={isOpen}
                          >
                            <span>{section.label}</span>
                            <span className="canvas-workspace__navigator-count">{section.count}</span>
                            <span className="canvas-workspace__navigator-icon" aria-hidden="true">
                              {isOpen ? '−' : '+'}
                            </span>
                          </button>
                          {isOpen ? (
                            items.length ? (
                              <ul className="canvas-workspace__navigator-list">
                                {items.map((item) => {
                                  const isActionable = typeof item.onSelect === 'function'
                                  return (
                                    <li key={item.id}>
                                      <button
                                        type="button"
                                        className="canvas-workspace__navigator-item"
                                        onClick={isActionable ? item.onSelect : undefined}
                                        data-active={item.isActive || undefined}
                                        disabled={!isActionable}
                                      >
                                        <span className="canvas-workspace__navigator-item-title">{item.title}</span>
                                        {item.badge ? (
                                          <span className="canvas-workspace__navigator-item-badge">{item.badge}</span>
                                        ) : null}
                                        {item.description ? (
                                          <span className="canvas-workspace__navigator-item-description">{item.description}</span>
                                        ) : null}
                                      </button>
                                    </li>
                                  )
                                })}
                              </ul>
                            ) : (
                              <p className="canvas-workspace__navigator-empty">No matches found.</p>
                            )
                          ) : null}
                        </section>
                      )
                    })}
                  </div>
                </aside>
              ) : null}
              {isThemePanelOpen ? (
                <section
                  id="canvas-workspace-theme-panel"
                  className="canvas-workspace__floating-panel canvas-workspace__theme-panel canvas-workspace__theme-settings"
                  aria-label="Workspace theme"
                >
                  <div className="canvas-workspace__theme-panel-header">
                    <div>
                      <p className="canvas-workspace__theme-eyebrow">Visual tokens</p>
                      <h2>Workspace theme</h2>
                    </div>
                    <button
                      type="button"
                      className="canvas-workspace__panel-toggle canvas-workspace__panel-toggle--compact"
                      onClick={toggleThemePanel}
                      aria-label="Close workspace theme"
                    >
                      Close
                    </button>
                  </div>
                  <p className="canvas-workspace__theme-description">
                    Tune primary tokens that flow through every screen. Changes are saved automatically for all editors.
                  </p>
                  <div className="canvas-workspace__theme-grid">
                    <div className="canvas-workspace__field">
                      <label htmlFor="canvas-theme-color-scheme">Color scheme</label>
                      <select
                        id="canvas-theme-color-scheme"
                        value={settings.themeTokens.colorScheme}
                        onChange={handleThemeTokenChange('colorScheme')}
                        disabled={settingsState.isLoading || isSavingSettings}
                      >
                        <option value="light">Light</option>
                        <option value="dark">Dark</option>
                      </select>
                    </div>
                    <div className="canvas-workspace__field">
                      <label htmlFor="canvas-theme-accent">Accent color</label>
                      <input
                        id="canvas-theme-accent"
                        type="color"
                        value={settings.themeTokens.accentColor}
                        onChange={handleThemeTokenChange('accentColor')}
                        disabled={settingsState.isLoading || isSavingSettings}
                      />
                    </div>
                    <div className="canvas-workspace__field">
                      <label htmlFor="canvas-theme-background">Surface background</label>
                      <input
                        id="canvas-theme-background"
                        type="text"
                        value={settings.themeTokens.background}
                        onChange={handleThemeTokenChange('background')}
                        disabled={settingsState.isLoading || isSavingSettings}
                        placeholder="soft-gradient"
                      />
                    </div>
                    <div className="canvas-workspace__field">
                      <label htmlFor="canvas-workspace-header-style">Header style</label>
                      <select
                        id="canvas-workspace-header-style"
                        value={settings.workspace.headerStyle}
                        onChange={handleWorkspacePreferenceChange('headerStyle')}
                        disabled={settingsState.isLoading || isSavingSettings}
                      >
                        <option value="centered-logo">Centered logo</option>
                        <option value="split-navigation">Split navigation</option>
                        <option value="minimal">Minimal</option>
                      </select>
                    </div>
                    <div className="canvas-workspace__field canvas-workspace__field--toggle">
                      <label htmlFor="canvas-workspace-announcement">Announcement banner</label>
                      <input
                        id="canvas-workspace-announcement"
                        type="checkbox"
                        checked={settings.workspace.showAnnouncement}
                        onChange={handleWorkspaceToggle('showAnnouncement')}
                        disabled={settingsState.isLoading || isSavingSettings}
                      />
                    </div>
                  </div>
                  {settingsError ? (
                    <p className="canvas-workspace__form-error" role="alert">
                      {settingsError}
                    </p>
                  ) : null}
                  {isSavingSettings ? (
                    <p className="canvas-workspace__publish-note" aria-live="polite">
                      Saving workspace settings...
                    </p>
                  ) : null}
                </section>
              ) : null}
              {isNavigatorOpen || isThemePanelOpen ? (
                <div className="canvas-workspace__panel-spacer" aria-hidden="true" />
              ) : null}
            </div>

            <div className="canvas-surface-region" aria-label="Canvas composition surface">
              <div className="canvas-surface-region__surface">
                <header className="canvas-surface-region__header">
                  <div className="canvas-surface-region__heading">
                    <p className="canvas-surface-region__eyebrow">Live surface</p>
                    <h2 className="canvas-surface-region__title">
                      {activeScreen ? `${activeScreen.name} surface` : 'Drag & drop surface'}
                    </h2>
                    <p className="canvas-surface-region__subtitle">
                      Drag components or layout primitives onto the surface to compose this screen.
                    </p>
                  </div>
                  <div className="canvas-workspace__component-card" aria-live="polite">
                    <span className="canvas-workspace__component-chip">{activeComponentChip}</span>
                    <strong className="canvas-workspace__component-card-title">{activeComponentLabel}</strong>
                    <p className="canvas-workspace__component-card-description">{activeComponentDescription}</p>
                  </div>
                </header>
                {canvasStatusMessage ? (
                  canvasStatusMessage.variant === 'error' ? (
                    <p className="canvas-surface-region__status canvas-surface-region__status--error" role="alert">
                      {canvasStatusMessage.text}
                    </p>
                  ) : (
                    <p className="canvas-surface-region__status">{canvasStatusMessage.text}</p>
                  )
                ) : null}
                <CanvasArtboard
                  canvasState={canvasState}
                  onInsertNode={handleInsertNode}
                  onSelectNode={handleSelectNode}
                  selectionId={canvasState.selectionId}
                />
              </div>
              <aside className="canvas-workspace__primitive-drawer" aria-label="Layout primitives">
                <h3>Layout primitives</h3>
                <p>Use these structures to stage components before publishing.</p>
                <ul className="canvas-workspace__primitive-list">
                  {layoutPrimitives.map((primitive) => (
                    <li key={primitive.id} className="canvas-workspace__primitive">
                      <span className="canvas-workspace__primitive-badge">{primitive.badge}</span>
                      <div>
                        <strong>{primitive.label}</strong>
                        <p>{primitive.description}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </aside>
            </div>

            <div className={`canvas-workspace__create-screen-layer${isCreateScreenOpen ? ' is-open' : ''}`}>
              {isCreateScreenOpen ? (
                <form className="canvas-workspace__create-screen" onSubmit={handleCreateScreen}>
                  <div className="canvas-workspace__field">
                    <label htmlFor="new-screen-name">Screen name</label>
                    <input
                      id="new-screen-name"
                      name="name"
                      type="text"
                      value={newScreenForm.name}
                      onChange={handleCreateScreenFieldChange('name')}
                      placeholder="eg. Checkout"
                    />
                  </div>
                  <div className="canvas-workspace__field">
                    <label htmlFor="new-screen-device">Device</label>
                    <select
                      id="new-screen-device"
                      name="device"
                      value={newScreenForm.device}
                      onChange={handleCreateScreenFieldChange('device')}
                    >
                      <option>Desktop</option>
                      <option>Tablet</option>
                      <option>Mobile</option>
                      <option>TV</option>
                    </select>
                  </div>
                  <div className="canvas-workspace__field canvas-workspace__field--wide">
                    <label htmlFor="new-screen-description">Description</label>
                    <input
                      id="new-screen-description"
                      name="description"
                      type="text"
                      value={newScreenForm.description}
                      onChange={handleCreateScreenFieldChange('description')}
                      placeholder="Optional description to help the team"
                    />
                  </div>
                  {createScreenError ? (
                    <p className="canvas-workspace__form-error" role="alert">
                      {createScreenError}
                    </p>
                  ) : null}
                  <div className="canvas-workspace__form-actions">
                    <button
                      type="submit"
                      className="canvas-workspace__header-button"
                      disabled={isCreatingScreen}
                    >
                      {isCreatingScreen ? 'Creating…' : 'Create screen'}
                    </button>
                    <button type="button" className="canvas-workspace__link-button" onClick={handleToggleCreateScreen}>
                      Cancel
                    </button>
                  </div>
                </form>
              ) : null}
            </div>

            <CanvasScreenSelector
              screens={screens}
              selectedScreenId={activeScreen?.id ?? ''}
              onSelectScreen={setSelectedScreenId}
            />

            <div className="editor-home__status-stack">
              <section
                className={`ui-editor__status editor-home__status-panel ui-editor__status--${status.phase === 'idle' ? 'loading' : status.phase}`}
                aria-live="polite"
              >
                <strong>Status:</strong> {status.message}
              </section>

              <section
                className={`canvas-workspace__publish-status canvas-workspace__publish-status--${publishState.status}`}
                aria-live="polite"
              >
                <div className="canvas-workspace__publish-status-message">{publishState.message}</div>
                {publishMeta ? (
                  <dl className="canvas-workspace__publish-meta">
                    <div>
                      <dt>Generated</dt>
                      <dd>{formatPublishTimestamp(publishMeta.generatedAt)}</dd>
                    </div>
                    <div>
                      <dt>Routes</dt>
                      <dd>{publishMeta.routeCount ?? '--'}</dd>
                    </div>
                    <div>
                      <dt>Screens</dt>
                      <dd>{publishMeta.screenCount ?? '--'}</dd>
                    </div>
                    {publishMeta.routesUpdatedAt ? (
                      <div>
                        <dt>Routes updated</dt>
                        <dd>{formatPublishTimestamp(publishMeta.routesUpdatedAt)}</dd>
                      </div>
                    ) : null}
                  </dl>
                ) : null}
                {publishWrittenFiles.length ? (
                  <div className="canvas-workspace__publish-status-block">
                    <strong>Written files</strong>
                    <ul className="canvas-workspace__publish-status-list">
                      {publishWrittenFiles.map((filePath) => (
                        <li key={filePath}>{filePath}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {publishFailures.length ? (
                  <div className="canvas-workspace__publish-status-block">
                    <strong>Failures</strong>
                    <ul className="canvas-workspace__publish-status-list">
                      {publishFailures.map((failure, index) => {
                        const failureEntry =
                          failure && typeof failure === 'object' && !Array.isArray(failure)
                            ? failure
                            : { message: failure }
                        const key = failureEntry.file || failureEntry.directory || `failure-${index}`
                        return (
                          <li key={key}>
                            <span className="canvas-workspace__publish-failure-path">
                              {failureEntry.file || failureEntry.directory || 'Unknown destination'}
                            </span>
                            {failureEntry.message ? (
                              <span className="canvas-workspace__publish-failure-message"> -- {failureEntry.message}</span>
                            ) : null}
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                ) : null}
                {publishState.status === 'error' && publishInfo ? (
                  <div className="canvas-workspace__publish-status-block">
                    <strong>Details</strong>
                    {typeof publishInfo === 'object' ? (
                      <pre className="canvas-workspace__publish-note canvas-workspace__publish-note--pre">
                        {JSON.stringify(publishInfo, null, 2)}
                      </pre>
                    ) : (
                      <p className="canvas-workspace__publish-note">{String(publishInfo)}</p>
                    )}
                  </div>
                ) : null}
                {publishState.status === 'error' && publishStatusCode ? (
                  <div className="canvas-workspace__publish-status-block">
                    <strong>Status code</strong>
                    <p className="canvas-workspace__publish-note">{publishStatusCode}</p>
                  </div>
                ) : null}
                {publishState.status === 'error' && publishAvailableTargets.length ? (
                  <div className="canvas-workspace__publish-status-block">
                    <strong>Configured targets</strong>
                    <p className="canvas-workspace__publish-note">{publishAvailableTargets.join(', ')}</p>
                  </div>
                ) : null}
              </section>
            </div>

            <PropertiesPanel
              activeScreen={activeScreen}
              pageStyles={pageStyles}
              onPageStyleChange={handlePageStyleChange}
              component={activeComponent}
              onComponentChange={handleComponentChange}
              className="canvas-workspace__properties-panel"
            />
        </div>
      </div>
    </div>
      </div>
    </DndProvider>
  )
}







