import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

export default function Account({ apiBase = '' }) {
  const navigate = useNavigate()
  const token = localStorage.getItem('token') || ''
  const envBase = (import.meta.env.VITE_API_BASE || '').replace(/\/+$/, '')
  const base = (apiBase || envBase)
  const api = (p) => `${base}${p}`
  const [user, setUser] = useState(null)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!token) { navigate('/'); return }
    const load = async () => {
      try {
        const res = await fetch(api('/api/account'), { headers: { Authorization: `Bearer ${token}` } })
        const data = await res.json()
        if (!res.ok) throw new Error(data?.error || 'Failed to load account')
        setUser(data.user)
      } catch (e) { setErr(e.message) }
    }
    load()
  }, [token])

  const update = async (e) => {
    e.preventDefault()
    setMsg(''); setErr('')
    try {
      const res = await fetch(api('/api/account'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(user),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Update failed')
      setUser(data.user)
      setMsg('Saved')
    } catch (e) { setErr(e.message) }
  }

  if (!user) return <div className="app"><div className="message info">Loading…</div></div>

  return (
    <div className="app">
      <div className="hero">
        <h1>Account & Settings</h1>
        <p>Control your profile details and privacy.</p>
      </div>
      {msg && <div className="message success">{msg}</div>}
      {err && <div className="message error">{err}</div>}
      <div className="card">
        <form className="grid grid-2" onSubmit={update}>
          <div className="stack">
            <label className="label">First Name</label>
            <input className="input" value={user.firstName || ''} onChange={(e) => setUser({ ...user, firstName: e.target.value })} />
          </div>
          <div className="stack">
            <label className="label">Last Name</label>
            <input className="input" value={user.lastName || ''} onChange={(e) => setUser({ ...user, lastName: e.target.value })} />
          </div>
          <div className="stack">
            <label className="label">Phone</label>
            <input className="input" value={user.phoneNumber || ''} onChange={(e) => setUser({ ...user, phoneNumber: e.target.value })} />
          </div>
          <div className="stack">
            <label className="label">Country</label>
            <input className="input" value={user.country || ''} onChange={(e) => setUser({ ...user, country: e.target.value })} />
          </div>
          <div className="stack">
            <label className="label">City</label>
            <input className="input" value={user.city || ''} onChange={(e) => setUser({ ...user, city: e.target.value })} />
          </div>
          <div className="stack">
            <label className="label">State</label>
            <input className="input" value={user.state || ''} onChange={(e) => setUser({ ...user, state: e.target.value })} />
          </div>
          <div className="stack">
            <label className="label">Private Profile</label>
            <div className="row"><input type="checkbox" checked={!!user.isPrivate} onChange={(e) => setUser({ ...user, isPrivate: e.target.checked })} /><span className="label">Only friends can view your page</span></div>
          </div>
          <div className="row"><button className="btn primary" type="submit">Save</button></div>
        </form>
      </div>
      <p style={{ marginTop: 12 }}>
        <Link className="btn" to="/">Home</Link> <span className="label">·</span> <Link className="btn ghost" to="/shelves">My Shelves</Link>
      </p>
    </div>
  )
}
