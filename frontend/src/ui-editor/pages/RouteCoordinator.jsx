import { useEffect, useMemo, useState } from 'react'
import { fetchRouteConfiguration, saveRouteConfiguration } from '../api/routes'
import './RouteCoordinator.css'

const createEmptyRoute = () => ({
  id: `route-${Date.now()}`,
  path: '',
  screenId: '',
})

const formatScreenOptionLabel = (screen) => {
  if (!screen) return ''
  const tokens = []
  if (screen.source === 'canvas') {
    tokens.push('Canvas')
    if (screen.status && screen.status !== 'published') {
      tokens.push(screen.status.charAt(0).toUpperCase() + screen.status.slice(1))
    }
  } else if (screen.projectName) {
    tokens.push(screen.projectName)
  } else if (screen.source === 'plasmic') {
    tokens.push('Plasmic')
  }

  const meta = tokens.length ? ` [${tokens.join(' • ')}]` : ''
  const path = screen.path ? ` (${screen.path})` : ''

  return `${screen.name || 'Untitled screen'}${path}${meta}`
}

const formatUpdatedAt = (value) => {
  if (!value) return null
  try {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return null
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date)
  } catch (err) {
    console.warn('[RouteCoordinator] Unable to format timestamp:', err)
    return null
  }
}

