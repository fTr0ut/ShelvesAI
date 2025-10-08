import React, { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { PlasmicComponent, PlasmicRootProvider, PageParamsProvider } from '@plasmicapp/loader-react'
import GlobalContextsProvider from '../plasmic-codegen/antd_5_hostless/PlasmicGlobalContextsProvider'
import { PLASMIC } from '../plasmic-init'

const DEFAULT_PREFIXES = ['/plasmic']


const envRuntimePrefix = (() => {
  if (typeof import.meta !== 'undefined' && import.meta && import.meta.env) {
    return (
      import.meta.env.VITE_PLASMIC_RUNTIME_PREFIX ||
      import.meta.env.NEXT_PUBLIC_PLASMIC_RUNTIME_PREFIX ||
      import.meta.env.PLASMIC_RUNTIME_PREFIX ||
      ''
    )
  }

  const globalProcess = typeof globalThis !== 'undefined' && globalThis.process ? globalThis.process : undefined
  if (globalProcess && globalProcess.env) {
    const env = globalProcess.env
    return (
      env.VITE_PLASMIC_RUNTIME_PREFIX ||
      env.NEXT_PUBLIC_PLASMIC_RUNTIME_PREFIX ||
      env.PLASMIC_RUNTIME_PREFIX ||
      ''
    )
  }

  return ''
})()

const normalizePrefix = (value) => {
  if (!value) {
    return ''
  }

  if (value === '/') {
    return '/'
  }

  const withLeadingSlash = value.startsWith('/') ? value : `/${value}`
  return withLeadingSlash.replace(/\/+$/, '')
}

const resolvePrefixes = (routePrefix, extraPrefixes) => {
  const merged = [
    routePrefix,
    ...(Array.isArray(extraPrefixes) ? extraPrefixes : []),
    envRuntimePrefix,
    ...DEFAULT_PREFIXES,
    '',
  ]
    .filter((prefix) => typeof prefix === 'string')
    .map(normalizePrefix)

  return merged.filter((prefix, index) => merged.indexOf(prefix) === index)
}

export default function PlasmicRuntime({ routePrefix = '', extraPrefixes = [] }) {
  const location = useLocation()
  const [pageData, setPageData] = useState(null)
  const [status, setStatus] = useState('loading')

  const prefixes = useMemo(() => resolvePrefixes(routePrefix, extraPrefixes), [routePrefix, extraPrefixes])

  const plasmicPath = useMemo(() => {
    let raw = location.pathname || '/'

    for (const prefix of prefixes) {
      if (prefix && prefix !== '/' && raw.toLowerCase().startsWith(prefix.toLowerCase())) {
        const trimmed = raw.slice(prefix.length)
        raw = trimmed ? (trimmed.startsWith('/') ? trimmed : `/${trimmed}`) : '/'
        break
      }
    }

    if (!raw.startsWith('/')) {
      raw = `/${raw}`
    }

    return raw
  }, [location.pathname, prefixes])

  const queryParams = useMemo(() => {
    const params = new URLSearchParams(location.search)
    return Object.fromEntries(params.entries())
  }, [location.search])

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setPageData(null)

    PLASMIC.maybeFetchComponentData(plasmicPath)
      .then((data) => {
        if (cancelled) {
          return
        }
        setPageData(data)
        setStatus(data ? 'ready' : 'not-found')
      })
      .catch((err) => {
        console.warn('Failed to fetch Plasmic page:', err)
        if (!cancelled) {
          setStatus('error')
          setPageData(null)
        }
      })

    return () => {
      cancelled = true
    }
  }, [plasmicPath])

  const entryMeta = pageData?.entryCompMetas?.[0]
  const componentName = entryMeta?.name
  const pageTitle = entryMeta?.displayName || entryMeta?.name

  useEffect(() => {
    if (status === 'ready' && pageTitle && typeof document !== 'undefined') {
      document.title = pageTitle
    }
  }, [pageTitle, status])

  if (status === 'loading') {
    return <div style={styles.message}>Loading Plasmic page...</div>
  }

  if (status === 'not-found') {
    return <div style={styles.error}>No Plasmic page found for path: {plasmicPath}</div>
  }

  if (status === 'error') {
    return <div style={styles.error}>Failed to load Plasmic content.</div>
  }

  if (!componentName) {
    return <div style={styles.error}>Invalid Plasmic component metadata.</div>
  }

  return (
    <PlasmicRootProvider loader={PLASMIC} prefetchedData={pageData}>
      <GlobalContextsProvider>
        <PageParamsProvider route={plasmicPath} query={queryParams}>
          <div style={{ position: 'relative' }}>
            <PlasmicComponent component={componentName} />

          </div>
        </PageParamsProvider>
      </GlobalContextsProvider>
    </PlasmicRootProvider>
  )
}

const styles = {
  message: {
    padding: '2rem',
    textAlign: 'center',
  },
  error: {
    padding: '2rem',
    textAlign: 'center',
    color: '#d64545',
  },
}

