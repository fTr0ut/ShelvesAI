import './polyfills/text-encoder.js'
import { StrictMode } from 'react'
import { BrowserRouter } from 'react-router-dom'
import { Auth0Provider } from '@auth0/auth0-react'
import { createRoot } from 'react-dom/client'
import { PlasmicRootProvider } from '@plasmicapp/react-web'
import GlobalContextsProvider from './plasmic-codegen/antd_5_hostless/PlasmicGlobalContextsProvider'
import { PLASMIC } from './plasmic-init'
import './index.css'
import '@plasmicapp/react-web/lib/plasmic.css'
import './components/plasmic/plasmicStyles.module.css'
import App from './App.jsx'

const domain = import.meta.env.VITE_AUTH0_DOMAIN
const clientId = import.meta.env.VITE_AUTH0_CLIENT_ID
const audience = import.meta.env.VITE_AUTH0_AUDIENCE

if (!domain || !clientId) {
  console.warn('Auth0 not configured (set VITE_AUTH0_DOMAIN and VITE_AUTH0_CLIENT_ID in frontend/.env.local). Rendering without Auth0Provider.')
}

console.log('main.jsx running')

const routedApp = (
  <BrowserRouter>
    <App />
  </BrowserRouter>
)

const plasmicApp = (
  <PlasmicRootProvider loader={PLASMIC}>
    <GlobalContextsProvider>
      {routedApp}
    </GlobalContextsProvider>
  </PlasmicRootProvider>
)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {domain && clientId ? (
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
        {plasmicApp}
      </Auth0Provider>
    ) : (
      plasmicApp
    )}
  </StrictMode>,
)
