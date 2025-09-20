import { useEffect, useState } from 'react'
import { Link, Outlet, Route, Routes, useNavigate } from 'react-router-dom'
import { useAuth0 } from '@auth0/auth0-react'
import './App.css'
import Shelves from './pages/Shelves.jsx'
import ShelfDetail from './pages/ShelfDetail.jsx'
import Feed from './pages/Feed.jsx'
import CollectableDetail from './pages/CollectableDetail.jsx'
import Account from './pages/Account.jsx'

function Home({ apiBase = '' }) {
  const navigate = useNavigate()
  const { isAuthenticated, loginWithRedirect, logout: auth0Logout, getAccessTokenSilently } = useAuth0()
  const [mode, setMode] = useState('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState(null)
  const [token, setToken] = useState(() => localStorage.getItem('token') || '')
  const [me, setMe] = useState(null)
  const [needsUsername, setNeedsUsername] = useState(false)

  const envBase = (import.meta.env.VITE_API_BASE || '').replace(/\/+$/, '')
  const base = (apiBase || envBase)
  const api = (path) => `${base}${path}`
  const goProtected = () => navigate('/protected')
  const goFeed = () => navigate('/feed')
  const goShelves = () => navigate('/shelves')

  useEffect(() => {
    if (!token) { setMe(null); return }
    fetch(api('/api/me'), { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((data) => setMe(data.user))
      .catch(() => setMe(null))
  }, [token])

  useEffect(() => {
    const run = async () => {
      if (!isAuthenticated) return
      if (token) return
      try {
        const accessToken = await getAccessTokenSilently()
        const res = await fetch(api('/api/auth0/consume'), { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } })
        const data = await res.json()
        if (!res.ok) throw new Error(data?.error || 'Auth0 consume failed')
        setToken(data.token)
        localStorage.setItem('token', data.token)
        setNeedsUsername(Boolean(data.needsUsername))
        setMessage('Logged in with Auth0')
        if (!data.needsUsername) goFeed()
      } catch (e) {
        setMessage('Auth0 exchange failed; check backend config')
      }
    }
    run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated])

  const handleLogin = async (e) => {
    e.preventDefault()
    setMessage(null)
    try {
      const res = await fetch(api('/api/login'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Login failed')
      setToken(data.token)
      localStorage.setItem('token', data.token)
      setMessage(`Logged in as ${data?.user?.username || username}`)
      goFeed()
    } catch (err) {
      setMessage(err.message || 'Login failed')
    }
  }

  const handleRegister = async (e) => {
    e.preventDefault()
    setMessage(null)
    try {
      const res = await fetch(api('/api/register'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Registration failed')
      setMessage('Registration successful. You can now log in.')
      setMode('login')
    } catch (err) {
      setMessage(err.message || 'Registration failed')
    }
  }

  const logout = () => { setToken(''); localStorage.removeItem('token'); setMe(null) }

  return (
    <div className="app">
      <div className="hero">
        <h1>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
        <p>Showcase your collections with beautiful, shareable shelves.</p>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="row" style={{ marginBottom: 8 }}>
            <button className={`btn ${mode==='login'?'primary':''}`} onClick={() => setMode('login')} disabled={mode==='login'}>Login</button>
            <button className={`btn ${mode==='register'?'primary':''}`} onClick={() => setMode('register')} disabled={mode==='register'}>Register</button>
          </div>
          <form className="stack" onSubmit={mode === 'login' ? handleLogin : handleRegister}>
            <div className="stack">
              <label className="label">Username</label>
              <input className="input" value={username} placeholder="Your username" onChange={(e) => setUsername(e.target.value)} />
            </div>
            <div className="stack">
              <label className="label">Password</label>
              <input className="input" value={password} type="password" placeholder="••••••••" onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="row">
              <button className="btn primary" type="submit">{mode === 'login' ? 'Login' : 'Create Account'}</button>
            </div>
            {message && <div className="message info">{message}</div>}
          </form>
        </div>

        <div className="card">
          <h3>Getting started</h3>
          <p className="label">After logging in, create a shelf and add items manually or from the catalog.</p>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn" onClick={goProtected}>Protected Page</button>
            <button className="btn" onClick={goShelves}>My Shelves</button>
            <Link className="btn ghost" to="/account">Account</Link>
          </div>
          <div style={{ marginTop: 12 }}>
            {token ? (
              <div className="message success">You are logged in. <button className="btn ghost" onClick={logout} style={{ marginLeft: 8 }}>Logout</button></div>
            ) : (
              <div className="message error">No token. Please login or register.</div>
            )}
          </div>
          {needsUsername && (
            <div className="card" style={{ marginTop: 12 }}>
              <h3>Choose a username</h3>
              <form className="row" onSubmit={async (e) => {
                e.preventDefault()
                try {
                  const res = await fetch(api('/api/username'), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ username }) })
                  const data = await res.json()
                  if (!res.ok) throw new Error(data?.error || 'Failed to set username')
                  setMe(data.user)
                  setNeedsUsername(false)
                  setMessage('Username set')
                } catch (err) { setMessage(err.message) }
              }}>
                <input className="input" value={username} placeholder="Pick a unique username" onChange={(e) => setUsername(e.target.value)} />
                <button className="btn primary" type="submit">Save</button>
              </form>
            </div>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Auth0 (optional)</h2>
        <p className="label">Use Auth0 for SSO, then exchange for a local JWT.</p>
        <div className="row" style={{ marginTop: 8 }}>
          {import.meta.env.VITE_AUTH0_DOMAIN && import.meta.env.VITE_AUTH0_CLIENT_ID ? (
            !isAuthenticated ? (
              <button className="btn" onClick={() => loginWithRedirect()}>Login with Auth0</button>
            ) : (
              <>
                <button className="btn" onClick={() => auth0Logout({ logoutParams: { returnTo: window.location.origin } })}>Logout Auth0</button>
                <button className="btn" onClick={async () => {
                  try {
                    const accessToken = await getAccessTokenSilently()
                    const res = await fetch(api('/api/auth0/me'), { headers: { Authorization: `Bearer ${accessToken}` } })
                    const data = await res.json()
                    setMessage('Auth0 token valid. Claims received.')
                    console.log('Auth0 claims', data)
                  } catch (e) { setMessage('Auth0 call failed; check domain/audience config and backend package') }
                }}>Test Auth0 /api/auth0/me</button>
                <button className="btn" onClick={async () => {
                  try {
                    const accessToken = await getAccessTokenSilently()
                    const res = await fetch(api('/api/auth0/sync'), { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } })
                    const data = await res.json()
                    if (!res.ok) throw new Error(data?.error || 'Sync failed')
                    setMessage('Auth0 profile synced to MongoDB')
                    console.log('Auth0 sync', data)
                  } catch (e) { setMessage('Auth0 sync failed; check backend logs and DB connection') }
                }}>Sync Auth0 profile to DB</button>
              </>
            )
          ) : (
            <p style={{ color: '#f29999' }}>Auth0 not configured. Add VITE_AUTH0_DOMAIN, VITE_AUTH0_CLIENT_ID, and VITE_AUTH0_AUDIENCE to frontend/.env.local, rebuild, and reload.</p>
          )}
        </div>
      </div>
    </div>
  )
}

function Protected({ apiBase = '' }) {
  const navigate = useNavigate()
  const [status, setStatus] = useState('checking')
  const [user, setUser] = useState(null)

  useEffect(() => {
    const t = localStorage.getItem('token')
    if (!t) { setStatus('no-token'); navigate('/'); return }
    const envBase = (import.meta.env.VITE_API_BASE || '').replace(/\/+$/, '')
    const base = (apiBase || envBase)
    fetch(`${base}/api/me`, { headers: { Authorization: `Bearer ${t}` } })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((data) => { setUser(data.user); setStatus('ok') })
      .catch(() => { setStatus('unauthorized'); navigate('/') })
  }, [apiBase, navigate])

  if (status !== 'ok') return <div className="app"><div className="message info">Loading…</div></div>
  return (
    <div className="app">
      <div className="card">
        <h1>Protected Page</h1>
        <p>Welcome, <strong>{user.username}</strong></p>
        <p className="label">This content is protected by your local JWT.</p>
        <p><Link className="btn" to="/">Go Home</Link></p>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/feed" element={<Feed />} />
        <Route path="/protected" element={<Protected />} />
        <Route path="/shelves" element={<Shelves />} />
        <Route path="/shelves/:id" element={<ShelfDetail />} />
        <Route path="/collectables/:id" element={<CollectableDetail />} />
        <Route path="/account" element={<Account />} />
        <Route path="*" element={<Home />} />
      </Route>
    </Routes>
  )
}

function Layout() {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : ''
  return (
    <>
      <header className="navbar">
        <div className="brand"><Link to="/">Shelves.AI</Link></div>
        <nav>
          <Link to="/feed">Feed</Link>
          <Link to="/shelves">Shelves</Link>
          <Link to="/account">Account</Link>
          <Link to="/">Home</Link>
          {token ? <span className="pill">Logged in</span> : <span className="pill">Guest</span>}
        </nav>
      </header>
      <main className="container">
        <Outlet />
      </main>
    </>
  )
}
