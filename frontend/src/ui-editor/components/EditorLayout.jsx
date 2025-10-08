import { NavLink, Outlet } from 'react-router-dom'
import { uiEditorPath } from '../constants'
import { getApiOrigin } from '../api/client'
import { useProjectSettings } from '../lib/useProjectSettings'
import './EditorLayout.css'

const navItems = [
  { label: 'Overview', to: '.' },
  { label: 'Routes', to: 'routes' },
  { label: 'Project settings', to: 'settings' },
]

export default function EditorLayout() {
  const settings = useProjectSettings()
  const apiOrigin = settings?.apiBase ? settings.apiBase : getApiOrigin()

  return (
    <div className="ui-editor">
      <header className="ui-editor__header">
        <a className="ui-editor__brand" href={uiEditorPath()}>
          Collector UI Editor
        </a>
        <nav className="ui-editor__nav">
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === '.'}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="ui-editor__nav" style={{ fontSize: '0.8rem', opacity: 0.85 }}>
          API: {apiOrigin}
        </div>
      </header>
      <div className="ui-editor__content">
        <Outlet />
      </div>
    </div>
  )
}
