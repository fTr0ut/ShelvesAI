import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

const VISIBILITY_OPTIONS = [
  { value: 'private', label: 'Private (only me)' },
  { value: 'friends', label: 'Friends only' },
  { value: 'public', label: 'Public' },
]

export default function ShelfDetail({ apiBase = '' }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const token = useMemo(() => localStorage.getItem('token') || '', [])
  const envBase = (import.meta.env.VITE_API_BASE || '').replace(/\/+$/, '')
  const base = apiBase || envBase
  const api = (p) => `${base}${p}`

  const [shelf, setShelf] = useState(null)
  const [items, setItems] = useState([])
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [manual, setManual] = useState({ name: '', type: '', description: '' })
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [visibilitySaving, setVisibilitySaving] = useState(false)

  useEffect(() => {
    if (!token) {
      navigate('/')
      return
    }
    const load = async () => {
      try {
        setLoading(true)
        const [sRes, iRes] = await Promise.all([
          fetch(api(`/api/shelves/${id}`), { headers: { Authorization: `Bearer ${token}` } }),
          fetch(api(`/api/shelves/${id}/items`), { headers: { Authorization: `Bearer ${token}` } }),
        ])
        const sData = await sRes.json()
        const iData = await iRes.json()
        if (!sRes.ok) throw new Error(sData?.error || 'Failed to load shelf')
        if (!iRes.ok) throw new Error(iData?.error || 'Failed to load items')
        setShelf(sData.shelf)
        setItems(iData.items)
        setError('')
      } catch (e) {
        setError(e.message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [id, token])

  const refreshItems = async () => {
    const res = await fetch(api(`/api/shelves/${id}/items`), { headers: { Authorization: `Bearer ${token}` } })
    const data = await res.json()
    if (res.ok) setItems(data.items)
  }

  const changeVisibility = async (value) => {
    if (!shelf || shelf.visibility === value) return
    setVisibilitySaving(true)
    setMessage('')
    try {
      const res = await fetch(api(`/api/shelves/${id}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ visibility: value }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Failed to update visibility')
      setShelf(data.shelf)
      setMessage(`Visibility updated to ${value}`)
    } catch (e) {
      setError(e.message)
    } finally {
      setVisibilitySaving(false)
    }
  }

  const addManual = async (e) => {
    e.preventDefault()
    setError('')
    try {
      const res = await fetch(api(`/api/shelves/${id}/manual`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(manual),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Failed to add item')
      setManual({ name: '', type: '', description: '' })
      await refreshItems()
    } catch (e) {
      setError(e.message)
    }
  }

  const search = async (term) => {
    const qv = (term ?? q).trim()
    if (!qv) { setResults([]); return }
    try {
      const res = await fetch(api(`/api/shelves/${id}/search?q=${encodeURIComponent(qv)}`), { headers: { Authorization: `Bearer ${token}` } })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Search failed')
      setResults(data.results)
    } catch (e) {
      setError(e.message)
    }
  }

  const addCollectable = async (collectableId) => {
    try {
      const res = await fetch(api(`/api/shelves/${id}/items`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ collectableId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Add failed')
      setResults([])
      await refreshItems()
    } catch (e) {
      setError(e.message)
    }
  }

  const removeItem = async (itemId) => {
    setError('')
    try {
      const res = await fetch(api(`/api/shelves/${id}/items/${itemId}`), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Remove failed')
      setItems(data.items || [])
      setMessage('Item removed from shelf')
    } catch (e) {
      setError(e.message)
    }
  }

  if (loading) return <div className="app"><div className="message info">Loading shelf...</div></div>
  if (!shelf) return <div className="app"><div className="message error">{error || 'Shelf not found'}</div></div>

  return (
    <div className="app">
      <div className="hero">
        <h1>{shelf.name} <span className="pill">{shelf.type}</span></h1>
        <div className="row" style={{ alignItems: 'center', gap: 8 }}>
          <label className="label" htmlFor="visibility">Visibility</label>
          <select
            id="visibility"
            className="input"
            value={shelf.visibility || 'private'}
            onChange={(e) => changeVisibility(e.target.value)}
            disabled={visibilitySaving}
            style={{ maxWidth: 220 }}
          >
            {VISIBILITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        {message && <div className="message success" style={{ marginTop: 8 }}>{message}</div>}
        {error && <div className="message error" style={{ marginTop: 8 }}>{error}</div>}
      </div>

      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <div className="card">
          <h3>Items</h3>
          <ul className="list">
            {items.map((it) => {
              const isCollectable = Boolean(it.collectable)
              const collectableId = isCollectable ? (it.collectable?._id || it.collectable?.id) : null
              const linkTarget = collectableId ? `/collectables/${collectableId}` : null
              const collectableMeta = isCollectable ? [
                it.collectable.author ? `by ${it.collectable.author}` : '',
                it.collectable.format || '',
                it.collectable.publisher || '',
                it.collectable.year || '',
              ].filter(Boolean).join(' • ') : ''
              const manualMeta = !isCollectable && it.manual ? [
                it.manual.type || '',
                it.manual.description || '',
              ].filter(Boolean).join(' • ') : ''

              return (
                <li key={it.id} className="row item-row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                  <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                    {isCollectable && linkTarget ? (
                      <Link className="item-link" to={linkTarget}>
                        <strong>{it.collectable.name}</strong>
                        {collectableMeta && <span className="label">{collectableMeta}</span>}
                      </Link>
                    ) : it.manual ? (
                      <div className="item-link">
                        <strong>{it.manual.name}</strong>
                        {manualMeta && <span className="label">{manualMeta}</span>}
                      </div>
                    ) : (
                      <em>Unknown</em>
                    )}
                  </div>
                  <button className="btn danger" type="button" onClick={() => removeItem(it.id)}>Remove</button>
                </li>
              )
            })}
            {!items.length && <li className="label">No items yet</li>}
          </ul>
        </div>

        <div className="card">
          <h3>Manually add entry</h3>
          <form className="stack" onSubmit={addManual}>
            <input className="input" placeholder="Name" value={manual.name} onChange={(e) => setManual({ ...manual, name: e.target.value })} />
            <input className="input" placeholder="Type" value={manual.type} onChange={(e) => setManual({ ...manual, type: e.target.value })} />
            <input className="input" placeholder="Description" value={manual.description} onChange={(e) => setManual({ ...manual, description: e.target.value })} />
            <div className="row"><button className="btn primary" type="submit">Add</button></div>
          </form>

          <h3 className="section-title">Search catalog</h3>
          <input
            className="input"
            placeholder="Search by title"
            value={q}
            onChange={(e) => {
              const value = e.target.value
              setQ(value)
              if (value.trim().length >= 2) search(value)
              else setResults([])
            }}
          />
          {results.length > 0 && (
            <ul className="list" style={{ marginTop: 8 }}>
              {results.map((r) => (
                <li key={r._id} className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>{r.name}{r.author ? ` by ${r.author}` : ''}{r.format ? ` [${r.format}]` : ''}</span>
                  <button className="btn" type="button" onClick={() => addCollectable(r._id)}>Add</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <p style={{ marginTop: 16 }}>
        <Link className="btn" to="/shelves">Back to shelves</Link>
      </p>
    </div>
  )
}

