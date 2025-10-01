import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AppLayout, Button, Card, Grid, Hero } from '../components'
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

  if (loading) return <AppLayout><div className="message info">Loading…</div></AppLayout>

  if (!account) {
    return (
      <AppLayout>
        <div className="message error">{error || 'Account not found'}</div>
        <p style={{ marginTop: 12 }}>
          <Button as={Link} to="/shelves">Back to shelves</Button>
        </p>
      </AppLayout>
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
    <AppLayout>
      <Hero title="Account & Settings" description="Control your profile details and privacy." />
      {(msg || formError || error) && (
        <>
          {msg && <div className="message success">{msg}</div>}
          {(formError || error) && <div className="message error">{formError || error}</div>}
        </>
      )}
      <Card>
        <Grid as="form" columns={2} onSubmit={handleSubmit} style={{ gap: 16 }}>
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
          <div className="stack" style={{ gridColumn: '1 / -1' }}>
            <label className="label">Private Profile</label>
            <div className="row"><input type="checkbox" checked={!!form.isPrivate} onChange={(e) => setForm({ ...form, isPrivate: e.target.checked })} /><span className="label">Only friends can view your page</span></div>
          </div>
          <div className="row" style={{ gridColumn: '1 / -1' }}>
            <Button variant="primary" type="submit">Save</Button>
          </div>
        </Grid>
      </Card>
      <p style={{ marginTop: 12 }}>
        <Button as={Link} to="/">Home</Button> <span className="label">·</span> <Button as={Link} to="/shelves" variant="ghost">My Shelves</Button>
      </p>
    </AppLayout>
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
