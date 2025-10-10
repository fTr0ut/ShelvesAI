/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { apiFetch, getBrowserToken, resolveApiBase } from './api'

export const ShelfDetailContext = createContext(null)

const DEFAULT_ITEMS_PAGINATION = { limit: 25, skip: 0, hasMore: false }

function normalizeItemsPaging(paging = {}) {
  return {
    limit: paging.limit ?? DEFAULT_ITEMS_PAGINATION.limit,
    skip: paging.skip ?? DEFAULT_ITEMS_PAGINATION.skip,
    hasMore: paging.hasMore ?? DEFAULT_ITEMS_PAGINATION.hasMore,
  }
}

export function ShelfDetailProvider({
  shelfId,
  apiBase = '',
  token: tokenProp,
  itemLimit: limitProp,
  itemSkip: skipProp,
  children,
}) {
  const token = getBrowserToken(tokenProp)
  const base = resolveApiBase(apiBase)
  const [shelf, setShelf] = useState(null)
  const [items, setItems] = useState([])
  const [itemsPaging, setItemsPaging] = useState(() => normalizeItemsPaging({ limit: limitProp, skip: skipProp }))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [savingVisibility, setSavingVisibility] = useState(false)

  const effectiveLimit = limitProp ?? itemsPaging.limit
  const effectiveSkip = skipProp ?? itemsPaging.skip

  const loadShelf = useCallback(async () => {
    if (!token || !shelfId) {
      setShelf(null)
      setItems([])
      setLoading(false)
      setError(shelfId ? '' : 'Missing shelf id')
      return
    }
    try {
      setLoading(true)
      setError('')
      const [shelfData, itemsData] = await Promise.all([
        apiFetch(`/api/shelves/${shelfId}`, { apiBase: base, token }),
        apiFetch(`/api/shelves/${shelfId}/items?limit=${effectiveLimit}&skip=${effectiveSkip}`, {
          apiBase: base,
          token,
        }),
      ])
      setShelf(shelfData?.shelf || null)
      setItems(Array.isArray(itemsData?.items) ? itemsData.items : [])
      setItemsPaging(
        normalizeItemsPaging({
          ...itemsData?.pagination,
          limit: effectiveLimit,
          skip: effectiveSkip,
        })
      )
    } catch (err) {
      setError(err.message || 'Failed to load shelf')
      setShelf(null)
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [base, effectiveLimit, effectiveSkip, shelfId, token])

  useEffect(() => {
    loadShelf()
  }, [loadShelf])

  const refreshItems = useCallback(async () => {
    if (!token || !shelfId) return
    try {
      const data = await apiFetch(`/api/shelves/${shelfId}/items?limit=${effectiveLimit}&skip=${effectiveSkip}`, {
        apiBase: base,
        token,
      })
      setItems(Array.isArray(data?.items) ? data.items : [])
      setItemsPaging(
        normalizeItemsPaging({
          ...data?.pagination,
          limit: effectiveLimit,
          skip: effectiveSkip,
        })
      )
    } catch (err) {
      setError(err.message || 'Failed to refresh items')
    }
  }, [base, effectiveLimit, effectiveSkip, shelfId, token])

  const changeVisibility = useCallback(
    async (visibility) => {
      if (!token || !shelfId) throw new Error('Missing authentication context')
      if (!visibility) return
      setSavingVisibility(true)
      setMessage('')
      try {
        const data = await apiFetch(`/api/shelves/${shelfId}`, {
          apiBase: base,
          token,
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ visibility }),
        })
        setShelf(data?.shelf || null)
        setMessage(`Visibility updated to ${visibility}`)
      } catch (err) {
        setError(err.message || 'Failed to update visibility')
      } finally {
        setSavingVisibility(false)
      }
    },
    [base, shelfId, token]
  )

  const addManual = useCallback(
    async (manual) => {
      if (!token || !shelfId) throw new Error('Missing authentication context')
      const payload = manual || {}
      await apiFetch(`/api/shelves/${shelfId}/manual`, {
        apiBase: base,
        token,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      await refreshItems()
    },
    [base, refreshItems, shelfId, token]
  )

  const addCollectable = useCallback(
    async (collectableId) => {
      if (!token || !shelfId) throw new Error('Missing authentication context')
      await apiFetch(`/api/shelves/${shelfId}/items`, {
        apiBase: base,
        token,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collectableId }),
      })
      await refreshItems()
    },
    [base, refreshItems, shelfId, token]
  )

  const removeItem = useCallback(
    async (itemId) => {
      if (!token || !shelfId) throw new Error('Missing authentication context')
      await apiFetch(`/api/shelves/${shelfId}/items/${itemId}`, {
        apiBase: base,
        token,
        method: 'DELETE',
      })
      await refreshItems()
    },
    [base, refreshItems, shelfId, token]
  )

  const searchCollectables = useCallback(
    async (query) => {
      if (!token || !shelfId) throw new Error('Missing authentication context')
      const q = String(query || '').trim()
      if (!q) return []
      const data = await apiFetch(`/api/shelves/${shelfId}/search?q=${encodeURIComponent(q)}`, {
        apiBase: base,
        token,
      })
      return Array.isArray(data?.results) ? data.results : []
    },
    [base, shelfId, token]
  )

  const value = useMemo(
    () => ({
      shelf,
      items,
      itemsPaging: { ...itemsPaging, limit: effectiveLimit, skip: effectiveSkip },
      loading,
      error,
      message,
      savingVisibility,
      refresh: loadShelf,
      refreshItems,
      changeVisibility,
      addManual,
      addCollectable,
      removeItem,
      searchCollectables,
      token,
      apiBase: base,
      shelfId,
    }),
    [
      shelf,
      items,
      itemsPaging,
      effectiveLimit,
      effectiveSkip,
      loading,
      error,
      message,
      savingVisibility,
      loadShelf,
      refreshItems,
      changeVisibility,
      addManual,
      addCollectable,
      removeItem,
      searchCollectables,
      token,
      base,
      shelfId,
    ]
  )

  return (
    <ShelfDetailContext.Provider value={value}>
      {typeof children === 'function' ? children(value) : children}
    </ShelfDetailContext.Provider>
  )
}

export function useShelfDetail() {
  const ctx = useContext(ShelfDetailContext)
  if (!ctx) {
    throw new Error('useShelfDetail must be used within a ShelfDetailProvider')
  }
  return ctx
}
