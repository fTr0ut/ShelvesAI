import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DndProvider, HTML5Backend } from '../lib/simpleDnd'
import { fetchJson, getApiOrigin, getDefaultApiOrigin, resolveApiUrl } from '../api/client'
import { publishUiBundle } from '../api/routes'
import {
  createCanvasScreen,
  deleteCanvasScreen,
  fetchCanvasScreens,
  fetchCanvasSettings,
  updateCanvasSettings,
} from '../api/canvas'
import {
  createCanvasStateFromNodes,
  createEmptyCanvasState,
  getCanvasNodeChildren,
  getCanvasNodeDisplayName,
  getCanvasNodeMeta,
  selectCanvasNode,
  updateCanvasNode,
} from '../lib/canvasState'
import ComponentLibraryPanel from '../components/ComponentLibraryPanel'
import CanvasDropzone from '../components/CanvasDropzone'
import CanvasScreenSelector from '../components/CanvasScreenSelector'
import PropertiesPanel from '../components/PropertiesPanel'
import { useProjectSettings } from '../lib/useProjectSettings'
import { LIBRARY_ENTRY_KINDS } from '../lib/dnd'
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

const previewStyleAllowlist = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
  'textAlign',
  'color',
  'backgroundColor',
  'opacity',
  'padding',
  'borderRadius',
  'boxShadow',
]

const createInitialCanvasNodes = () =>
  canvasDropzoneBlueprints.reduce((accumulator, blueprint) => {
    accumulator[blueprint.id] = []
    return accumulator
  }, {})