export default function RouteCoordinator() {
  const [loading, setLoading] = useState(true)
  const [routes, setRoutes] = useState([])
  const [savedRoutes, setSavedRoutes] = useState([])
  const [screens, setScreens] = useState([])
  const [canvasScreens, setCanvasScreens] = useState([])
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(null)
  const [updatedAt, setUpdatedAt] = useState(null)

  useEffect(() => {
    let mounted = true

    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const data = await fetchRouteConfiguration()
        if (!mounted) return
        const nextRoutes = Array.isArray(data?.routes) ? data.routes : []
        setRoutes(nextRoutes)
        setSavedRoutes(nextRoutes)
        setScreens(data?.availableScreens || [])
        setCanvasScreens(data?.canvasScreens || [])
        setUpdatedAt(data?.updatedAt || null)
      } catch (err) {
        if (!mounted) return
        setError(err?.message || 'Failed to load route configuration.')
      } finally {
        if (mounted) setLoading(false)
      }
    }

    load()

    return () => {
      mounted = false
    }
  }, [])

  const isDirty = useMemo(() => JSON.stringify(routes) !== JSON.stringify(savedRoutes), [routes, savedRoutes])

  const issues = useMemo(() => {
    const messages = new Set()
    const seenPaths = new Map()

    routes.forEach((route) => {
      const rawPath = typeof route?.path === 'string' ? route.path.trim() : ''
      const normalizedPath = rawPath.startsWith('/') ? rawPath : rawPath ? `/${rawPath.replace(/^\/+/, '')}` : ''

      if (!normalizedPath) {
        messages.add('All routes require a path.')
      }

      if (rawPath && !rawPath.startsWith('/')) {
        messages.add('Routes should start with a "/".')
      }

      if (!route?.screenId) {
        messages.add('Assign a screen to each route before saving.')
      }

      if (normalizedPath) {
        const existing = seenPaths.get(normalizedPath)
        if (typeof existing === 'number') {
          messages.add(`Duplicate route detected for path ${normalizedPath}.`)
        } else {
          seenPaths.set(normalizedPath, 1)
        }
      }
    })

    return Array.from(messages)
  }, [routes])

  const duplicatePaths = useMemo(() => {
    const counts = new Map()
    routes.forEach((route) => {
      const normalized = typeof route?.path === 'string' ? route.path.trim() : ''
      if (!normalized) return
      const key = normalized.startsWith('/') ? normalized : `/${normalized.replace(/^\/+/, '')}`
      counts.set(key, (counts.get(key) || 0) + 1)
    })
    return new Set(Array.from(counts.entries()).filter(([, count]) => count > 1).map(([key]) => key))
  }, [routes])

  const updateRoute = (index, next) => {
    setRoutes((current) =>
      current.map((route, idx) => {
        if (idx !== index) return route
        return { ...route, ...next }
      })
    )
  }

  const addRoute = () => {
    setRoutes((current) => [...current, createEmptyRoute()])
  }

  const removeRoute = (index) => {
    setRoutes((current) => current.filter((_, idx) => idx !== index))
  }

  const handleReset = () => {
    setRoutes(savedRoutes)
    setSuccess(null)
    setError(null)
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setSuccess(null)

    try {
      const response = await saveRouteConfiguration(routes)
      const nextRoutes = Array.isArray(response?.routes) ? response.routes : []
      setRoutes(nextRoutes)
      setSavedRoutes(nextRoutes)
      setScreens(response?.availableScreens || [])
      setCanvasScreens(response?.canvasScreens || [])
      setUpdatedAt(response?.updatedAt || null)
      setSuccess('Route mapping saved successfully.')
    } catch (err) {
      setError(err?.message || 'Failed to save route configuration.')
    } finally {
      setSaving(false)
    }
  }

  const formattedTimestamp = useMemo(() => formatUpdatedAt(updatedAt), [updatedAt])

  const rowIssues = useMemo(() => {
    return routes.map((route) => {
      const rawPath = typeof route?.path === 'string' ? route.path.trim() : ''
      const normalizedPath = rawPath ? (rawPath.startsWith('/') ? rawPath : `/${rawPath.replace(/^\/+/, '')}`) : ''
      const missingPath = !normalizedPath
      const missingScreen = !route?.screenId
      const pathIsDuplicate = normalizedPath && duplicatePaths.has(normalizedPath)
      const requiresSlash = Boolean(rawPath) && !rawPath.trim().startsWith('/')

      return { missingPath, missingScreen, pathIsDuplicate, requiresSlash }
    })
  }, [routes, duplicatePaths])

  return (
    <div className="route-coordinator">
      <header className="route-coordinator__intro">
        <div>
          <h1>Route &amp; Screen Coordinator</h1>
          <p>
            Map Collector routes to Plasmic screens so editors and previewers share a consistent navigation plan. Use this tool
            to assign the correct screen for each path exposed in the app shell.
          </p>
        </div>
        <div className="route-coordinator__meta">
          <span className="route-coordinator__badge">API integrated</span>
          <ul>
            <li><code>GET /api/ui-editor/routes</code></li>
            <li><code>PUT /api/ui-editor/routes</code></li>
            <li><code>GET /api/ui-editor/screens</code></li>
          </ul>
        </div>
      </header>

      {error && (
        <div className="ui-editor__status ui-editor__status--error" role="alert">
          {error}
        </div>
      )}
      {success && (
        <div className="ui-editor__status ui-editor__status--success" role="status">
          {success}
        </div>
      )}

      {formattedTimestamp && (
        <p className="route-coordinator__timestamp">Last updated: {formattedTimestamp}</p>
      )}

      <section className="route-coordinator__panel">
        <div className="route-coordinator__actions">
          <div className="route-coordinator__action-buttons">
            <button type="button" onClick={addRoute} className="route-coordinator__button route-coordinator__button--ghost">
              Add route
            </button>
            <button
              type="button"
              onClick={handleReset}
              disabled={!isDirty || saving}
              className="route-coordinator__button route-coordinator__button--ghost"
            >
              Reset changes
            </button>
          </div>
          <button
            type="button"
            className="route-coordinator__button route-coordinator__button--primary"
            onClick={handleSave}
            disabled={saving || !isDirty || issues.length > 0}
          >
            {saving ? 'Saving…' : 'Save routing'}
          </button>
        </div>

        {issues.length > 0 && (
          <div className="route-coordinator__issues" role="alert">
            <strong>Resolve the following before saving:</strong>
            <ul>
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </div>
        )}

        {loading ? (
          <div className="route-coordinator__loading">Loading current configuration…</div>
        ) : (
          <div className="route-coordinator__table" role="table" aria-label="Route to screen mapping">
            <div className="route-coordinator__table-row route-coordinator__table-row--head" role="row">
              <div role="columnheader">Route path</div>
              <div role="columnheader">Screen</div>
              <div role="columnheader" className="route-coordinator__column--actions">
                <span className="sr-only">Actions</span>
              </div>
            </div>
            {routes.length === 0 && (
              <div className="route-coordinator__empty" role="row">
                <div role="cell" colSpan={3}>
                  No routes configured yet. Use “Add route” to begin mapping screens.
                </div>
              </div>
            )}
            {routes.map((route, index) => {
              const screenOptions = screens
                .slice()
                .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
              const rowState = rowIssues[index] || {}
              const showPathWarning = rowState.missingPath || rowState.requiresSlash || rowState.pathIsDuplicate
              const showScreenWarning = rowState.missingScreen

              return (
                <div
                  className={`route-coordinator__table-row${showPathWarning || showScreenWarning ? ' route-coordinator__table-row--warning' : ''}`}
                  role="row"
                  key={route.id || `route-${index}`}
                >
                  <div role="cell" className="route-coordinator__field">
                    <label htmlFor={`route-path-${index}`}>Path</label>
                    <input
                      id={`route-path-${index}`}
                      type="text"
                      value={route.path || ''}
                      placeholder="/example"
                      onChange={(event) => updateRoute(index, { path: event.target.value })}
                      className={showPathWarning ? 'route-coordinator__input--warning' : ''}
                    />
                    {showPathWarning && (
                      <p className="route-coordinator__hint">
                        {rowState.missingPath && 'Provide a path for this route.'}
                        {!rowState.missingPath && rowState.requiresSlash && 'Paths should start with “/”.'}
                        {!rowState.missingPath && !rowState.requiresSlash && rowState.pathIsDuplicate && 'Path duplicates another entry.'}
                      </p>
                    )}
                  </div>

                  <div role="cell" className="route-coordinator__field">
                    <label htmlFor={`route-screen-${index}`}>Screen</label>
                    <select
                      id={`route-screen-${index}`}
                      value={route.screenId || ''}
                      onChange={(event) => updateRoute(index, { screenId: event.target.value })}
                      className={showScreenWarning ? 'route-coordinator__input--warning' : ''}
                    >
                      <option value="">Select a screen…</option>
                      {screenOptions.map((screen) => (
                        <option key={screen.id} value={screen.id}>
                          {formatScreenOptionLabel(screen)}
                        </option>
                      ))}
                    </select>
                    {showScreenWarning && <p className="route-coordinator__hint">Choose a target screen.</p>}
                  </div>

                  <div role="cell" className="route-coordinator__actions-cell">
                    <button
                      type="button"
                      className="route-coordinator__button route-coordinator__button--danger"
                      onClick={() => removeRoute(index)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      <section className="route-coordinator__catalog">
        <h2>Available screens</h2>
        <p className="route-coordinator__catalog-description">
          Screens sync automatically from <code>plasmic.json</code> and the Canvas workspace. Assign them to routes to expose the
          correct experiences in the Collector shell.
          {canvasScreens.length > 0 && (
            <>
              {' '}
              Currently tracking {canvasScreens.length} Canvas screen
              {canvasScreens.length === 1 ? '' : 's'}.
            </>
          )}
        </p>
        <div className="route-coordinator__screen-grid">
          {screens.length === 0 ? (
            <div className="route-coordinator__empty">No screens detected. Pull the latest Plasmic configuration to continue.</div>
          ) : (
            screens.map((screen) => (
              <article className="route-coordinator__screen-card" key={screen.id}>
                <header>
                  <h3>{screen.name}</h3>
                  {screen.projectName && <span className="route-coordinator__tag">{screen.projectName}</span>}
                  {screen.source === 'canvas' && (
                    <span className="route-coordinator__tag route-coordinator__tag--info">Canvas</span>
                  )}
                  {screen.source === 'canvas' && screen.status && (
                    <span className="route-coordinator__tag route-coordinator__tag--muted">
                      {screen.status === 'published'
                        ? 'Published'
                        : screen.status.charAt(0).toUpperCase() + screen.status.slice(1)}
                    </span>
                  )}
                </header>
                <dl>
                  <div>
                    <dt>Screen ID</dt>
                    <dd>
                      <code>{screen.id}</code>
                    </dd>
                  </div>
                  {screen.path && (
                    <div>
                      <dt>Suggested path</dt>
                      <dd>
                        <code>{screen.path}</code>
                      </dd>
                    </div>
                  )}
                  {screen.source === 'canvas' && screen.device && (
                    <div>
                      <dt>Device</dt>
                      <dd>{screen.device}</dd>
                    </div>
                  )}
                </dl>
              </article>
            ))
          )}
        </div>
      </section>
    </div>
  )
}

