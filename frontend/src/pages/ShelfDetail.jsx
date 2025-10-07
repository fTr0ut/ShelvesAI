import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AppLayout, Button, Card, Grid, Hero } from '../components'
import { LEGACY_BASE_PATH, legacyPath } from '../legacy/constants.js'
import { ShelfDetailProvider, useShelfDetail } from '../plasmic/data/ShelfDetailProvider'

const VISIBILITY_OPTIONS = [
  { value: 'private', label: 'Private (only me)' },
  { value: 'friends', label: 'Friends only' },
  { value: 'public', label: 'Public' },
]

function ShelfDetailContent() {
  const {
    shelf,
    items,
    loading,
    error,
    message,
    changeVisibility,
    savingVisibility,
    addManual,
    addCollectable,
    removeItem,
    searchCollectables,
  } = useShelfDetail()

  const [manual, setManual] = useState({ name: '', type: '', description: '' })
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [actionError, setActionError] = useState('')
  const [searching, setSearching] = useState(false)

  const handleVisibilityChange = async (value) => {
    try {
      await changeVisibility(value)
      setActionError('')
    } catch (err) {
      setActionError(err.message || 'Failed to update visibility')
    }
  }

  const handleManualSubmit = async (e) => {
    e.preventDefault()
    setActionError('')
    try {
      await addManual(manual)
      setManual({ name: '', type: '', description: '' })
    } catch (err) {
      setActionError(err.message || 'Failed to add item')
    }
  }

  const handleSearch = async (term) => {
    const qv = (term ?? q).trim()
    setQ(qv)
    if (!qv) {
      setResults([])
      return
    }
    try {
      setSearching(true)
      const r = await searchCollectables(qv)
      setResults(r)
    } catch (err) {
      setActionError(err.message || 'Search failed')
    } finally {
      setSearching(false)
    }
  }

  const handleAddCollectable = async (collectableId) => {
    try {
      setActionError('')
      await addCollectable(collectableId)
      setResults([])
    } catch (err) {
      setActionError(err.message || 'Add failed')
    }
  }

  const handleRemoveItem = async (itemId) => {
    try {
      setActionError('')
      await removeItem(itemId)
    } catch (err) {
      setActionError(err.message || 'Remove failed')
    }
  }

  if (loading) return <AppLayout><div className="message info">Loading shelf...</div></AppLayout>
  if (!shelf) return <AppLayout><div className="message error">{error || 'Shelf not found'}</div></AppLayout>

  return (
    <AppLayout>
      <Hero
        title={shelf.name}
        description={shelf.description}
        actions={
          <div className="row" style={{ alignItems: 'center', gap: 8 }}>
            <label className="label" htmlFor="visibility">Visibility</label>
            <select
              id="visibility"
              className="input"
              value={shelf.visibility || 'private'}
              onChange={(e) => handleVisibilityChange(e.target.value)}
              disabled={savingVisibility}
              style={{ maxWidth: 220 }}
            >
              {VISIBILITY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        }
      >
        <span className="pill">{shelf.type}</span>
        {message && <div className="message success">{message}</div>}
        {(error || actionError) && <div className="message error">{actionError || error}</div>}
      </Hero>

      <Grid columns={2} style={{ alignItems: 'start' }}>
        <Card title="Items">
          <div className="stack" style={{ gap: 12 }}>
            {items.map((it) => {
              const isCollectable = Boolean(it.collectable)
              const collectableId = isCollectable ? (it.collectable?._id || it.collectable?.id) : null
              const linkTarget = collectableId ? legacyPath(`/collectables/${collectableId}`) : null
              const collectableMeta = isCollectable ? [
                it.collectable.author ? `by ${it.collectable.author}` : '',
                it.collectable.format || '',
                it.collectable.publisher || '',
                it.collectable.year || '',
              ].filter(Boolean).join('  ') : ''
              const manualMeta = !isCollectable && it.manual ? [
                it.manual.type || '',
                it.manual.description || '',
              ].filter(Boolean).join('  ') : ''

              return (
                <div key={it.id} className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
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
                      <div className="item-link">
                        <strong>Untitled item</strong>
                      </div>
                    )}
                  </div>
                  <Button variant="ghost" onClick={() => handleRemoveItem(it.id)}>Remove</Button>
                </div>
              )
            })}
            {!items.length && <div className="label">No items yet. Add something below!</div>}
          </div>
        </Card>

        <div className="stack" style={{ gap: 16 }}>
          <Card title="Add Manual Item">
            <form className="stack" onSubmit={handleManualSubmit}>
              <input
                className="input"
                placeholder="Name"
                value={manual.name}
                onChange={(e) => setManual({ ...manual, name: e.target.value })}
              />
              <input
                className="input"
                placeholder="Type"
                value={manual.type}
                onChange={(e) => setManual({ ...manual, type: e.target.value })}
              />
              <textarea
                className="input"
                placeholder="Description"
                value={manual.description}
                onChange={(e) => setManual({ ...manual, description: e.target.value })}
              />
              <div className="row">
                <Button variant="primary" type="submit">Add</Button>
              </div>
            </form>
          </Card>

          <Card title="Search Catalog">
            <div className="stack">
              <input
                className="input"
                placeholder="Search for items"
                value={q}
                onChange={(e) => handleSearch(e.target.value)}
                onBlur={() => handleSearch(q)}
              />
              {searching && <div className="label">Searching...</div>}
              {!searching && !results.length && q && <div className="label">No results yet.</div>}
              <div className="stack" style={{ gap: 8 }}>
                {results.map((res) => (
                  <div key={res.id || res._id || res.collectableId} className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
                    <div>
                      <strong>{res.name}</strong>
                      <div className="label">{[res.type, res.author, res.year].filter(Boolean).join(' / ')}</div>
                    </div>
                    <Button onClick={() => handleAddCollectable(res.id || res._id || res.collectableId)}>Add</Button>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </div>
      </Grid>

      <p style={{ marginTop: 16 }}>
        <Button as={Link} to={legacyPath('/shelves')}>Back to shelves</Button>
      </p>
    </AppLayout>
  )
}

export default function ShelfDetail({ apiBase = '' }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const token = useMemo(() => localStorage.getItem('token') || '', [])

  useEffect(() => {
    if (!token) {
      navigate(LEGACY_BASE_PATH)
    }
  }, [navigate, token])

  if (!token) return null

  return (
    <ShelfDetailProvider apiBase={apiBase} token={token} shelfId={id}>
      <ShelfDetailContent />
    </ShelfDetailProvider>
  )
}


