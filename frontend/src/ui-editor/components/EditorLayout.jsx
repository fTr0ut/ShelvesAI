import { NavLink, Outlet } from 'react-router-dom'
import { uiEditorPath } from '../constants'
import { getApiOrigin } from '../api/client'
import './EditorLayout.css'

const navItems = [
  { label: 'Overview', to: '.' },
]

export default function EditorLayout() {
  const apiOrigin = getApiOrigin()

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
