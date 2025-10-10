import './polyfills/text-encoder.js'
import { StrictMode } from 'react'
import { BrowserRouter } from 'react-router-dom'
import { Auth0Provider } from '@auth0/auth0-react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

const domain = import.meta.env.VITE_AUTH0_DOMAIN
const clientId = import.meta.env.VITE_AUTH0_CLIENT_ID
const audience = import.meta.env.VITE_AUTH0_AUDIENCE

if (!domain || !clientId) {
  console.warn('Auth0 not configured (set VITE_AUTH0_DOMAIN and VITE_AUTH0_CLIENT_ID in frontend/.env.local). Rendering without Auth0Provider.')
}

console.log('main.jsx running')

const app = (
  <BrowserRouter>
    <App />
  </BrowserRouter>
)

const maybeWrappedApp = domain && clientId ? (
  <Auth0Provider
    domain={domain}
    clientId={clientId}
    authorizationParams={{
      redirect_uri: window.location.origin,
      audience,
      scope: 'openid profile email',
    }}
    cacheLocation="localstorage"
    useRefreshTokens
  >
    {app}
  </Auth0Provider>
) : (
  app
)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {maybeWrappedApp}
  </StrictMode>,
)
