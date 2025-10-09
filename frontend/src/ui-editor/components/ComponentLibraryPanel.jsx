import { useState } from 'react'
import {
  assignComponentBinding,
  clearComponentBinding,
} from '../lib/componentBindings'
import {
  getComponentById,
  getSurfaceSlot,
  makeSlotKey,
} from '../lib/componentLoader'
import { useComponentBinding } from '../lib/useComponentBinding'
import { useComponentLibrary } from '../lib/useComponentLibrary'
import './ComponentLibraryPanel.css'

const DEMO_TARGET = Object.freeze({ surfaceId: 'button', slotId: 'action', nodeId: 'demo-button' })

const capabilityLabels = {
  action: 'Action',
  query: 'Data fetch',
}

const primitiveComponents = [
  {
    id: 'form',
    label: 'Form',
    description: 'Collect input with grouped fields, validation, and submission states.',
    icon: '📝',
  },
  {
    id: 'columns',
    label: 'Columns',
    description: 'Lay out content side-by-side with fixed or fluid column widths.',
    icon: '⬛',
  },
  {
    id: 'button',
    label: 'Button',
    description: 'Trigger actions or submit forms with consistent styling.',
    icon: '🔘',
  },
  {
    id: 'text-field',
    label: 'Text field',
    description: 'Capture single-line input with support for hints and validation.',
    icon: '⌨️',
  },
  {
    id: 'link-container',
    label: 'Link container',
    description: 'Wrap groups of elements in navigable or interactive link targets.',
    icon: '🔗',
  },
  {
    id: 'page-section',
    label: 'Page section',
    description: 'Organise long pages with titled, themed structural sections.',
    icon: '📄',
  },
  {
    id: 'responsive-columns',
    label: 'Responsive columns',
    description: 'Adapt layouts across breakpoints with smart column stacking.',
    icon: '📐',
  },
  {
    id: 'horizontal-stack',
    label: 'Horizontal stack',
    description: 'Arrange components in a row with consistent spacing.',
    icon: '➡️',
  },
  {
    id: 'vertical-stack',
    label: 'Vertical stack',
    description: 'Stack elements vertically with shared spacing tokens.',
    icon: '⬇️',
  },
  {
    id: 'grid',
    label: 'Grid',
    description: 'Create dense, repeating layouts with column and row controls.',
    icon: '🔲',
  },
  {
    id: 'free-box',
    label: 'Free box',
    description: 'Absolutely position content for bespoke hero or overlay layouts.',
    icon: '🎨',
  },
]

