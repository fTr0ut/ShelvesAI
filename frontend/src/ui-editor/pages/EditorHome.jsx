import { useEffect, useState } from 'react'
import { fetchJson, resolveApiUrl } from '../api/client'
import ComponentLibraryPanel from '../components/ComponentLibraryPanel'

const defaultStatus = {
  phase: 'idle',
  message: 'Ready to initialise editor.',
  meta: null,
}

export default function EditorHome() {
  const [status, setStatus] = useState(defaultStatus)

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
    <div>
      <h1>Welcome to the Collector UI Editor</h1>
      <p>
        This workspace will host the React-driven editor for building and arranging collection experiences. The current iteration
        establishes routing, layout chrome, and a health check against the Collector backend so future tools can rely on a stable
        foundation.
      </p>

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

      <section style={{ marginTop: '2.5rem' }}>
        <h2>Next steps</h2>
        <ul>
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
    </div>
  )
}
