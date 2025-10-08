import { useEffect, useMemo, useState } from 'react'
import {
  exportProjectSettings,
  resetProjectSettings,
  updateProjectSettings,
} from '../lib/projectSettings'
import { useProjectSettings } from '../lib/useProjectSettings'
import { getApiOrigin, getDefaultApiOrigin } from '../api/client'
import './ProjectSettings.css'

const stripTrailingSlash = (value) => value.replace(/\/+$/, '')

const buildDebugUrl = (candidate) => {
  if (!candidate) {
    return `${getApiOrigin()}/__debug`
  }
  const base = stripTrailingSlash(candidate)
  return `${base}/__debug`
}

const stringifyDocument = (document) => {
  if (!document) return ''
  try {
    return JSON.stringify(document, null, 2)
  } catch (error) {
    console.warn('Unable to stringify endpoint document', error)
    return ''
  }
}

export default function ProjectSettings() {
  const settings = useProjectSettings()
  const [apiBase, setApiBase] = useState(settings.apiBase)
  const [endpointJson, setEndpointJson] = useState(stringifyDocument(settings.endpointDocument))
  const [parseError, setParseError] = useState('')
  const [saveStatus, setSaveStatus] = useState({ phase: 'idle', message: '' })
  const [testStatus, setTestStatus] = useState({ phase: 'idle', message: '' })
  const defaultOrigin = useMemo(() => getDefaultApiOrigin(), [])

  useEffect(() => {
    setApiBase(settings.apiBase)
    setEndpointJson(stringifyDocument(settings.endpointDocument))
    setParseError('')
    setSaveStatus({ phase: 'idle', message: '' })
  }, [settings.apiBase, settings.endpointDocument, settings.version])

  const normalisedEndpoints = settings.endpointMeta?.endpoints ?? []

  const hasChanges = useMemo(() => {
    const trimmedBase = (apiBase || '').trim()
    const storedBase = (settings.apiBase || '').trim()
    if (trimmedBase !== storedBase) return true
    if ((endpointJson || '').trim() !== stringifyDocument(settings.endpointDocument).trim()) return true
    return false
  }, [apiBase, endpointJson, settings.apiBase, settings.endpointDocument])

  const handleFileUpload = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      setEndpointJson(text)
      setParseError('')
    } catch (error) {
      console.error('Unable to read file', error)
      setParseError('Unable to read selected file. Please try again.')
    } finally {
      event.target.value = ''
    }
  }

  const parseEndpointDocument = () => {
    const trimmed = (endpointJson || '').trim()
    if (!trimmed) return null
    try {
      return JSON.parse(trimmed)
    } catch (error) {
      setParseError(`Endpoint definition is not valid JSON: ${error.message}`)
      return undefined
    }
  }

  const handleSubmit = (event) => {
    event.preventDefault()
    setSaveStatus({ phase: 'loading', message: 'Saving project settings…' })
    setParseError('')

    const document = parseEndpointDocument()
    if (document === undefined) {
      setSaveStatus({ phase: 'error', message: 'Unable to save settings. Fix validation errors and try again.' })
      return
    }

    updateProjectSettings({
      apiBase: (apiBase || '').trim(),
      endpointDocument: document,
    })
    setSaveStatus({ phase: 'success', message: 'Settings saved locally for this browser.' })
  }

  const handleReset = () => {
    resetProjectSettings()
    setApiBase('')
    setEndpointJson('')
    setParseError('')
    setSaveStatus({ phase: 'success', message: 'Settings reset to defaults.' })
  }

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(exportProjectSettings(), null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'collector-project-settings.json'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const handleTestConnection = async () => {
    setTestStatus({ phase: 'loading', message: 'Checking backend availability…' })
    try {
      const candidate = (apiBase || '').trim()
      const url = buildDebugUrl(candidate)
      const response = await fetch(url, { method: 'GET', credentials: 'include' })
      if (!response.ok) {
        const body = await response.text()
        throw new Error(body || `Response returned status ${response.status}`)
      }
      setTestStatus({ phase: 'success', message: `Connected successfully to ${url}` })
    } catch (error) {
      setTestStatus({ phase: 'error', message: error.message || 'Unable to reach backend.' })
    }
  }

  return (
    <div className="project-settings">
      <header className="project-settings__header">
        <h1>Project settings</h1>
        <p>
          Configure how the UI editor talks to Collector services. Settings are stored locally so you can connect to staging
          environments or load API contracts from OpenAPI/JSON files while iterating on generated React code.
        </p>
      </header>

      <form className="project-settings__form" onSubmit={handleSubmit}>
        <section>
          <h2>Backend origin</h2>
          <p className="project-settings__hint">
            Override the API host used by the editor. Leave blank to fall back to the default environment ({defaultOrigin}).
          </p>
          <label className="project-settings__label" htmlFor="api-base-input">
            API base URL
          </label>
          <input
            id="api-base-input"
            type="url"
            placeholder="https://collector.example.com"
            value={apiBase}
            onChange={(event) => setApiBase(event.target.value)}
          />
          <div className="project-settings__actions">
            <button type="button" onClick={handleTestConnection} disabled={testStatus.phase === 'loading'}>
              {testStatus.phase === 'loading' ? 'Testing…' : 'Test connection'}
            </button>
            {testStatus.message && (
              <span className={`project-settings__status project-settings__status--${testStatus.phase}`}>
                {testStatus.message}
              </span>
            )}
          </div>
          <div className="project-settings__active">
            Active origin: <code>{getApiOrigin()}</code>
          </div>
        </section>

        <section>
          <h2>API endpoints</h2>
          <p className="project-settings__hint">
            Paste an endpoint definition (Collector JSON or OpenAPI). This enables generated React components to bind to known
            backend contracts and helps validate integration points.
          </p>
          <div className="project-settings__file">
            <label className="project-settings__button" htmlFor="endpoint-upload">
              Import from file
            </label>
            <input id="endpoint-upload" type="file" accept="application/json" onChange={handleFileUpload} />
            <button type="button" className="project-settings__button" onClick={handleExport}>
              Export current settings
            </button>
          </div>
          <textarea
            aria-label="Endpoint JSON"
            placeholder='{"endpoints":[{"method":"GET","path":"/api/items"}]}'
            value={endpointJson}
            onChange={(event) => {
              setEndpointJson(event.target.value)
              setParseError('')
            }}
          />
          {parseError && <p className="project-settings__status project-settings__status--error">{parseError}</p>}
        </section>

        <footer className="project-settings__footer">
          <button type="submit" className="project-settings__primary" disabled={!hasChanges || saveStatus.phase === 'loading'}>
            {saveStatus.phase === 'loading' ? 'Saving…' : hasChanges ? 'Save settings' : 'No changes'}
          </button>
          <button type="button" onClick={handleReset} className="project-settings__ghost">
            Reset to defaults
          </button>
          {saveStatus.message && (
            <span className={`project-settings__status project-settings__status--${saveStatus.phase}`}>
              {saveStatus.message}
            </span>
          )}
        </footer>
      </form>

      <section className="project-settings__preview">
        <h2>Endpoint catalogue</h2>
        {settings.endpointMeta?.format ? (
          <p className="project-settings__hint">
            Loaded <strong>{settings.endpointMeta.format}</strong> definition
            {settings.endpointMeta.title ? ` "${settings.endpointMeta.title}"` : ''}.
          </p>
        ) : (
          <p className="project-settings__hint">No API definition configured yet.</p>
        )}
        {normalisedEndpoints.length > 0 ? (
          <div className="project-settings__table" role="table">
            <div className="project-settings__row project-settings__row--head" role="row">
              <div role="columnheader">Method</div>
              <div role="columnheader">Path</div>
              <div role="columnheader">Summary</div>
            </div>
            {normalisedEndpoints.map((endpoint, index) => (
              <div className="project-settings__row" role="row" key={`${endpoint.method}-${endpoint.path}-${index}`}>
                <div role="cell" className={`project-settings__badge project-settings__badge--${endpoint.method.toLowerCase()}`}>
                  {endpoint.method}
                </div>
                <div role="cell" className="project-settings__code">
                  {endpoint.path}
                </div>
                <div role="cell">{endpoint.summary || endpoint.description || '—'}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="project-settings__empty">No endpoints detected yet.</div>
        )}
      </section>
    </div>
  )
}
