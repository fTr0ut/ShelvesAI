import { useEffect, useState } from 'react'
import { Link, Navigate, Outlet, Route, Routes, useNavigate } from 'react-router-dom'
import { useAuth0 } from '@auth0/auth0-react'
import './App.css'
import { AppLayout, Button, Card, Grid, Hero } from './components'
import Shelves from './pages/Shelves.jsx'
import ShelfDetail from './pages/ShelfDetail.jsx'
import LegacyFeed from './pages/Feed.jsx'
import PlasmicRuntime from './pages/PlasmicRuntime.jsx'
import { LEGACY_BASE_PATH, legacyPath } from './legacy/constants.js'
import CollectableDetail from './pages/CollectableDetail.jsx'
import Account from './pages/Account.jsx'
import UIEditorApp from './ui-editor/index.jsx'
import { UI_EDITOR_BASE_PATH } from './ui-editor/constants.js'

function Home({ apiBase = '' }) {
  const navigate = useNavigate()
  const { isAuthenticated, loginWithRedirect, logout: auth0Logout, getAccessTokenSilently } = useAuth0()
  const [mode, setMode] = useState('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState(null)
  const [token, setToken] = useState(() => localStorage.getItem('token') || '')
  const [, setMe] = useState(null)
  const [needsUsername, setNeedsUsername] = useState(false)

  const envBase = (import.meta.env.VITE_API_BASE || '').replace(/\/+$/, '')
  const base = (apiBase || envBase)
  const api = (path) => `${base}${path}`
  const goProtected = () => navigate(legacyPath('/protected'))
  const goFeed = () => navigate(legacyPath('/feed'))
  const goShelves = () => navigate(legacyPath('/shelves'))

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
      } catch (err) {
        console.error(err)
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
    <AppLayout>
      <Hero
        title={mode === 'login' ? 'Welcome back' : 'Create your account'}
        description="Showcase your collections with beautiful, shareable shelves."
      />

      <Grid columns={2}>
        <Card>
          <div className="row" style={{ marginBottom: 8 }}>
            <Button variant={mode === 'login' ? 'primary' : 'ghost'} onClick={() => setMode('login')} disabled={mode === 'login'}>
              Login
            </Button>
            <Button variant={mode === 'register' ? 'primary' : 'ghost'} onClick={() => setMode('register')} disabled={mode === 'register'}>
              Register
            </Button>
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
              <Button variant="primary" type="submit">
                {mode === 'login' ? 'Login' : 'Create Account'}
              </Button>
            </div>
            {message && <div className="message info">{message}</div>}
          </form>
        </Card>

        <Card title="Getting started" subtitle="After logging in, create a shelf and add items manually or from the catalog.">
          <div className="row">
            <Button onClick={goProtected}>Protected Page</Button>
            <Button onClick={goShelves}>My Shelves</Button>
            <Button as={Link} to="/account" variant="ghost">
              Account
            </Button>
          </div>
          <div>
            {token ? (
              <div className="message success">
                You are logged in.
                <Button variant="ghost" onClick={logout} style={{ marginLeft: 8 }}>
                  Logout
                </Button>
              </div>
            ) : (
              <div className="message error">No token. Please login or register.</div>
            )}
          </div>
          {needsUsername && (
            <Card title="Choose a username" padding="compact">
              <form
                className="row"
                onSubmit={async (e) => {
                  e.preventDefault()
                  try {
                    const res = await fetch(api('/api/username'), {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                      body: JSON.stringify({ username }),
                    })
                    const data = await res.json()
                    if (!res.ok) throw new Error(data?.error || 'Failed to set username')
                    setMe(data.user)
                    setNeedsUsername(false)
                    setMessage('Username set')
                  } catch (err) { setMessage(err.message) }
                }}
              >
                <input className="input" value={username} placeholder="Pick a unique username" onChange={(e) => setUsername(e.target.value)} />
                <Button variant="primary" type="submit">
                  Save
                </Button>
              </form>
            </Card>
          )}
        </Card>
      </Grid>

      <Card title="Auth0 (optional)" subtitle="Use Auth0 for SSO, then exchange for a local JWT.">
        <div className="row">
          {import.meta.env.VITE_AUTH0_DOMAIN && import.meta.env.VITE_AUTH0_CLIENT_ID ? (
            !isAuthenticated ? (
              <Button onClick={() => loginWithRedirect()}>Login with Auth0</Button>
            ) : (
              <>
                <Button onClick={() => auth0Logout({ logoutParams: { returnTo: window.location.origin } })}>
                  Logout Auth0
                </Button>
                <Button
                  onClick={async () => {
                    try {
                      const accessToken = await getAccessTokenSilently()
                      const res = await fetch(api('/api/auth0/me'), { headers: { Authorization: `Bearer ${accessToken}` } })
                      const data = await res.json()
                      setMessage('Auth0 token valid. Claims received.')
                      console.log('Auth0 claims', data)
                    } catch (err) {
                      console.error(err)
                      setMessage('Auth0 call failed; check domain/audience config and backend package')
                    }
                  }}
                >
                  Test Auth0 /api/auth0/me
                </Button>
                <Button
                  onClick={async () => {
                    try {
                      const accessToken = await getAccessTokenSilently()
                      const res = await fetch(api('/api/auth0/sync'), { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } })
                      const data = await res.json()
                      if (!res.ok) throw new Error(data?.error || 'Sync failed')
                      setMessage('Auth0 profile synced to MongoDB')
                      console.log('Auth0 sync', data)
                    } catch (err) {
                      console.error(err)
                      setMessage('Auth0 sync failed; check backend logs and DB connection')
                    }
                  }}
                >
                  Sync Auth0 profile to DB
                </Button>
              </>
            )
          ) : (
            <p style={{ color: '#f29999' }}>Auth0 not configured. Add VITE_AUTH0_DOMAIN, VITE_AUTH0_CLIENT_ID, and VITE_AUTH0_AUDIENCE to frontend/.env.local, rebuild, and reload.</p>
          )}
        </div>
      </Card>
    </AppLayout>
  )
}

