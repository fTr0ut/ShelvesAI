import { useMemo, useState } from 'react'
import './PropertiesPanel.css'

const defaultTypographyFamilies = ['Inter', 'Bungee', 'Archivo', 'Space Grotesk', 'Work Sans', 'DM Sans', 'Manrope']
const fontWeights = ['300', '400', '500', '600', '700']
const textTransforms = ['none', 'uppercase', 'lowercase', 'capitalize']
const textAlignments = ['left', 'center', 'right', 'justify']
const displayOptions = ['block', 'inline-block', 'flex', 'grid']
const positionOptions = ['static', 'relative', 'absolute', 'sticky', 'fixed']

export default function PropertiesPanel({
  activeScreen,
  pageStyles,
  onPageStyleChange,
  component,
  onComponentChange,
}) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [activeTab, setActiveTab] = useState('component')

  const componentStyles = component?.styles || {}

  const componentTypeOptions = useMemo(
    () => [
      { label: 'Text block', value: 'text' },
      { label: 'Button', value: 'button' },
      { label: 'Image', value: 'image' },
      { label: 'Card', value: 'card' },
      { label: 'Input', value: 'input' },
    ],
    [],
  )

  const handleComponentStyleChange = (field, value) => {
    if (!onComponentChange) return
    onComponentChange({
      ...component,
      styles: {
        ...componentStyles,
        [field]: value,
      },
    })
  }

  const handleComponentMetaChange = (field, value) => {
    if (!onComponentChange) return
    onComponentChange({
      ...component,
      [field]: value,
    })
  }

  const handlePageStyleInput = (field, value) => {
    if (!onPageStyleChange) return
    onPageStyleChange({
      ...pageStyles,
      [field]: value,
    })
  }

  return (
    <aside
      className={`properties-panel${isCollapsed ? ' properties-panel--collapsed' : ''}`}
      aria-label="Canvas properties"
    >
      <div className="properties-panel__header">
        <button
          type="button"
          className="properties-panel__toggle"
          onClick={() => setIsCollapsed((prev) => !prev)}
          aria-expanded={!isCollapsed}
        >
          {isCollapsed ? '◀ Expand' : '▶ Collapse'}
        </button>
        <div className="properties-panel__title-group">
          <span className="properties-panel__title">Inspector</span>
          <span className="properties-panel__subtitle">{activeScreen?.name || 'Select a screen'}</span>
        </div>
      </div>

      <div className="properties-panel__tabs" role="tablist">
        <button
          type="button"
          role="tab"
          className={`properties-panel__tab${activeTab === 'component' ? ' properties-panel__tab--active' : ''}`}
          onClick={() => setActiveTab('component')}
        >
          Component
        </button>
        <button
          type="button"
          role="tab"
          className={`properties-panel__tab${activeTab === 'page' ? ' properties-panel__tab--active' : ''}`}
          onClick={() => setActiveTab('page')}
        >
          Page
        </button>
      </div>

      <div className="properties-panel__content">
        {activeTab === 'component' ? (
          <div className="properties-panel__section">
            <fieldset className="properties-panel__fieldset">
              <legend>Component</legend>
              <label className="properties-panel__label">
                Display name
                <input
                  className="properties-panel__input"
                  value={component?.label || ''}
                  onChange={(event) => handleComponentMetaChange('label', event.target.value)}
                  placeholder="Component name"
                />
              </label>
              <label className="properties-panel__label">
                Component type
                <select
                  className="properties-panel__input"
                  value={component?.type || 'text'}
                  onChange={(event) => handleComponentMetaChange('type', event.target.value)}
                >
                  {componentTypeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </fieldset>

            <fieldset className="properties-panel__fieldset">
              <legend>Typography</legend>
              <label className="properties-panel__label">
                Font family
                <select
                  className="properties-panel__input"
                  value={componentStyles.fontFamily || ''}
                  onChange={(event) => handleComponentStyleChange('fontFamily', event.target.value)}
                >
                  <option value="">Inherit</option>
                  {defaultTypographyFamilies.map((font) => (
                    <option key={font} value={font}>
                      {font}
                    </option>
                  ))}
                </select>
              </label>
              <div className="properties-panel__inline-inputs">
                <label className="properties-panel__label">
                  Font size
                  <input
                    type="number"
                    className="properties-panel__input"
                    value={parseInt(componentStyles.fontSize, 10) || ''}
                    onChange={(event) =>
                      handleComponentStyleChange('fontSize', event.target.value ? `${event.target.value}px` : '')
                    }
                    min="8"
                    max="128"
                  />
                </label>
                <label className="properties-panel__label">
                  Weight
                  <select
                    className="properties-panel__input"
                    value={componentStyles.fontWeight || ''}
                    onChange={(event) => handleComponentStyleChange('fontWeight', event.target.value)}
                  >
                    <option value="">Default</option>
                    {fontWeights.map((weight) => (
                      <option key={weight} value={weight}>
                        {weight}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="properties-panel__inline-inputs">
                <label className="properties-panel__label">
                  Line height
                  <input
                    type="number"
                    className="properties-panel__input"
                    step="0.05"
                    value={parseFloat(componentStyles.lineHeight) || ''}
                    onChange={(event) => handleComponentStyleChange('lineHeight', event.target.value)}
                    min="0"
                    max="4"
                  />
                </label>
                <label className="properties-panel__label">
                  Letter spacing
                  <input
                    type="number"
                    className="properties-panel__input"
                    step="0.01"
                    value={parseFloat(componentStyles.letterSpacing) || ''}
                    onChange={(event) => handleComponentStyleChange('letterSpacing', event.target.value)}
                    min="-2"
                    max="2"
                  />
                </label>
              </div>
              <label className="properties-panel__label">
                Text transform
                <select
                  className="properties-panel__input"
                  value={componentStyles.textTransform || ''}
                  onChange={(event) => handleComponentStyleChange('textTransform', event.target.value)}
                >
                  <option value="">Default</option>
                  {textTransforms.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label className="properties-panel__label">
                Alignment
                <select
                  className="properties-panel__input"
                  value={componentStyles.textAlign || ''}
                  onChange={(event) => handleComponentStyleChange('textAlign', event.target.value)}
                >
                  <option value="">Default</option>
                  {textAlignments.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
            </fieldset>

            <fieldset className="properties-panel__fieldset">
              <legend>Layout & spacing</legend>
              <div className="properties-panel__inline-inputs">
                <label className="properties-panel__label">
                  Width
                  <input
                    className="properties-panel__input"
                    value={componentStyles.width || ''}
                    onChange={(event) => handleComponentStyleChange('width', event.target.value)}
                    placeholder="auto"
                  />
                </label>
                <label className="properties-panel__label">
                  Height
                  <input
                    className="properties-panel__input"
                    value={componentStyles.height || ''}
                    onChange={(event) => handleComponentStyleChange('height', event.target.value)}
                    placeholder="auto"
                  />
                </label>
              </div>
              <div className="properties-panel__inline-inputs">
                <label className="properties-panel__label">
                  Display
                  <select
                    className="properties-panel__input"
                    value={componentStyles.display || ''}
                    onChange={(event) => handleComponentStyleChange('display', event.target.value)}
                  >
                    <option value="">Default</option>
                    {displayOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="properties-panel__label">
                  Position
                  <select
                    className="properties-panel__input"
                    value={componentStyles.position || ''}
                    onChange={(event) => handleComponentStyleChange('position', event.target.value)}
                  >
                    <option value="">Default</option>
                    {positionOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="properties-panel__label">
                Margin
                <input
                  className="properties-panel__input"
                  value={componentStyles.margin || ''}
                  onChange={(event) => handleComponentStyleChange('margin', event.target.value)}
                  placeholder="e.g. 16px 24px"
                />
              </label>
              <label className="properties-panel__label">
                Padding
                <input
                  className="properties-panel__input"
                  value={componentStyles.padding || ''}
                  onChange={(event) => handleComponentStyleChange('padding', event.target.value)}
                  placeholder="e.g. 12px"
                />
              </label>
            </fieldset>

            <fieldset className="properties-panel__fieldset">
              <legend>Appearance</legend>
              <label className="properties-panel__label">
                Text color
                <input
                  type="color"
                  className="properties-panel__color-input"
                  value={componentStyles.color || '#ffffff'}
                  onChange={(event) => handleComponentStyleChange('color', event.target.value)}
                />
              </label>
              <label className="properties-panel__label">
                Background
                <input
                  type="color"
                  className="properties-panel__color-input"
                  value={componentStyles.backgroundColor || '#1f2937'}
                  onChange={(event) => handleComponentStyleChange('backgroundColor', event.target.value)}
                />
              </label>
              <div className="properties-panel__inline-inputs">
                <label className="properties-panel__label">
                  Opacity
                  <input
                    type="number"
                    className="properties-panel__input"
                    step="0.05"
                    min="0"
                    max="1"
                    value={componentStyles.opacity ?? ''}
                    onChange={(event) => handleComponentStyleChange('opacity', event.target.value)}
                  />
                </label>
                <label className="properties-panel__label">
                  Border radius
                  <input
                    type="number"
                    className="properties-panel__input"
                    min="0"
                    value={parseInt(componentStyles.borderRadius, 10) || ''}
                    onChange={(event) =>
                      handleComponentStyleChange('borderRadius', event.target.value ? `${event.target.value}px` : '')
                    }
                  />
                </label>
              </div>
              <label className="properties-panel__label">
                Border
                <input
                  className="properties-panel__input"
                  value={componentStyles.border || ''}
                  onChange={(event) => handleComponentStyleChange('border', event.target.value)}
                  placeholder="e.g. 1px solid #fff"
                />
              </label>
              <label className="properties-panel__label">
                Box shadow
                <input
                  className="properties-panel__input"
                  value={componentStyles.boxShadow || ''}
                  onChange={(event) => handleComponentStyleChange('boxShadow', event.target.value)}
                  placeholder="e.g. 0 20px 40px rgba(0,0,0,0.2)"
                />
              </label>
            </fieldset>
          </div>
        ) : (
          <div className="properties-panel__section">
            <fieldset className="properties-panel__fieldset">
              <legend>Page baseline</legend>
              <label className="properties-panel__label">
                Background
                <input
                  type="color"
                  className="properties-panel__color-input"
                  value={pageStyles.backgroundColor || '#0b1120'}
                  onChange={(event) => handlePageStyleInput('backgroundColor', event.target.value)}
                />
              </label>
              <label className="properties-panel__label">
                Text color
                <input
                  type="color"
                  className="properties-panel__color-input"
                  value={pageStyles.textColor || '#e2e8f0'}
                  onChange={(event) => handlePageStyleInput('textColor', event.target.value)}
                />
              </label>
              <label className="properties-panel__label">
                Font family
                <select
                  className="properties-panel__input"
                  value={pageStyles.fontFamily || ''}
                  onChange={(event) => handlePageStyleInput('fontFamily', event.target.value)}
                >
                  {defaultTypographyFamilies.map((font) => (
                    <option key={font} value={font}>
                      {font}
                    </option>
                  ))}
                </select>
              </label>
              <label className="properties-panel__label">
                Base font size
                <input
                  type="number"
                  className="properties-panel__input"
                  min="12"
                  max="22"
                  value={pageStyles.fontSize || 16}
                  onChange={(event) => handlePageStyleInput('fontSize', Number(event.target.value) || 16)}
                />
              </label>
            </fieldset>

            <fieldset className="properties-panel__fieldset">
              <legend>Layout</legend>
              <label className="properties-panel__label">
                Layout mode
                <select
                  className="properties-panel__input"
                  value={pageStyles.layout || 'fixed'}
                  onChange={(event) => handlePageStyleInput('layout', event.target.value)}
                >
                  <option value="fixed">Fixed width</option>
                  <option value="fluid">Fluid</option>
                  <option value="breakpoint">Breakpoint-based</option>
                </select>
              </label>
              <div className="properties-panel__inline-inputs">
                <label className="properties-panel__label">
                  Max width
                  <input
                    className="properties-panel__input"
                    value={pageStyles.maxWidth || '1200px'}
                    onChange={(event) => handlePageStyleInput('maxWidth', event.target.value)}
                  />
                </label>
                <label className="properties-panel__label">
                  Grid columns
                  <input
                    type="number"
                    className="properties-panel__input"
                    min="1"
                    max="12"
                    value={pageStyles.gridColumns || 12}
                    onChange={(event) => handlePageStyleInput('gridColumns', Number(event.target.value) || 12)}
                  />
                </label>
              </div>
              <label className="properties-panel__label">
                Gutter size
                <input
                  className="properties-panel__input"
                  value={pageStyles.gap || '24px'}
                  onChange={(event) => handlePageStyleInput('gap', event.target.value)}
                />
              </label>
            </fieldset>

            <fieldset className="properties-panel__fieldset">
              <legend>Spacing</legend>
              <div className="properties-panel__inline-inputs">
                <label className="properties-panel__label">
                  Section padding
                  <input
                    className="properties-panel__input"
                    value={pageStyles.sectionPadding || '80px'}
                    onChange={(event) => handlePageStyleInput('sectionPadding', event.target.value)}
                  />
                </label>
                <label className="properties-panel__label">
                  Block spacing
                  <input
                    className="properties-panel__input"
                    value={pageStyles.blockSpacing || '48px'}
                    onChange={(event) => handlePageStyleInput('blockSpacing', event.target.value)}
                  />
                </label>
              </div>
              <label className="properties-panel__label">
                Corner radius
                <input
                  type="number"
                  className="properties-panel__input"
                  min="0"
                  value={parseInt(pageStyles.borderRadius, 10) || 0}
                  onChange={(event) =>
                    handlePageStyleInput('borderRadius', event.target.value ? `${event.target.value}px` : '0px')
                  }
                />
              </label>
              <label className="properties-panel__label">
                Elevation
                <select
                  className="properties-panel__input"
                  value={pageStyles.elevation || 'soft'}
                  onChange={(event) => handlePageStyleInput('elevation', event.target.value)}
                >
                  <option value="none">None</option>
                  <option value="soft">Soft shadow</option>
                  <option value="medium">Medium shadow</option>
                  <option value="strong">Strong shadow</option>
                </select>
              </label>
            </fieldset>
          </div>
        )}
      </div>
    </aside>
  )
}

