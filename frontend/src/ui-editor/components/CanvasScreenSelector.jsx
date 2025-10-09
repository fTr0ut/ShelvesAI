import { useMemo } from 'react'
import './CanvasScreenSelector.css'

export default function CanvasScreenSelector({ screens, selectedScreenId, onSelectScreen }) {
  const groupedScreens = useMemo(() => {
    const groups = new Map()
    screens.forEach((screen) => {
      const key = screen.device || 'other'
      if (!groups.has(key)) {
        groups.set(key, [])
      }
      groups.get(key).push(screen)
    })
    return Array.from(groups.entries())
  }, [screens])

  if (!screens?.length) {
    return null
  }

  return (
    <div className="canvas-screen-selector" role="group" aria-label="Canvas screen selector">
      <div className="canvas-screen-selector__intro">
        <h2>Choose a screen to design</h2>
        <p>Select a target screen or breakpoint to focus the canvas and property controls.</p>
      </div>
      <div className="canvas-screen-selector__groups">
        {groupedScreens.map(([group, entries]) => (
          <div key={group} className="canvas-screen-selector__group">
            <span className="canvas-screen-selector__group-label">{group}</span>
            <div className="canvas-screen-selector__items">
              {entries.map((screen) => {
                const isActive = screen.id === selectedScreenId
                return (
                  <button
                    key={screen.id}
                    type="button"
                    className={`canvas-screen-selector__item${isActive ? ' canvas-screen-selector__item--active' : ''}`}
                    onClick={() => onSelectScreen(screen.id)}
                  >
                    <span className="canvas-screen-selector__item-name">{screen.name}</span>
                    <span className="canvas-screen-selector__item-meta">{screen.description}</span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
