/* eslint-disable react-refresh/only-export-components */
import { DataProvider } from '@plasmicapp/loader-react'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { apiFetch, getBrowserToken, resolveApiBase } from './api'

const ShelvesContext = createContext(null)

const DEFAULT_PAGINATION = { limit: 20, skip: 0, total: 0, hasMore: false }

function normalizePagination(pagination = {}) {
  return {
    limit: pagination.limit ?? DEFAULT_PAGINATION.limit,
    skip: pagination.skip ?? DEFAULT_PAGINATION.skip,
    total: pagination.total ?? DEFAULT_PAGINATION.total,
    hasMore: pagination.hasMore ?? DEFAULT_PAGINATION.hasMore,
  }
}

export function ShelvesProvider({
  apiBase = '',
  token: tokenProp,
  limit: limitProp,
  skip: skipProp,
  children,
}) {
  const token = getBrowserToken(tokenProp)
  const base = resolveApiBase(apiBase)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [shelves, setShelves] = useState([])
  const [pagination, setPagination] = useState(() => normalizePagination({ limit: limitProp, skip: skipProp }))

  const effectiveLimit = limitProp ?? pagination.limit
  const effectiveSkip = skipProp ?? pagination.skip

  const refresh = useCallback(async () => {
    if (!token) {
      setShelves([])
      setPagination(normalizePagination({ limit: effectiveLimit, skip: effectiveSkip }))
      setError('')
      setLoading(false)
      return
    }
    try {
      setLoading(true)
      setError('')
      const data = await apiFetch(`/api/shelves?limit=${effectiveLimit}&skip=${effectiveSkip}`, {
        apiBase: base,
        token,
      })
      setShelves(Array.isArray(data?.shelves) ? data.shelves : [])
      setPagination(normalizePagination({ ...data?.pagination, limit: effectiveLimit, skip: effectiveSkip }))
    } catch (err) {
      setError(err.message || 'Failed to load shelves')
      setShelves([])
      setPagination(normalizePagination({ limit: effectiveLimit, skip: effectiveSkip }))
    } finally {
      setLoading(false)
    }
  }, [base, effectiveLimit, effectiveSkip, token])

  useEffect(() => {
    refresh()
  }, [refresh])

  const createShelf = useCallback(
    async ({ name, type, description = '', visibility = 'private', position }) => {
      if (!token) throw new Error('Missing authentication token')
      const payload = {
        name,
        type,
        description,
        visibility,
      }
      if (position && typeof position === 'object') {
        payload.position = position
      }
      const data = await apiFetch('/api/shelves', {
        apiBase: base,
        token,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      await refresh()
      return data?.shelf || null
    },
    [base, refresh, token]
  )

  const value = useMemo(
    () => ({ shelves, pagination, loading, error, refresh, createShelf, token, apiBase: base }),
    [shelves, pagination, loading, error, refresh, createShelf, token, base]
  )

  return (
    <ShelvesContext.Provider value={value}>
      <DataProvider name="shelves" data={shelves}>
        <DataProvider name="shelvesPagination" data={pagination}>
          <DataProvider name="shelvesLoading" data={loading}>
            <DataProvider name="shelvesError" data={error}>
              {typeof children === 'function' ? children(value) : children}
            </DataProvider>
          </DataProvider>
        </DataProvider>
      </DataProvider>
    </ShelvesContext.Provider>
  )
}

export function useShelves() {
  const ctx = useContext(ShelvesContext)
  if (!ctx) {
    throw new Error('useShelves must be used within a ShelvesProvider')
  }
  return ctx
}
