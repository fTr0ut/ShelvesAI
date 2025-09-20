import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

export default function Feed({ apiBase = '' }) {
  const navigate = useNavigate()
  const token = useMemo(() => localStorage.getItem('token') || '', [])
  const envBase = (import.meta.env.VITE_API_BASE || '').replace(/\/+$/, '')
  const base = apiBase || envBase
  const api = (path) => `${base}${path}`

  const [entries, setEntries] = useState([])
  const [scope, setScope] = useState('friends')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token) {
      navigate('/')
      return
    }
    const controller = new AbortController()
    const load = async () => {
      try {
        setLoading(true)
        setError('')
        const res = await fetch(api(`/api/feed?scope=${scope}`), { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
        const data = await res.json()
        if (!res.ok) throw new Error(data?.error || 'Failed to load feed')
        setEntries(data.entries || [])
      } catch (e) {
        setError(e.message || 'Failed to load feed')
      } finally {
        setLoading(false)
      }
    }
    load()
    }

    load()
    return () => controller.abort()
  }, [apiBase, base, navigate, scope, token])

  const scopes = [
    { value: 'friends', label: 'Friends' },
    { value: 'mine', label: 'My Shelves' },
    { value: 'global', label: 'Global' },
    { value: 'nearby', label: 'Nearby' },
  ]

  return (
    <div className="app">
      <div className="hero">
        <h1>Social Feed</h1>
        <p className="label">Recent shelf updates from your community.</p>
      </div>

      <div className="row" style={{ gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {scopes.map((opt) => (
          <button
            key={opt.value}
            className={`btn ${scope === opt.value ? 'primary' : ''}`}
            onClick={() => setScope(opt.value)}
            disabled={loading && scope === opt.value}
          >
            {opt.label}
          </button>
        ))}
        <Link className="btn" to="/shelves">Create shelf</Link>
      </div>

      {error && <div className="message error">{error}</div>}

      <div className="stack" style={{ gap: 16 }}>
        {loading && !entries.length ? (
          <div className="card">
            <p className="label">Loading feed…</p>
          </div>
        ) : null}

        {!loading && !entries.length && !error ? (
          <div className="card">
            <p className="label">No activity yet. Add friends or start sharing your shelves!</p>
          </div>
        ) : null}

        {entries.map((entry) => (
          <div key={entry.shelf?.id || Math.random()} className="card" style={{ display: 'grid', gap: 12 }}>
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
              <Link className="item-link" to={`/shelves/${entry.shelf?.id || ''}`}>
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
                      • {label}
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
          </div>
        ))}
      </div>
    </div>
  )
}
