import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AccountProvider, useAccount } from '../plasmic/data/AccountProvider'

function AccountContent() {
  const { account, loading, error, updateAccount } = useAccount()
  const [form, setForm] = useState(null)
  const [msg, setMsg] = useState('')
  const [formError, setFormError] = useState('')

  useEffect(() => {
    if (account) {
      setForm({ ...account })
    }
  }, [account])

  if (loading) return <div className="app"><div className="message info">Loading…</div></div>

  if (!account) {
    return (
      <div className="app">
        <div className="message error">{error || 'Account not found'}</div>
        <p style={{ marginTop: 12 }}>
          <Link className="btn" to="/shelves">Back to shelves</Link>
        </p>
      </div>
    )
  }

  if (!form) return null

  const handleSubmit = async (e) => {
    e.preventDefault()
    setMsg('')
    setFormError('')
    try {
      const updated = await updateAccount(form)
      setForm(updated)
      setMsg('Saved')
    } catch (err) {
      setFormError(err.message || 'Update failed')
    }
  }

  return (
    <div className="app">
      <div className="hero">
        <h1>Account & Settings</h1>
        <p>Control your profile details and privacy.</p>
      </div>
      {(msg || formError || error) && (
        <>
          {msg && <div className="message success">{msg}</div>}
          {(formError || error) && <div className="message error">{formError || error}</div>}
        </>
      )}
      <div className="card">
        <form className="grid grid-2" onSubmit={handleSubmit}>
          <div className="stack">
            <label className="label">First Name</label>
            <input className="input" value={form.firstName || ''} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
          </div>
          <div className="stack">
            <label className="label">Last Name</label>
            <input className="input" value={form.lastName || ''} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
          </div>
          <div className="stack">
            <label className="label">Phone</label>
            <input className="input" value={form.phoneNumber || ''} onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })} />
          </div>
          <div className="stack">
            <label className="label">Country</label>
            <input className="input" value={form.country || ''} onChange={(e) => setForm({ ...form, country: e.target.value })} />
          </div>
          <div className="stack">
            <label className="label">City</label>
            <input className="input" value={form.city || ''} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          </div>
          <div className="stack">
            <label className="label">State</label>
            <input className="input" value={form.state || ''} onChange={(e) => setForm({ ...form, state: e.target.value })} />
          </div>
          <div className="stack">
            <label className="label">Private Profile</label>
            <div className="row"><input type="checkbox" checked={!!form.isPrivate} onChange={(e) => setForm({ ...form, isPrivate: e.target.checked })} /><span className="label">Only friends can view your page</span></div>
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

export default function Account({ apiBase = '' }) {
  const navigate = useNavigate()
  const token = useMemo(() => localStorage.getItem('token') || '', [])

  useEffect(() => {
    if (!token) { navigate('/'); }
  }, [navigate, token])

  if (!token) return null

  return (
    <AccountProvider apiBase={apiBase} token={token}>
      <AccountContent />
    </AccountProvider>
  )
}
