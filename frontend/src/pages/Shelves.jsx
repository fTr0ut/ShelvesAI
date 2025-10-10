import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AppLayout, Button, Card, Grid, Hero, ShelfListItem } from '../components'
import { LEGACY_BASE_PATH, legacyPath } from '../legacy/constants.js'
import { ShelvesProvider, useShelves } from '../data/ShelvesProvider'

const VISIBILITY_LABELS = { private: 'Private', friends: 'Friends', public: 'Public' }
const VISIBILITY_OPTIONS = ['private', 'friends', 'public']

function ShelvesContent({ onCreate }) {
  const { shelves, loading, error, createShelf } = useShelves()
  const [form, setForm] = useState({ name: '', type: '', description: '', visibility: 'private' })
  const [submitError, setSubmitError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSubmitError('')
    try {
      setSubmitting(true)
      const shelf = await createShelf({
        name: form.name,
        type: form.type,
        description: form.description,
        visibility: form.visibility,
      })
      if (shelf) {
        setForm({ name: '', type: '', description: '', visibility: form.visibility })
        onCreate?.(shelf)
      }
    } catch (err) {
      setSubmitError(err.message || 'Create failed')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return <AppLayout><div className="message info">Loading shelves...</div></AppLayout>
  }

  return (
    <AppLayout>
      <Hero title="My Shelves" description="Organize collections by type and description." />

      {(error || submitError) && <div className="message error">{submitError || error}</div>}

      <Grid columns={2} style={{ marginTop: 8 }}>
        <Card title="Create Shelf">
          <form className="stack" onSubmit={handleSubmit}>
            <input
              className="input"
              placeholder="Name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <input
              className="input"
              placeholder="Type (e.g., books, movies)"
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
            />
            <input
              className="input"
              placeholder="Description"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
            <select
              className="input"
              value={form.visibility}
              onChange={(e) => setForm({ ...form, visibility: e.target.value })}
            >
              {VISIBILITY_OPTIONS.map((option) => (
                <option key={option} value={option}>{VISIBILITY_LABELS[option]}</option>
              ))}
            </select>
            <div className="row">
              <Button variant="primary" type="submit" disabled={submitting}>
                {submitting ? 'Creating...' : 'Create'}
              </Button>
            </div>
          </form>
        </Card>
        <Card title="Existing Shelves">
          <div className="stack" style={{ gap: 12 }}>
            {shelves.map((s) => (
              <ShelfListItem
                key={s._id}
                name={s.name}
                typeLabel={s.type}
                visibilityLabel={VISIBILITY_LABELS[s.visibility] || s.visibility}
                description={s.description}
                actions={(
                  <Button as={Link} to={legacyPath(`/shelves/${s._id}`)} variant="ghost">
                    Open
                  </Button>
                )}
              />
            ))}
            {!shelves.length && <div className="label">No shelves yet. Create your first one!</div>}
          </div>
        </Card>
      </Grid>
      <p style={{ marginTop: 12 }}><Link to={legacyPath()}>Back home</Link></p>
    </AppLayout>
  )
}

export default function Shelves({ apiBase = '' }) {
  const navigate = useNavigate()
  const token = useMemo(() => localStorage.getItem('token') || '', [])

  useEffect(() => {
    if (!token) {
      navigate(LEGACY_BASE_PATH)
    }
  }, [navigate, token])

  if (!token) return null

  return (
    <ShelvesProvider apiBase={apiBase} token={token}>
      <ShelvesContent onCreate={(shelf) => shelf?._id && navigate(legacyPath(`/shelves/${shelf._id}`))} />
    </ShelvesProvider>
  )
}