const createCanvasNodeId = (prefix) =>
  `${prefix}-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`

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
  const [activeComponent, setActiveComponent] = useState({
    id: 'hero-heading',
    label: 'Hero heading',
    type: 'text',
    styles: {
      fontFamily: 'Bungee',
      fontSize: '44px',
      fontWeight: '600',
      lineHeight: '1.25',
      letterSpacing: '0',
      textAlign: 'left',
      color: '#ffffff',
      backgroundColor: '#1f2937',
      opacity: 1,
      width: 'auto',
      height: 'auto',
      display: 'block',
      margin: '0 0 24px',
      padding: '0',
      borderRadius: '12px',
      border: 'none',
      boxShadow: 'none',
    },
  })
  const [canvasNodes, setCanvasNodes] = useState(() => createInitialCanvasNodes())
  const [canvasState, setCanvasState] = useState(() => createEmptyCanvasState())
  const [isSidebarOpen, setSidebarOpen] = useState(false)
  const [activeSidebarTool, setActiveSidebarTool] = useState('component-loader')
  const [sidebarOffsetTop, setSidebarOffsetTop] = useState(0)
  const [isNavigatorOpen, setNavigatorOpen] = useState(false)
  const [isHeaderPanelOpen, setHeaderPanelOpen] = useState(false)
  const [isThemePanelOpen, setThemePanelOpen] = useState(false)
  const [navigatorSearch, setNavigatorSearch] = useState('')
  const [openNavigatorSections, setOpenNavigatorSections] = useState({
    currentScreens: true,
    pages: true,
    components: true,
    arenas: true,
  })
  const workspaceRef = useRef(null)
  const publishTargetInputId = 'ui-editor-publish-target'
  const isPublishing = publishState.status === 'pending'
  useEffect(() => {
    if (!activeScreen) {
      setCanvasState(createEmptyCanvasState())
      return
    }
    setCanvasState(createCanvasStateFromNodes(activeScreen.nodes || []))
  }, [activeScreen])

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

  const handleCanvasDrop = useCallback((zoneId, item) => {
    setCanvasNodes((previous) => {
      if (!zoneId) {
        return previous
      }

      if (item?.entryType === LIBRARY_ENTRY_KINDS.PRIMITIVE && item.primitive) {
        const next = { ...previous }
        const nextZoneNodes = [...(next[zoneId] || [])]
        nextZoneNodes.push({
          id: createCanvasNodeId(item.primitive.id),
          label: item.primitive.label,
          meta: item.primitive.description,
          icon: item.primitive.icon,
          badge: 'Primitive',
          source: LIBRARY_ENTRY_KINDS.PRIMITIVE,
          primitiveId: item.primitive.id,
        })
        next[zoneId] = nextZoneNodes
        return next
      }

      if (item?.nodeId) {
        const originZoneId = item.originZoneId
        if (!originZoneId || !previous[originZoneId]) {
          return previous
        }

        const sourceNodes = [...previous[originZoneId]]
        const nodeIndex = sourceNodes.findIndex((candidate) => candidate.id === item.nodeId)
        if (nodeIndex === -1) {
          return previous
        }

        const [movedNode] = sourceNodes.splice(nodeIndex, 1)
        const next = { ...previous }

        if (originZoneId === zoneId) {
          sourceNodes.push(movedNode)
          next[zoneId] = sourceNodes
        } else {
          const destinationNodes = [...(previous[zoneId] || [])]
          destinationNodes.push(movedNode)
          next[originZoneId] = sourceNodes
          next[zoneId] = destinationNodes
        }

        return next
      }

      return previous
    })
  }, [])

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

  const handleComponentChange = useCallback((nextComponent) => {
    if (!nextComponent?.id) {
      return
    }
    setCanvasState((previous) => updateCanvasNode(previous, nextComponent))
  }, [])

  const handleSelectNode = useCallback((nodeId) => {
    if (!nodeId) {
      return
    }
    setCanvasState((previous) => selectCanvasNode(previous, nodeId))
  }, [])

  const handleDropzoneKeyDown = useCallback(
    (nodeId, event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        handleSelectNode(nodeId)
      }
    },
    [handleSelectNode],
  )

  const renderNodeTree = (nodeId) => {
    const node = canvasState.nodes[nodeId]
    if (!node) {
      return null
    }
    const isActiveNode = canvasState.selectionId === nodeId
    const nodeMeta = getCanvasNodeMeta(node)
    const childEntries = getCanvasNodeChildren(canvasState, nodeId)

    return (
      <li key={nodeId} className="canvas-workspace__node-outline-item">
        <button
          type="button"
          className="canvas-workspace__node-outline-button"
          onClick={() => handleSelectNode(nodeId)}
          data-active={isActiveNode || undefined}
        >
          <span className="canvas-workspace__node-outline-label">
            {getCanvasNodeDisplayName(node)}
          </span>
          {nodeMeta ? (
            <span className="canvas-workspace__node-outline-meta">{nodeMeta}</span>
          ) : null}
          {node.slot ? (
            <span className="canvas-workspace__node-outline-slot">Slot: {node.slot}</span>
          ) : null}
        </button>
        {isActiveNode ? (
          <div className="canvas-workspace__component-preview" style={componentPreviewStyle}>
            <span className="canvas-workspace__component-preview-label">
              {getCanvasNodeDisplayName(node)}
            </span>
            <span className="canvas-workspace__component-preview-meta">
              {nodeMeta || 'Active node'}
            </span>
          </div>
        ) : null}
        {childEntries.length ? (
          <ul className="canvas-workspace__node-outline-children">
            {childEntries.map(({ node: child }) => renderNodeTree(child.id))}
          </ul>
        ) : null}
      </li>
    )
  }

  useEffect(() => {
    return () => {
      if (pageStylesSaveRef.current) {
        clearTimeout(pageStylesSaveRef.current)
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

    return [
      {
        id: 'currentScreens',
        label: 'Current screens',
        count: screenItems.length,
        items: screenItems,
      },
      {
        id: 'pages',
        label: 'Pages',
        count: 3,
        items: [
          { id: 'pages-home', title: 'Homepage', description: 'Entry point for collectors', onSelect: undefined },
          { id: 'pages-account', title: 'Account', description: 'Authenticated layout system', onSelect: undefined },
          { id: 'pages-collection', title: 'Collection', description: 'Gallery exploration canvas', onSelect: undefined },
        ],
      },
      {
        id: 'components',
        label: 'Components',
        count: 3,
        items: [
          { id: 'components-hero', title: 'Hero block', description: 'Headline, copy and CTA bundle', onSelect: undefined },
          { id: 'components-grid', title: 'Collection grid', description: 'Responsive grid with filters', onSelect: undefined },
          { id: 'components-footer', title: 'Footer set', description: 'Metadata, legal links and socials', onSelect: undefined },
        ],
      },
      {
        id: 'arenas',
        label: 'Arenas',
        count: 2,
        items: [
          { id: 'arenas-preview', title: 'Preview arena', description: 'Staging cluster for live QA', onSelect: undefined },
          { id: 'arenas-production', title: 'Production arena', description: 'Live configuration snapshot', onSelect: undefined },
        ],
      },
    ]
  }, [screens, selectedScreenId, handleSelectScreen])

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
                      <p className="canvas-workspace__navigator-eyebrow">Pages, Components, Arenas</p>
                      <h2>Workspace collections</h2>
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

            <section className="canvas-workspace__canvas" aria-label="Live screen canvas">
              <div className="canvas-workspace__canvas-header">
                <div className="canvas-workspace__canvas-heading">
                  <p className="canvas-workspace__canvas-eyebrow">Live preview</p>
                  <h2 className="canvas-workspace__canvas-title">
                    {activeScreen ? `${activeScreen.name} preview` : 'Design canvas'}
                  </h2>
                  <p className="canvas-workspace__canvas-subtitle">
                    Drag components and layout primitives from the library into the drop zones to assemble this
                    screen.
                  </p>
                </div>
                <div className="canvas-workspace__component-card" aria-live="polite">
                  <span className="canvas-workspace__component-chip">{activeComponentChip}</span>
                  <strong className="canvas-workspace__component-card-title">{activeComponentLabel}</strong>
                  <p className="canvas-workspace__component-card-description">{activeComponentDescription}</p>
                </div>
              </div>

              <div className="canvas-workspace__canvas-body">
                <div className="canvas-workspace__stage" role="presentation">
                  <div className="canvas-workspace__stage-frame">
                    <div className="canvas-workspace__stage-guides" aria-hidden="true" />
                    <div className="canvas-workspace__stage-artboard" style={stageArtboardStyle}>
                      <header className="canvas-workspace__stage-header">
                        <div>
                          <span className="canvas-workspace__stage-eyebrow">Screen device</span>
                          <strong>{activeScreen?.device ?? 'Canvas device'}</strong>
                        </div>
                        <div>
                          <span className="canvas-workspace__stage-eyebrow">Layout</span>
                          <strong>{stageLayoutLabel}</strong>
                        </div>
                      </header>
                      <div className="canvas-workspace__dropzones">
                        {canvasDropzoneBlueprints.map((blueprint) => (
                          <CanvasDropzone
                            key={blueprint.id}
                            blueprint={blueprint}
                            allNodes={canvasNodes}
                            nodes={canvasNodes[blueprint.id] || []}
                            onDropItem={handleCanvasDrop}
                            placeholder={blueprint.placeholder}
                            activeComponent={
                              blueprint.highlightActiveComponent ? activeComponent : null
                            }
                            activeComponentStyle={componentPreviewStyle}
                          />
                        ))}
                        {canvasState.rootIds.length ? (
                          canvasState.rootIds.map((nodeId) => {
                            const node = canvasState.nodes[nodeId]
                            if (!node) {
                              return null
                            }
                            const nodeMeta = getCanvasNodeMeta(node) || 'Root node ready for composition.'
                            const childEntries = getCanvasNodeChildren(canvasState, node.id)
                            const childCount = childEntries.length
                            const isActive = canvasState.selectionId === node.id
                            const nodeTree = renderNodeTree(node.id)

                            return (
                              <section
                                key={node.id}
                                className="canvas-workspace__dropzone"
                                aria-label={`${getCanvasNodeDisplayName(node)} drop zone`}
                              >
                                <div className="canvas-workspace__dropzone-header">
                                  <div>
                                    <h3>{getCanvasNodeDisplayName(node)}</h3>
                                    <p>{nodeMeta}</p>
                                  </div>
                                  <button
                                    type="button"
                                    className="canvas-workspace__dropzone-action"
                                    onClick={() => handleSelectNode(node.id)}
                                  >
                                    Inspect node
                                  </button>
                                </div>
                                <div
                                  className="canvas-workspace__dropzone-target"
                                  role="button"
                                  tabIndex={0}
                                  data-active={isActive || undefined}
                                  aria-label={`Select ${getCanvasNodeDisplayName(node)}`}
                                  onClick={() => handleSelectNode(node.id)}
                                  onKeyDown={(event) => handleDropzoneKeyDown(node.id, event)}
                                >
                                  <span className="canvas-workspace__dropzone-icon" aria-hidden="true">
                                    {isActive ? '●' : '+'}
                                  </span>
                                  <span className="canvas-workspace__dropzone-hint">
                                    {childCount
                                      ? `${childCount} direct ${childCount === 1 ? 'child' : 'children'}`
                                      : 'No children yet'}
                                  </span>
                                </div>
                                <div className="canvas-workspace__dropzone-preview">
                                  <ul className="canvas-workspace__node-outline">{nodeTree}</ul>
                                </div>
                              </section>
                            )
                          })
                        ) : (
                          <section className="canvas-workspace__dropzone" aria-label="Empty canvas drop zone">
                            <div className="canvas-workspace__dropzone-header">
                              <div>
                                <h3>No nodes yet</h3>
                                <p>Drag components or layout primitives into the canvas to begin.</p>
                              </div>
                            </div>
                            <div className="canvas-workspace__dropzone-target" role="button" tabIndex={0}>
                              <span className="canvas-workspace__dropzone-icon" aria-hidden="true">
                                +
                              </span>
                              <span className="canvas-workspace__dropzone-hint">Drop component to begin</span>
                            </div>
                            <p className="canvas-workspace__dropzone-placeholder">
                              Use the component library to populate this screen.
                            </p>
                          </section>
                        )}
                      </div>
                    </div>
                  </div>
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
            </section>

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
