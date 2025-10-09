const COLOR_SCHEMES = [
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
]

const BACKGROUND_OPTIONS = [
  { label: 'Soft Gradient', value: 'soft-gradient' },
  { label: 'Solid Color', value: 'solid-background' },
  { label: 'Pattern Overlay', value: 'pattern-overlay' },
]

const HEADER_OPTIONS = [
  {
    label: 'Centered Logo',
    value: 'centered-logo',
    description: 'Navigation and action sit beneath a central brand lockup.',
  },
  {
    label: 'Split Navigation',
    value: 'split-nav',
    description: 'Brand on the left with navigation and actions on the right.',
  },
  {
    label: 'Minimal',
    value: 'minimal',
    description: 'Muted chrome that keeps the hero area in focus.',
  },
]

const FOOTER_OPTIONS = [
  {
    label: 'Minimal',
    value: 'minimal',
    description: 'Slim footer with legal links.',
  },
  {
    label: 'Expanded',
    value: 'expanded',
    description: 'Multi-column layout for resources and contact information.',
  },
  {
    label: 'CTA Forward',
    value: 'cta',
    description: 'Focused row that highlights a single conversion action.',
  },
]

export default function SiteSettingsPanel({ settings, onChange }) {
  return (
    <aside className="site-settings__panel" aria-label="Site configuration controls">
      <section className="site-settings__section">
        <header className="site-settings__section-header">
          <h2>Color system</h2>
          <p>Define the global palette that flows through templates and surfaces.</p>
        </header>
        <div className="site-settings__color-controls">
          <div className="site-settings__color-toggle" role="radiogroup" aria-label="Color scheme">
            {COLOR_SCHEMES.map((scheme) => (
              <label key={scheme.value} className="site-settings__toggle-pill">
                <input
                  type="radio"
                  name="color-scheme"
                  value={scheme.value}
                  checked={settings.colorScheme === scheme.value}
                  onChange={(event) => onChange('colorScheme', event.target.value)}
                />
                <span className="site-settings__toggle-visual">{scheme.label}</span>
              </label>
            ))}
          </div>
          <label className="site-settings__color-picker">
            <span>Accent color</span>
            <input
              type="color"
              value={settings.accentColor}
              onChange={(event) => onChange('accentColor', event.target.value)}
              aria-label="Accent color"
            />
          </label>
        </div>
      </section>

      <section className="site-settings__section">
        <header className="site-settings__section-header">
          <h2>Background treatment</h2>
          <p>Set the ambient surface that content rests upon.</p>
        </header>
        <div className="site-settings__option-grid site-settings__option-grid--compact">
          {BACKGROUND_OPTIONS.map((option) => (
            <label key={option.value} className="site-settings__radio-card">
              <input
                type="radio"
                name="background"
                value={option.value}
                checked={settings.background === option.value}
                onChange={(event) => onChange('background', event.target.value)}
              />
              <div className="site-settings__radio-inner">
                <div className="site-settings__radio-visual" data-style={option.value} />
                <span>{option.label}</span>
              </div>
            </label>
          ))}
        </div>
      </section>

      <section className="site-settings__section">
        <header className="site-settings__section-header">
          <h2>Persistent structure</h2>
          <p>Control the components that appear across every page.</p>
        </header>
        <div className="site-settings__structure">
          <div>
            <h3>Header</h3>
            <div className="site-settings__option-grid site-settings__option-grid--compact">
              {HEADER_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`site-settings__option-card site-settings__option-card--compact ${
                    settings.headerStyle === option.value ? 'site-settings__option-card--active' : ''
                  }`}
                  onClick={() => onChange('headerStyle', option.value)}
                >
                  <span className="site-settings__option-title">{option.label}</span>
                  <span className="site-settings__option-copy">{option.description}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <h3>Footer</h3>
            <div className="site-settings__option-grid site-settings__option-grid--compact">
              {FOOTER_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`site-settings__option-card site-settings__option-card--compact ${
                    settings.footerStyle === option.value ? 'site-settings__option-card--active' : ''
                  }`}
                  onClick={() => onChange('footerStyle', option.value)}
                >
                  <span className="site-settings__option-title">{option.label}</span>
                  <span className="site-settings__option-copy">{option.description}</span>
                </button>
              ))}
            </div>
          </div>
          <label className="site-settings__toggle-switch">
            <input
              type="checkbox"
              checked={settings.showAnnouncement}
              onChange={(event) => onChange('showAnnouncement', event.target.checked)}
            />
            <span className="site-settings__switch-indicator" aria-hidden="true">
              <span className="site-settings__switch-handle" />
            </span>
            <span>Announcement banner</span>
          </label>
        </div>
      </section>
    </aside>
  )
}
