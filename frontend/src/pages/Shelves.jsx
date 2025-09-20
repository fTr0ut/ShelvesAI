import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

const VISIBILITY_LABELS = { private: 'Private', friends: 'Friends', public: 'Public' }
const VISIBILITY_OPTIONS = ['private', 'friends', 'public']

export default function Shelves({ apiBase = '' }) {
  const navigate = useNavigate()
  const [shelves, setShelves] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ name: '', type: '', description: '', visibility: 'private' })

  const envBase = (import.meta.env.VITE_API_BASE || '').replace(/\/+$/, '')
  const base = apiBase || envBase
  const api = (p) => `${base}${p}`
  const token = localStorage.getItem('token') || ''

  useEffect(() => {
    if (!token) {
      navigate('/')
      return
    }
    const load = async () => {
      try {
        setLoading(true)
        const res = await fetch(api('/api/shelves'), { headers: { Authorization: `Bearer ${token}` } })
        const data = await res.json()
        if (!res.ok) throw new Error(data?.error || 'Failed to load shelves')
        setShelves(data.shelves)
      } catch (e) {
        setError(e.message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [token])

  const create = async (e) => {
    e.preventDefault()
    setError('')
    try {
      const res = await fetch(api('/api/shelves'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: form.name,
          type: form.type,
          description: form.description,
          visibility: form.visibility,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Create failed')
      setForm({ name: '', type: '', description: '', visibility: form.visibility })
      navigate(`/shelves/${data.shelf._id}`)
    } catch (e) {
      setError(e.message)
    }
  }

  if (loading) return <div className="app"><div className="message info">Loading shelves...</div></div>

  return (
    <div className="app">
      <div className="hero">
        <h1>My Shelves</h1>
        <p>Organize collections by type and description.</p>
      </div>

      {error && <div className="message error">{error}</div>}

      <div className="grid grid-2" style={{ marginTop: 8 }}>
        <div className="card">
          <h3>Create Shelf</h3>
          <form className="stack" onSubmit={create}>
            <input className="input" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className="input" placeholder="Type (e.g., books, movies)" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} />
            <input className="input" placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <select className="input" value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value })}>
              {VISIBILITY_OPTIONS.map((option) => (
                <option key={option} value={option}>{VISIBILITY_LABELS[option]}</option>
              ))}
            </select>
            <div className="row">
              <button className="btn primary" type="submit">Create</button>
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

