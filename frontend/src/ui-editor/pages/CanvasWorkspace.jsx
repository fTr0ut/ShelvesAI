import { useEffect, useMemo, useState } from 'react'
import { fetchJson, getApiOrigin, getDefaultApiOrigin, resolveApiUrl } from '../api/client'
import ComponentLibraryPanel from '../components/ComponentLibraryPanel'
import SiteSettingsPanel from '../components/SiteSettingsPanel'
import ExperiencePreview from '../components/ExperiencePreview'
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
  device: 'desktop',
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
  const screenOptions = useMemo(
    () => [
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
    ],
    [],
  )
  const [selectedScreenId, setSelectedScreenId] = useState(screenOptions[0]?.id ?? '')
  const activeScreen = useMemo(
    () => screenOptions.find((option) => option.id === selectedScreenId) ?? screenOptions[0],
    [screenOptions, selectedScreenId],
  )
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

  const theme = useMemo(
    () => ({
      isDark: settings.colorScheme === 'dark',
      accentColor: settings.accentColor,
      backgroundClass: `${settings.colorScheme === 'dark' ? 'theme-dark' : 'theme-light'} ${settings.background}`,
    }),
    [settings.colorScheme, settings.accentColor, settings.background],
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
  }, [projectSettingsVersion])

  return (
    <div className="editor-home">
      <header className="editor-home__intro">
        <h1>Collector experience settings</h1>
        <p className="editor-home__lead">
          Configure the global presentation system for Collector before diving into collection-level layouts. These settings feed
          downstream canvases, ensuring both mobile and desktop experiences inherit a consistent tone.
        </p>
      </header>

      <CanvasScreenSelector
        screens={screenOptions}
        selectedScreenId={activeScreen?.id ?? ''}
        onSelectScreen={setSelectedScreenId}
      />

      <section
        className={`ui-editor__status ui-editor__status--${status.phase === 'idle' ? 'loading' : status.phase}`}
        aria-live="polite"
      >
        <strong>Status:</strong> {status.message}
        {status.meta && (
          <div className="ui-editor__meta">
            <pre>{JSON.stringify(status.meta, null, 2)}</pre>
          </div>
        )}
      </section>

      <section className="site-settings">
        <SiteSettingsPanel settings={settings} onChange={handleSettingChange} />
        <ExperiencePreview settings={settings} theme={theme} />
      </section>

      <section className="editor-home__roadmap">
        <h2>Next steps for the builder</h2>
        <ul>
          <li>Persist these global settings to the Collector API once endpoint contracts are finalised.</li>
          <li>Introduce canvas tooling that maps shelves and collectables onto responsive breakpoints.</li>
          <li>Wire preview panes to live content sources and expose publishing workflows.</li>
          <li>
            Point the editor at staging or local services by updating <strong>Project settings</strong> with your API base and
            endpoint catalogue.
          </li>
          <li>Introduce authenticated flows to persist editor layouts via the Collector API.</li>
          <li>Layer in canvas tooling for arranging shelves, collectables, and new UI primitives.</li>
          <li>Connect live preview panes to backend content using the shared data contracts.</li>
        </ul>
      </section>

      <ComponentLibraryPanel />
      <PropertiesPanel
        activeScreen={activeScreen}
        pageStyles={pageStyles}
        onPageStyleChange={handlePageStyleChange}
        component={activeComponent}
        onComponentChange={handleComponentChange}
      />
    </div>
  )
}
