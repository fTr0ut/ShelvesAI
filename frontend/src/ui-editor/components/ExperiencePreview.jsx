const HEADER_CONTENT = {
  'centered-logo': {
    title: 'Centered navigation',
    description: 'Symmetry keeps focus on the hero while CTAs stay prominent.',
  },
  'split-nav': {
    title: 'Split navigation',
    description: 'Utility actions float right while core navigation anchors left.',
  },
  minimal: {
    title: 'Minimal header',
    description: 'Discreet chrome ideal for immersive editorial surfaces.',
  },
}

const FOOTER_CONTENT = {
  minimal: {
    title: 'Minimal footer',
    description: 'Legal text and social icons only.',
  },
  expanded: {
    title: 'Expanded footer',
    description: 'Multi-column sitemap with newsletter capture.',
  },
  cta: {
    title: 'CTA footer',
    description: 'Single call-to-action with supporting copy.',
  },
}

export default function ExperiencePreview({ settings, theme }) {
  const deviceWidth = settings.device === 'mobile' ? 384 : 1100

  return (
    <section className="site-settings__preview" aria-label="Live experience preview">
      <header className="site-settings__section-header">
        <h2>Live preview</h2>
        <p>Review how global settings cascade into the customer experience.</p>
      </header>
      <div className="site-settings__preview-stage">
        <div
          className={`site-settings__preview-surface ${theme.backgroundClass}`}
          style={{ width: deviceWidth }}
        >
          {settings.showAnnouncement && (
            <div className="site-settings__announcement" style={{ color: theme.accentColor }}>
              Collector summer capsule available now.
            </div>
          )}
          <div className={`site-settings__preview-header ${settings.headerStyle}`}>
            <span className="site-settings__brand" style={{ color: theme.accentColor }}>
              Collector
            </span>
            <div className="site-settings__nav">
              <span>Catalog</span>
              <span>Stories</span>
              <span>About</span>
            </div>
            <button type="button" className="site-settings__cta" style={{ background: theme.accentColor }}>
              Join waitlist
            </button>
          </div>
          <div className="site-settings__hero">
            <h3>One design system, every surface.</h3>
            <p>
              Define global presentation tokens for Collector and preview how modules adapt from desktop canvases to mobile flows.
            </p>
            <div className="site-settings__hero-actions">
              <button type="button" className="site-settings__cta" style={{ background: theme.accentColor }}>
                Launch builder
              </button>
              <button type="button" className="site-settings__secondary">
                Share brief
              </button>
            </div>
          </div>
          <div className="site-settings__info-grid">
            <article>
              <h4>{HEADER_CONTENT[settings.headerStyle].title}</h4>
              <p>{HEADER_CONTENT[settings.headerStyle].description}</p>
            </article>
            <article>
              <h4>Color system</h4>
              <p>
                {settings.colorScheme === 'dark'
                  ? 'Dark surfaces highlight iridescent accents and cinematic imagery.'
                  : 'Light theme keeps layouts approachable and supports product photography.'}
              </p>
            </article>
            <article>
              <h4>{FOOTER_CONTENT[settings.footerStyle].title}</h4>
              <p>{FOOTER_CONTENT[settings.footerStyle].description}</p>
            </article>
          </div>
          <footer className={`site-settings__preview-footer ${settings.footerStyle}`}>
            <span>© 2024 Collector Labs</span>
            <div className="site-settings__footer-nav">
              <span>Privacy</span>
              <span>Terms</span>
              <span>Support</span>
            </div>
            <button type="button" className="site-settings__secondary">
              Contact
            </button>
          </footer>
        </div>
      </div>
    </section>
  )
}
