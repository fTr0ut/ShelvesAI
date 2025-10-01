import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ShelvesProvider, useShelves } from '../plasmic/data/ShelvesProvider'

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
    return <div className="app"><div className="message info">Loading shelves...</div></div>
  }

  return (
    <div className="app">
      <div className="hero">
        <h1>My Shelves</h1>
        <p>Organize collections by type and description.</p>
      </div>

      {(error || submitError) && <div className="message error">{submitError || error}</div>}

      <div className="grid grid-2" style={{ marginTop: 8 }}>
        <div className="card">
          <h3>Create Shelf</h3>
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
              <button className="btn primary" type="submit" disabled={submitting}>
                {submitting ? 'Creating…' : 'Create'}
              </button>
            </div>
          </form>
        </div>
        <div className="card">
          <h3>Existing Shelves</h3>
          <ul className="list">
            {shelves.map((s) => (
              <li key={s._id} className="row" style={{ justifyContent: 'space-between' }}>
                <div>
                  <Link to={`/shelves/${s._id}`}>{s.name}</Link>
                  <span className="pill" style={{ marginLeft: 8 }}>{s.type}</span>
                  <span className="pill" style={{ marginLeft: 8, backgroundColor: '#1f2a3b' }}>{VISIBILITY_LABELS[s.visibility] || s.visibility}</span>
                </div>
                <Link className="btn ghost" to={`/shelves/${s._id}`}>Open</Link>
              </li>
            ))}
            {!shelves.length && <li className="label">No shelves yet. Create your first one!</li>}
          </ul>
        </div>
      </div>
      <p style={{ marginTop: 12 }}><Link to="/">Back home</Link></p>
    </div>
  )
}

export default function Shelves({ apiBase = '' }) {
  const navigate = useNavigate()
  const token = useMemo(() => localStorage.getItem('token') || '', [])

  useEffect(() => {
    if (!token) {
      navigate('/')
    }
  }, [navigate, token])

  if (!token) return null

  return (
    <ShelvesProvider apiBase={apiBase} token={token}>
      <ShelvesContent onCreate={(shelf) => shelf?._id && navigate(`/shelves/${shelf._id}`)} />
    </ShelvesProvider>
  )
}