export default function ComponentLibraryPanel() {
  const library = useComponentLibrary()
  const binding = useComponentBinding(DEMO_TARGET)
  const [assignError, setAssignError] = useState('')
  const [selectedPrimitiveId, setSelectedPrimitiveId] = useState(primitiveComponents[0]?.id ?? null)

  const slot = getSurfaceSlot(DEMO_TARGET.surfaceId, DEMO_TARGET.slotId)

  const assignableComponents = slot
    ? library.components.filter((component) =>
        component.capabilities.some((capability) => slot.accepts.includes(capability))
      )
    : []

  const assignedComponent = (() => {
    if (!binding) return null
    const fromLibrary = getComponentById(binding.componentId)
    if (fromLibrary) return fromLibrary
    if (binding.componentSnapshot) {
      return {
        id: binding.componentId,
        label: binding.componentSnapshot.label || binding.componentId,
        method: binding.componentSnapshot.method || '',
        path: binding.componentSnapshot.path || '',
        capability: binding.componentSnapshot.capability || '',
      }
    }
    return null
  })()

  const handleAssign = (event) => {
    const value = event.target.value
    setAssignError('')
    try {
      if (!value) {
        clearComponentBinding(DEMO_TARGET)
        return
      }
      assignComponentBinding(DEMO_TARGET, value, {
        metadata: { surfaceSlot: makeSlotKey(DEMO_TARGET.surfaceId, DEMO_TARGET.slotId) },
      })
    } catch (error) {
      console.error('Unable to update demo binding', error)
      setAssignError(error?.message || 'Unable to update binding.')
    }
  }

  return (
    <section className="component-library">
      <header className="component-library__header">
        <h2>Component loader</h2>
        <p>
          Load backend-aware components from the configured API catalogue. These definitions can be attached to UI elements so
          editors know which endpoint powers a given interaction.
        </p>
      </header>

      <section className="component-library__primitives" aria-labelledby="component-library-primitives-heading">
        <div className="component-library__primitives-header">
          <h3 id="component-library-primitives-heading">Layout primitives</h3>
          <p>
            Choose a building block for the canvas. Tiles highlight the core structure while the detail panel describes how it
            adapts inside responsive layouts.
          </p>
        </div>
        <div className="component-library__primitive-grid" role="list">
          {primitiveComponents.map((primitive) => {
            const isSelected = primitive.id === selectedPrimitiveId
            return (
              <div key={primitive.id} role="listitem" className="component-library__primitive-grid-item">
                <button
                  type="button"
                  className={`component-library__primitive-tile ${isSelected ? 'is-selected' : ''}`}
                  onClick={() => setSelectedPrimitiveId(primitive.id)}
                  aria-pressed={isSelected}
                  aria-label={`${primitive.label}. ${primitive.description}`}
                >
                  <span className="component-library__primitive-help" aria-hidden="true">
                    <span className="component-library__primitive-help-trigger">?</span>
                    <span className="component-library__primitive-help-bubble">{primitive.description}</span>
                  </span>
                  <span className="component-library__primitive-icon" aria-hidden="true">
                    {primitive.icon}
                  </span>
                  <span className="component-library__primitive-label">{primitive.label}</span>
                </button>
              </div>
            )
          })}
        </div>
      </section>

      <div className="component-library__summary" role="list">
        <div role="listitem">
          <strong>{library.components.length}</strong>
          <span>Total components</span>
        </div>
        <div role="listitem">
          <strong>{library.byCapability.action.length}</strong>
          <span>Action endpoints</span>
        </div>
        <div role="listitem">
          <strong>{library.byCapability.query.length}</strong>
          <span>Data sources</span>
        </div>
      </div>

      <div className="component-library__demo">
        <h3>Demo: wire a button to a backend action</h3>
        {slot ? (
          <p>
            The <code>{slot.label}</code> slot accepts <em>{slot.accepts.join(', ')}</em> components. Choose an endpoint to bind
            to the sample button below.
          </p>
        ) : (
          <p>This slot is no longer available.</p>
        )}

        <label className="component-library__label" htmlFor="component-library-demo-select">
          Assign endpoint
        </label>
        <select
          id="component-library-demo-select"
          onChange={handleAssign}
          value={binding?.componentId || ''}
          disabled={assignableComponents.length === 0}
        >
          <option value="">No action</option>
          {assignableComponents.map((component) => (
            <option key={component.id} value={component.id}>
              {component.label}
            </option>
          ))}
        </select>
        {assignError && <p className="component-library__status component-library__status--error">{assignError}</p>}

        <button type="button" className="component-library__demo-button">
          Sample form button
        </button>

        <div className="component-library__binding">
          {assignedComponent ? (
            <>
              <strong>Assigned endpoint:</strong>{' '}
              <span>{assignedComponent.label}</span>
              <div className="component-library__binding-meta">
                <span className={`component-library__badge component-library__badge--${assignedComponent.capability || 'action'}`}>
                  {capabilityLabels[assignedComponent.capability] || 'Endpoint'}
                </span>
                <code>
                  {assignedComponent.method} {assignedComponent.path}
                </code>
              </div>
            </>
          ) : (
            <span className="component-library__binding-empty">No backend action assigned yet.</span>
          )}
        </div>
      </div>

      <div className="component-library__catalogue">
        <h3>Available backend components</h3>
        {library.components.length > 0 ? (
          <div className="component-library__table" role="table">
            <div className="component-library__row component-library__row--head" role="row">
              <div role="columnheader">Method</div>
              <div role="columnheader">Path</div>
              <div role="columnheader">Type</div>
              <div role="columnheader">Summary</div>
            </div>
            {library.components.map((component) => (
              <div className="component-library__row" role="row" key={component.id}>
                <div role="cell">
                  <span className={`component-library__badge component-library__badge--${component.capability}`}>
                    {component.method}
                  </span>
                </div>
                <div role="cell" className="component-library__code">
                  {component.path}
                </div>
                <div role="cell">{capabilityLabels[component.capability] || component.capability}</div>
                <div role="cell">{component.summary || component.description || '—'}</div>
              </div>
            ))}
          </div>
        ) : (
          <p className="component-library__empty">No endpoints configured. Add a catalogue in Project settings.</p>
        )}
      </div>
    </section>
  )
}
