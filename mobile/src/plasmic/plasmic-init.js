import { initPlasmicLoader } from '@plasmicapp/loader-react'
import Constants from 'expo-constants'
import { registerCollectorMobileComponents } from './register-components'
import { registerDataProviders } from './register-data-providers'
import { registerActions } from './register-actions'

function readPlasmicConfig() {
  const extra = Constants?.expoConfig?.extra || {}
  const plasmic = extra?.plasmic || {}
  const projectId = plasmic.projectId || extra.PLASMIC_PROJECT_ID || ''
  const publicToken = plasmic.publicToken || extra.PLASMIC_PUBLIC_TOKEN || ''
  const host = (plasmic.host || extra.PLASMIC_HOST || '').replace(/\/+$/, '')
  const component = plasmic.component || 'CollectorMobileAppLayout'
  const pagePath = plasmic.pagePath || ''
  const webViewUrl = plasmic.webViewUrl || extra.PLASMIC_WEBVIEW_URL || ''
  const projects = Array.isArray(plasmic.projects) && plasmic.projects.length
    ? plasmic.projects
    : (projectId && publicToken ? [{ id: projectId, token: publicToken }] : [])
  return { projects, host, component, pagePath, webViewUrl }
}

const config = readPlasmicConfig()

if (!config.projects.length) {
  console.warn('Plasmic configuration is missing project credentials. Update app.json extra.plasmic.')
}

export const PLASMIC = initPlasmicLoader({
  projects: config.projects,
  preview: true,
  host: config.host || undefined,
})

registerDataProviders(PLASMIC)
registerCollectorMobileComponents(PLASMIC)
registerActions(PLASMIC)

export function getPlasmicDefaults() {
  return config
}