function Protected({ apiBase = '' }) {
  const navigate = useNavigate()
  const [status, setStatus] = useState('checking')
  const [user, setUser] = useState(null)

  useEffect(() => {
    const t = localStorage.getItem('token')
    if (!t) { setStatus('no-token'); navigate(LEGACY_BASE_PATH); return }
    const envBase = (import.meta.env.VITE_API_BASE || '').replace(/\/+$/, '')
    const base = (apiBase || envBase)
    fetch(`${base}/api/me`, { headers: { Authorization: `Bearer ${t}` } })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((data) => { setUser(data.user); setStatus('ok') })
      .catch(() => { setStatus('unauthorized'); navigate(LEGACY_BASE_PATH) })
  }, [apiBase, navigate])

  if (status !== 'ok') return <AppLayout><div className="message info">Loading...</div></AppLayout>
  return (
    <AppLayout>
      <Card>
        <h1>Protected Page</h1>
        <p>
          Welcome, <strong>{user.username}</strong>
        </p>
        <p className="label">This content is protected by your local JWT.</p>
        <Button as={Link} to={legacyPath()}>
          Go Home
        </Button>
      </Card>
    </AppLayout>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/plasmic-host/*" element={<PlasmicHostRedirect />} />
      <Route path="/plasmic/*" element={<PlasmicRuntime routePrefix="/plasmic" />} />
      <Route path={`${LEGACY_BASE_PATH}/*`} element={<LegacyLayout />}>
        <Route index element={<Home />} />
        <Route path="feed" element={<LegacyFeed />} />
        <Route path="protected" element={<Protected />} />
        <Route path="shelves" element={<Shelves />} />
        <Route path="shelves/:id" element={<ShelfDetail />} />
        <Route path="collectables/:id" element={<CollectableDetail />} />
        <Route path="account" element={<Account />} />
        <Route path="*" element={<Navigate to={LEGACY_BASE_PATH} replace />} />
      </Route>
      <Route path={`${UI_EDITOR_BASE_PATH}/*`} element={<UIEditorApp />} />
      <Route path="*" element={<PlasmicRuntime />} />
    </Routes>
  )
}
function LegacyLayout() {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : ''
  return (
    <>
      <header className="navbar">
        <div className="brand"><Link to={legacyPath()}>Shelves.AI</Link></div>
        <nav>
          <Link to={legacyPath('/feed')}>Feed</Link>
          <Link to={legacyPath('/shelves')}>Shelves</Link>
          <Link to={legacyPath('/account')}>Account</Link>
          <Link to={UI_EDITOR_BASE_PATH}>UI Editor</Link>
          <Link to={legacyPath()}>Home</Link>
          {token ? <span className="pill">Logged in</span> : <span className="pill">Guest</span>}
        </nav>
      </header>
      <main className="container">
        <Outlet />
      </main>
    </>
  )
}

function PlasmicHostRedirect() {
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const { pathname, search, hash } = window.location
      window.location.replace(`${pathname}${search}${hash}`)
    }
  }, [])

  return null
}


