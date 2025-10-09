import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchJson, getApiOrigin, getDefaultApiOrigin, resolveApiUrl } from '../api/client'
import ComponentLibraryPanel from '../components/ComponentLibraryPanel'
import SiteSettingsPanel from '../components/SiteSettingsPanel'
import CanvasScreenSelector from '../components/CanvasScreenSelector'
import PropertiesPanel from '../components/PropertiesPanel'
import { useProjectSettings } from '../lib/useProjectSettings'
import './CanvasWorkspace.css'

const defaultStatus = {
  phase: 'idle',
  message: 'Ready to initialise editor.',
  meta: null,
}

const DEFAULT_SETTINGS = {
  colorScheme: 'light',
  accentColor: '#60a5fa',
  background: 'soft-gradient',
  headerStyle: 'centered-logo',
  footerStyle: 'minimal',
  showAnnouncement: true,
}

export default function CanvasWorkspace() {
  const projectSettings = useProjectSettings()
  const projectSettingsVersion = projectSettings?.version
  const [status, setStatus] = useState(defaultStatus)
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [screens, setScreens] = useState(() => [
    {
      id: 'home-desktop',
      name: 'Homepage',
      device: 'Desktop',
      description: '1440px wide, marketing hero focus',
    },
    {
      id: 'home-tablet',
      name: 'Homepage',
      device: 'Tablet',
      description: '768px breakpoint with stacked hero',
    },
    {
      id: 'home-mobile',
      name: 'Homepage',
      device: 'Mobile',
      description: 'Small screens and foldables',
    },
    {
      id: 'collection-desktop',
      name: 'Collection layout',
      device: 'Desktop',
      description: 'Grid forward browse experience',
    },
    {
      id: 'collection-mobile',
      name: 'Collection layout',
      device: 'Mobile',
      description: 'Vertical scroll list with filters',
    },
  ])
  const [selectedScreenId, setSelectedScreenId] = useState(() => screens[0]?.id ?? '')
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
  const [pageStyles, setPageStyles] = useState({
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
  const [isSidebarOpen, setSidebarOpen] = useState(false)
  const [activeSidebarTool, setActiveSidebarTool] = useState('component-loader')
  const [sidebarOffsetTop, setSidebarOffsetTop] = useState(0)
  const [isNavigatorOpen, setNavigatorOpen] = useState(false)
  const [navigatorSearch, setNavigatorSearch] = useState('')
  const [openNavigatorSections, setOpenNavigatorSections] = useState({
    currentScreens: true,
    pages: true,
    components: true,
    arenas: true,
  })
  const workspaceRef = useRef(null)

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

  const handleCreateScreen = (event) => {
    event.preventDefault()
    const trimmedName = newScreenForm.name.trim()
    if (!trimmedName) {
      setCreateScreenError('Please provide a screen name to continue.')
      return
    }

    const normalisedDevice = newScreenForm.device || 'Desktop'
    const normalise = (value) =>
      value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')

    const baseSlug = normalise(trimmedName) || 'screen'
    const deviceSlug = normalise(normalisedDevice) || 'device'
    const baseId = `${baseSlug}-${deviceSlug}`
    let candidateId = baseId
    let attempt = 1
    const existingIds = new Set(screens.map((screen) => screen.id))
    while (existingIds.has(candidateId)) {
      attempt += 1
      candidateId = `${baseId}-${attempt}`
    }

    const description = newScreenForm.description.trim() || `${normalisedDevice} layout`

    const nextScreen = {
      id: candidateId,
      name: trimmedName,
      device: normalisedDevice,
      description,
    }

    setScreens((previous) => [...previous, nextScreen])
    setSelectedScreenId(candidateId)
    setIsCreateScreenOpen(false)
    setNewScreenForm({ name: '', device: 'Desktop', description: '' })
    setCreateScreenError('')
  }

  const theme = useMemo(
    () => ({
      isDark: settings.colorScheme === 'dark',
      accentColor: settings.accentColor,
      backgroundClass: `${settings.colorScheme === 'dark' ? 'theme-dark' : 'theme-light'} ${settings.background}`,
    }),
    [settings.colorScheme, settings.accentColor, settings.background],
  )

  const navigatorSections = useMemo(
    () => [
      {
        id: 'currentScreens',
        label: 'Current Screens',
        count: screens.length,
        items: screens.map((screen) => ({
          id: screen.id,
          title: screen.name,
          badge: screen.device,
          description: screen.description,
          isActive: screen.id === selectedScreenId,
          onSelect: () => setSelectedScreenId(screen.id),
        })),
      },
      {
        id: 'pages',
        label: 'Pages',
        count: 3,
        items: [
          {
            id: 'welcome-flow',
            title: 'Welcome flow',
            badge: 'Experience',
            description: 'Entry points for new collectors.',
          },
          {
            id: 'collection-deep-dive',
            title: 'Collection deep dive',
            badge: 'Editorial',
            description: 'Long-form narratives for featured drops.',
          },
          {
            id: 'curator-handbook',
            title: 'Curator handbook',
            badge: 'Internal',
            description: 'Guidelines and tooling references.',
          },
        ],
      },
      {
        id: 'components',
        label: 'Components',
        count: 5,
        items: [
          {
            id: 'hero-banner',
            title: 'Hero banner',
            badge: 'Layout',
            description: 'Primary attention grabber.',
          },
          {
            id: 'collection-grid',
            title: 'Collection grid',
            badge: 'UI kit',
            description: 'Responsive gallery with filters.',
          },
          {
            id: 'story-card',
            title: 'Story card',
            badge: 'Content',
            description: 'Narrative block for creator stories.',
          },
          {
            id: 'cta-panel',
            title: 'CTA panel',
            badge: 'Marketing',
            description: 'High-conversion call to action layout.',
          },
          {
            id: 'footer-cluster',
            title: 'Footer cluster',
            badge: 'System',
            description: 'Global links and social proof.',
          },
        ],
      },
      {
        id: 'arenas',
        label: 'Arenas',
        count: 4,
        items: [
          {
            id: 'spotlight',
            title: 'Spotlight arena',
            badge: 'Live',
            description: 'Realtime showcase for active drops.',
          },
          {
            id: 'archive',
            title: 'Archive arena',
            badge: 'Reference',
            description: 'Back-catalogue exploration space.',
          },
          {
            id: 'community',
            title: 'Community arena',
            badge: 'Social',
            description: 'Collector-to-collector collaborations.',
          },
          {
            id: 'immersive',
            title: 'Immersive arena',
            badge: 'Spatial',
            description: '360° storytelling experiences.',
          },
        ],
      },
    ],
    [screens, selectedScreenId],
  )

  const handleSettingChange = (name, value) => {
    setSettings((prev) => ({
      ...prev,
      [name]: value,
    }))
  }

  const handlePageStyleChange = (nextStyles) => {
    setPageStyles(nextStyles)
  }

  const handleComponentChange = (nextComponent) => {
    setActiveComponent(nextComponent)
  }

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
          message: `Backend reachable at ${origin}. Ready for editor features.`,
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
              <div className="canvas-workspace__header-left">
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
                <button
                  type="button"
                  className="canvas-workspace__navigator-toggle"
                  onClick={toggleNavigator}
                  aria-expanded={isNavigatorOpen}
                  aria-controls="canvas-workspace-navigator-panel"
                  data-expanded={isNavigatorOpen}
                >
                  {isNavigatorOpen ? 'Hide workspace navigator' : 'Show workspace navigator'}
                </button>
              </div>
              <div className="canvas-workspace__header-controls">
                <label className="canvas-workspace__header-select">
                  <span className="canvas-workspace__header-select-label">Switch screen</span>
                  <select value={selectedScreenId} onChange={(event) => handleSelectScreen(event.target.value)}>
                    {screens.map((screen) => (
                      <option key={screen.id} value={screen.id}>
                        {screen.name} · {screen.device}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="canvas-workspace__header-button"
                  onClick={handleToggleCreateScreen}
                  aria-expanded={isCreateScreenOpen}
                >
                  {isCreateScreenOpen ? 'Close' : 'New screen'}
                </button>
              </div>
            </header>

            <div className="canvas-workspace__navigator">
              {isNavigatorOpen ? (
                <aside
                  id="canvas-workspace-navigator-panel"
                  className="canvas-workspace__navigator-panel"
                  aria-label="Workspace navigator"
                >
                  <div className="canvas-workspace__navigator-header">
                    <div>
                      <p className="canvas-workspace__navigator-eyebrow">Pages, Components, Arenas</p>
                      <h2>Workspace collections</h2>
                    </div>
                    <button type="button" className="canvas-workspace__navigator-new">New</button>
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
            </div>

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
                  <button type="submit" className="canvas-workspace__header-button">
                    Create screen
                  </button>
                  <button type="button" className="canvas-workspace__link-button" onClick={handleToggleCreateScreen}>
                    Cancel
                  </button>
                </div>
              </form>
            ) : null}

            <CanvasScreenSelector
              screens={screens}
              selectedScreenId={activeScreen?.id ?? ''}
              onSelectScreen={setSelectedScreenId}
            />

          </div>

          <section className="site-settings">
            <SiteSettingsPanel settings={settings} onChange={handleSettingChange} />
          </section>

          <section
            className={`ui-editor__status editor-home__status-panel ui-editor__status--${status.phase === 'idle' ? 'loading' : status.phase}`}
            aria-live="polite"
          >
            <strong>Status:</strong> {status.message}
          </section>

          <PropertiesPanel
            activeScreen={activeScreen}
            pageStyles={pageStyles}
            onPageStyleChange={handlePageStyleChange}
            component={activeComponent}
            onComponentChange={handleComponentChange}
          />
        </div>
      </div>
    </div>
  )
}
