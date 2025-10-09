import { Link } from 'react-router-dom'
import { uiEditorPath } from '../constants'
import { useProjectSettings } from '../lib/useProjectSettings'
import { getApiOrigin } from '../api/client'
import './EditorOverview.css'

export default function EditorOverview() {
  const settings = useProjectSettings()
  const apiBase = settings?.apiBase || getApiOrigin()
  const endpointCount = settings?.endpointMeta?.endpoints?.length ?? 0
  const authLabel = settings?.authMethod === 'api-token' ? 'API token' : 'Browser session'

  return (
    <div className="editor-overview">
      <header className="editor-overview__hero">
        <h1>Collector UI Builder</h1>
        <p className="editor-overview__lead">
          Chart the roadmap for your bespoke editor. Canvas now owns layout and site editing while this overview tracks
          environment health and next actions.
        </p>
        <div className="editor-overview__actions">
          <Link className="editor-overview__action editor-overview__action--primary" to={uiEditorPath('canvas')}>
            Open Canvas
          </Link>
          <Link className="editor-overview__action" to={uiEditorPath('routes')}>
            Review Routes
          </Link>
          <Link className="editor-overview__action" to={uiEditorPath('settings')}>
            Project Settings
          </Link>
        </div>
      </header>

      <section className="editor-overview__panel" aria-labelledby="editor-overview-status">
        <h2 id="editor-overview-status">Project snapshot</h2>
        <dl className="editor-overview__meta">
          <div>
            <dt>API base</dt>
            <dd>{apiBase}</dd>
          </div>
          <div>
            <dt>Auth mode</dt>
            <dd>{authLabel}</dd>
          </div>
          <div>
            <dt>Endpoints loaded</dt>
            <dd>{endpointCount > 0 ? endpointCount : 'None yet'}</dd>
          </div>
        </dl>
      </section>

      <section className="editor-overview__grid" aria-label="Editor modules">
        <article>
          <h3>Canvas</h3>
          <p>Design canvases, tune visual tokens, and preview experiences with the new dedicated workspace.</p>
          <Link className="editor-overview__link" to={uiEditorPath('canvas')}>
            Jump to Canvas ->
          </Link>
        </article>
        <article>
          <h3>Routes</h3>
          <p>Define navigation, stitch shelves together, and sync editor flows with backend route definitions.</p>
          <Link className="editor-overview__link" to={uiEditorPath('routes')}>
            Coordinate Routes ->
          </Link>
        </article>
        <article>
          <h3>Project settings</h3>
          <p>Configure API hosts, authentication, and endpoint catalogues for downstream tooling.</p>
          <Link className="editor-overview__link" to={uiEditorPath('settings')}>
            Configure Settings ->
          </Link>
        </article>
      </section>

      <section className="editor-overview__timeline">
        <h2>Latest builder changes</h2>
        <ul>
          <li><strong>Canvas workspace</strong> graduated into its own tab with all site editing tools.</li>
          <li>Navigation links are now absolute so deep routes stay stable during editing sessions.</li>
          <li>Next sprint: persist canvas state and wire previews to live Collector data sources.</li>
        </ul>
      </section>
    </div>
  )
}
