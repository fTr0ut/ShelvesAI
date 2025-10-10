import { useEffect, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AppLayout, Button, Card, Hero } from '../components'
import { LEGACY_BASE_PATH, legacyPath } from '../legacy/constants.js'
import { FeedProvider, useFeed } from '../data/FeedProvider'

const SCOPES = [
  { value: 'friends', label: 'Friends' },
  { value: 'mine', label: 'My Shelves' },
  { value: 'global', label: 'Global' },
  { value: 'nearby', label: 'Nearby' },
]

function FeedContent() {
  const { entries, scope, setScope, loading, error } = useFeed()

  return (
    <AppLayout>
      <Hero title="Social Feed" description="Recent shelf updates from your community." />

      <div className="row" style={{ gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {SCOPES.map((opt) => (
          <Button
            key={opt.value}
            variant={scope === opt.value ? 'primary' : 'ghost'}
            onClick={() => setScope(opt.value)}
            disabled={loading && scope === opt.value}
          >
            {opt.label}
          </Button>
        ))}
        <Button as={Link} to={legacyPath('/shelves')}>
          Create shelf
        </Button>
      </div>

      {error && <div className="message error">{error}</div>}

      <div className="stack" style={{ gap: 16 }}>
        {loading && !entries.length ? (
          <Card>
            <p className="label">Loading feed</p>
          </Card>
        ) : null}

        {!loading && !entries.length && !error ? (
          <Card>
            <p className="label">No activity yet. Add friends or start sharing your shelves!</p>
          </Card>
        ) : null}

        {entries.map((entry) => (
          <Card key={entry.shelf?.id || Math.random()}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
              <div>
                <strong>{entry.owner?.name || entry.owner?.username || 'Collector'}</strong>
                <div className="label">
                  {[entry.owner?.city, entry.owner?.state, entry.owner?.country].filter(Boolean).join(', ')}
                </div>
              </div>
              <span className="pill">{entry.shelf?.type}</span>
            </div>

            <div>
              <Link className="item-link" to={legacyPath(`/shelves/${entry.shelf?.id || ''}`)}>
                <strong style={{ fontSize: 18 }}>{entry.shelf?.name}</strong>
                {entry.shelf?.description && <div className="label" style={{ marginTop: 4 }}>{entry.shelf.description}</div>}
              </Link>
            </div>

            {entry.items?.length ? (
              <div style={{ display: 'grid', gap: 6 }}>
                {entry.items.slice(0, 5).map((item) => {
                  const label = item.collectable?.name || item.manual?.name || 'Unknown item'
                  return (
                    <div key={item.id} className="label">
                      {label}
                    </div>
                  )
                })}
                {entry.shelf?.itemCount > entry.items.length ? (
                  <div className="label">+ {entry.shelf.itemCount - entry.items.length} more items</div>
                ) : null}
              </div>
            ) : (
              <div className="label">No items listed yet.</div>
            )}

            <div className="label" style={{ textAlign: 'right' }}>
              Updated {entry.shelf?.updatedAt ? new Date(entry.shelf.updatedAt).toLocaleString() : 'recently'}
            </div>
          </Card>
        ))}
      </div>
    </AppLayout>
  )
}

export default function Feed({ apiBase = '' }) {
  const navigate = useNavigate()
  const token = useMemo(() => localStorage.getItem('token') || '', [])

  useEffect(() => {
    if (!token) {
      navigate(LEGACY_BASE_PATH)
    }
  }, [navigate, token])

  if (!token) return null

  return (
    <FeedProvider apiBase={apiBase} token={token}>
      <FeedContent />
    </FeedProvider>
  )
}



