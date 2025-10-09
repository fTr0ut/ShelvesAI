import { useEffect, useMemo, useState } from 'react'
import {
  AUTH_METHODS,
  exportProjectSettings,
  resetProjectSettings,
  updateProjectSettings,
} from '../lib/projectSettings'
import { useProjectSettings } from '../lib/useProjectSettings'
import { getApiOrigin, getDefaultApiOrigin } from '../api/client'
import {
  buildDebugUrl,
  stringifyDocument,
  validateTargetInput,
} from './projectSettingsHelpers'
import './ProjectSettings.css'

const looksLikeProjectSettingsExport = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const recognisedKeys = [
    'apiBase',
    'endpointDocument',
    'authMethod',
    'authToken',
    'previewTarget',
    'productionTarget',
    'updatedAt',
  ]
  return recognisedKeys.some((key) => Object.prototype.hasOwnProperty.call(value, key))
}

export default function ProjectSettings() {
  const settings = useProjectSettings()
  const [apiBase, setApiBase] = useState(settings.apiBase)
  const [endpointJson, setEndpointJson] = useState(stringifyDocument(settings.endpointDocument))
  const [authMethod, setAuthMethod] = useState(settings.authMethod)
  const [authToken, setAuthToken] = useState(settings.authToken)
  const [previewTarget, setPreviewTarget] = useState(settings.previewTarget)
  const [productionTarget, setProductionTarget] = useState(settings.productionTarget)
  const [parseError, setParseError] = useState('')
  const [saveStatus, setSaveStatus] = useState({ phase: 'idle', message: '' })
  const [testStatus, setTestStatus] = useState({ phase: 'idle', message: '' })
  const [targetErrors, setTargetErrors] = useState({ preview: '', production: '' })
  const defaultOrigin = useMemo(() => getDefaultApiOrigin(), [])

  useEffect(() => {
    setApiBase(settings.apiBase)
    setEndpointJson(stringifyDocument(settings.endpointDocument))
    setAuthMethod(settings.authMethod)
    setAuthToken(settings.authToken)
    setPreviewTarget(settings.previewTarget)
    setProductionTarget(settings.productionTarget)
    setParseError('')
    setTargetErrors({
      preview: validateTargetInput(settings.previewTarget),
      production: validateTargetInput(settings.productionTarget),
    })
  }, [
    settings.apiBase,
    settings.authMethod,
    settings.authToken,
    settings.endpointDocument,
    settings.previewTarget,
    settings.productionTarget,
    settings.version,
  ])

  const normalisedEndpoints = settings.endpointMeta?.endpoints ?? []

  const hasChanges = useMemo(() => {
    const trimmedBase = (apiBase || '').trim()
    const storedBase = (settings.apiBase || '').trim()
    if (trimmedBase !== storedBase) return true
    if ((endpointJson || '').trim() !== stringifyDocument(settings.endpointDocument).trim()) return true
    if (authMethod !== settings.authMethod) return true
    const trimmedToken = authMethod === AUTH_METHODS.API_TOKEN ? authToken.trim() : ''
    const storedToken =
      settings.authMethod === AUTH_METHODS.API_TOKEN ? (settings.authToken || '').trim() : ''
    if (trimmedToken !== storedToken) return true
    if ((previewTarget || '').trim() !== (settings.previewTarget || '').trim()) return true
    if ((productionTarget || '').trim() !== (settings.productionTarget || '').trim()) return true
    return false
  }, [
    apiBase,
    endpointJson,
    authMethod,
    authToken,
    previewTarget,
    productionTarget,
    settings.apiBase,
    settings.authMethod,
    settings.authToken,
    settings.endpointDocument,
    settings.previewTarget,
    settings.productionTarget,
  ])

  const handleFileUpload = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      try {
        const parsed = JSON.parse(text)
        if (looksLikeProjectSettingsExport(parsed)) {
          const nextAuthMethod =
            parsed.authMethod === AUTH_METHODS.API_TOKEN ? AUTH_METHODS.API_TOKEN : AUTH_METHODS.BROWSER_SESSION
          setApiBase(parsed.apiBase ?? '')
          setEndpointJson(stringifyDocument(parsed.endpointDocument))
          setAuthMethod(nextAuthMethod)
          setAuthToken(nextAuthMethod === AUTH_METHODS.API_TOKEN ? parsed.authToken ?? '' : '')
          setPreviewTarget(parsed.previewTarget ?? '')
          setProductionTarget(parsed.productionTarget ?? '')
          setTargetErrors({
            preview: validateTargetInput(parsed.previewTarget),
            production: validateTargetInput(parsed.productionTarget),
          })
          setParseError('')
          setSaveStatus({
            phase: 'success',
            message: 'Imported project settings from file. Review values and save to apply.',
          })
          return
        }
        setEndpointJson(JSON.stringify(parsed, null, 2))
        setParseError('')
      } catch (error) {
        setEndpointJson(text)
        setParseError('')
      }
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

  const handleSubmit = async (event) => {
    event.preventDefault()
    setSaveStatus({ phase: 'loading', message: 'Saving project settings…' })
    setParseError('')

    const document = parseEndpointDocument()
    if (document === undefined) {
      setSaveStatus({ phase: 'error', message: 'Unable to save settings. Fix validation errors and try again.' })
      return
    }

    const previewError = validateTargetInput(previewTarget)
    const productionError = validateTargetInput(productionTarget)
    setTargetErrors({ preview: previewError, production: productionError })
    if (previewError || productionError) {
      setSaveStatus({
        phase: 'error',
        message: 'Review the front-end targets before saving.',
      })
      return
    }

    try {
      await updateProjectSettings({
        apiBase: (apiBase || '').trim(),
        endpointDocument: document,
        authMethod,
        authToken: authMethod === AUTH_METHODS.API_TOKEN ? authToken.trim() : '',
        previewTarget: (previewTarget || '').trim(),
        productionTarget: (productionTarget || '').trim(),
      })
      setSaveStatus({ phase: 'success', message: 'Project settings saved.' })
    } catch (error) {
      setSaveStatus({
        phase: 'error',
        message: error.message || 'Unable to save project settings. Fix any issues and try again.',
      })
    }
  }

  const handleReset = async () => {
    const previous = {
      apiBase,
      endpointJson,
      authMethod,
      authToken,
      previewTarget,
      productionTarget,
    }
    setSaveStatus({ phase: 'loading', message: 'Resetting project settings…' })
    setApiBase('')
    setEndpointJson('')
    setAuthMethod(AUTH_METHODS.BROWSER_SESSION)
    setAuthToken('')
    setPreviewTarget('')
    setProductionTarget('')
    setParseError('')
    setTargetErrors({ preview: '', production: '' })
    try {
      await resetProjectSettings()
      setSaveStatus({ phase: 'success', message: 'Settings reset to defaults.' })
    } catch (error) {
      console.error('Unable to reset project settings', error)
      setSaveStatus({
        phase: 'error',
        message: error.message || 'Unable to reset project settings. Try again later.',
      })
      setApiBase(previous.apiBase)
      setEndpointJson(previous.endpointJson)
      setAuthMethod(previous.authMethod)
      setAuthToken(previous.authToken)
      setPreviewTarget(previous.previewTarget)
      setProductionTarget(previous.productionTarget)
    }
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
      const url = buildDebugUrl(candidate, getApiOrigin)
      const headers = {}
      if (authMethod === AUTH_METHODS.API_TOKEN) {
        const token = authToken.trim()
        if (!token) {
          setTestStatus({ phase: 'error', message: 'Provide an API token before testing the connection.' })
          return
        }
        headers.Authorization = `Bearer ${token}`
      }
      const response = await fetch(url, { method: 'GET', credentials: 'include', headers })
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
          Configure how the UI editor talks to Collector services. Settings persist for the project so you can share API
          contracts, authentication, and publish targets while iterating on generated React code.
        </p>
      </header>

      {(settings.isHydrating || settings.hydrationError) && (
        <div
          className={`project-settings__status project-settings__status--${
            settings.isHydrating ? 'loading' : 'error'
          }`}
        >
          {settings.isHydrating
            ? 'Loading saved project settings…'
            : `Unable to load saved settings: ${settings.hydrationError}`}
        </div>
      )}

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
          <div className="project-settings__active">
            Preview target: <code>{settings.previewTarget || 'Not configured'}</code>
          </div>
          <div className="project-settings__active">
            Production target: <code>{settings.productionTarget || 'Not configured'}</code>
          </div>
        </section>

        <section>
          <h2>Authentication</h2>
          <p className="project-settings__hint">
            Define how the editor authenticates with Collector services while previewing endpoints and generated code.
          </p>
          <div className="project-settings__options">
            <label
              className={`project-settings__option ${
                authMethod === AUTH_METHODS.BROWSER_SESSION ? 'project-settings__option--active' : ''
              }`}
            >
              <input
                type="radio"
                name="auth-method"
                value={AUTH_METHODS.BROWSER_SESSION}
                checked={authMethod === AUTH_METHODS.BROWSER_SESSION}
                onChange={() => setAuthMethod(AUTH_METHODS.BROWSER_SESSION)}
              />
              <div>
                <div className="project-settings__option-title">Use browser session</div>
                <p className="project-settings__hint">
                  Reuse your existing Collector login session. Ideal when working in environments where the UI builder can
                  share browser cookies with the API.
                </p>
              </div>
            </label>
            <label
              className={`project-settings__option ${
                authMethod === AUTH_METHODS.API_TOKEN ? 'project-settings__option--active' : ''
              }`}
            >
              <input
                type="radio"
                name="auth-method"
                value={AUTH_METHODS.API_TOKEN}
                checked={authMethod === AUTH_METHODS.API_TOKEN}
                onChange={() => setAuthMethod(AUTH_METHODS.API_TOKEN)}
              />
              <div>
                <div className="project-settings__option-title">Bearer token</div>
                <p className="project-settings__hint">
                  Provide a static API token that will be sent as an <code>Authorization</code> header on every request.
                </p>
              </div>
            </label>
          </div>
          {authMethod === AUTH_METHODS.API_TOKEN && (
            <>
              <label className="project-settings__label" htmlFor="auth-token-input">
                API token
              </label>
              <input
                id="auth-token-input"
                type="password"
                autoComplete="off"
                placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                value={authToken}
                onChange={(event) => setAuthToken(event.target.value)}
              />
              <p className="project-settings__hint">
                Tokens are stored locally in this browser and included as <code>Authorization: Bearer TOKEN</code> when the UI
                builder talks to the API.
              </p>
            </>
          )}
        </section>

        <section>
          <h2>Front-end publish targets</h2>
          <p className="project-settings__hint">
            Choose where generated assets should be deployed. Enter a directory path for local exports (for example{' '}
            <code>./build</code>) or an HTTPS host for remote targets.
          </p>
          <label className="project-settings__label" htmlFor="preview-target-input">
            Preview / staging destination
          </label>
          <input
            id="preview-target-input"
            type="text"
            placeholder="./dist/preview or https://preview.example.com"
            value={previewTarget}
            onChange={(event) => {
              const value = event.target.value
              setPreviewTarget(value)
              setTargetErrors((current) => ({ ...current, preview: validateTargetInput(value) }))
            }}
          />
          {targetErrors.preview && (
            <span className="project-settings__status project-settings__status--error">{targetErrors.preview}</span>
          )}

          <label className="project-settings__label" htmlFor="production-target-input">
            Production destination
          </label>
          <input
            id="production-target-input"
            type="text"
            placeholder="./dist/live or https://app.example.com"
            value={productionTarget}
            onChange={(event) => {
              const value = event.target.value
              setProductionTarget(value)
              setTargetErrors((current) => ({ ...current, production: validateTargetInput(value) }))
            }}
          />
          {targetErrors.production && (
            <span className="project-settings__status project-settings__status--error">{targetErrors.production}</span>
          )}
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
          <button
            type="submit"
            className="project-settings__primary"
            disabled={!hasChanges || saveStatus.phase === 'loading' || settings.isSaving}
          >
            {saveStatus.phase === 'loading' || settings.isSaving
              ? 'Saving…'
              : hasChanges
                ? 'Save settings'
                : 'No changes'}
          </button>
          <button
            type="button"
            onClick={handleReset}
            className="project-settings__ghost"
            disabled={saveStatus.phase === 'loading' || settings.isSaving}
          >
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
