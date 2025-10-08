import { useEffect, useMemo, useState } from 'react'
import { fetchJson, resolveApiUrl } from '../api/client'
import SiteSettingsPanel from '../components/SiteSettingsPanel'
import ExperiencePreview from '../components/ExperiencePreview'
import './EditorHome.css'

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

export default function EditorHome() {
  const [status, setStatus] = useState(defaultStatus)
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)

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

  useEffect(() => {
    let active = true

    const checkBackend = async () => {
      setStatus({ phase: 'loading', message: 'Checking Collector backend…', meta: null })
      try {
        const data = await fetchJson('/__debug', { method: 'GET' })
        if (!active) return
        setStatus({ phase: 'success', message: 'Backend reachable. Ready for editor features.', meta: data })
      } catch (error) {
        if (!active) return
        const endpoint = resolveApiUrl('/__debug')
        setStatus({
          phase: 'error',
          message: error?.message ? `Backend error: ${error.message}` : `Unable to reach backend at ${endpoint}`,
          meta: { endpoint },
        })
      }
    }

    checkBackend()

    return () => {
      active = false
    }
  }, [])

  return (
    <div className="editor-home">
      <header className="editor-home__intro">
        <h1>Collector experience settings</h1>
        <p className="editor-home__lead">
          Configure the global presentation system for Collector before diving into collection-level layouts. These settings feed
          downstream canvases, ensuring both mobile and desktop experiences inherit a consistent tone.
        </p>
      </header>

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
    </div>
  )
}
