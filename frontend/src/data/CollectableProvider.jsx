/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { apiFetch, getBrowserToken, resolveApiBase } from './api'

const CollectableContext = createContext(null)

export function CollectableProvider({ collectableId, apiBase = '', token: tokenProp, children }) {
  const token = getBrowserToken(tokenProp)
  const base = resolveApiBase(apiBase)
  const [collectable, setCollectable] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchCollectable = useCallback(async () => {
    if (!token || !collectableId) {
      setCollectable(null)
      setLoading(false)
      setError(collectableId ? '' : 'Missing collectable id')
      return
    }
    try {
      setLoading(true)
      setError('')
      const data = await apiFetch(`/api/collectables/${collectableId}`, { apiBase: base, token })
      setCollectable(data?.collectable || null)
    } catch (err) {
      setError(err.message || 'Collectable not found')
      setCollectable(null)
    } finally {
      setLoading(false)
    }
  }, [base, collectableId, token])

  useEffect(() => {
    fetchCollectable()
  }, [fetchCollectable])

  const value = useMemo(
    () => ({ collectable, loading, error, refresh: fetchCollectable, token, apiBase: base, collectableId }),
    [collectable, loading, error, fetchCollectable, token, base, collectableId]
  )

  return (
    <CollectableContext.Provider value={value}>
      {typeof children === 'function' ? children(value) : children}
    </CollectableContext.Provider>
  )
}

export function useCollectable() {
  const ctx = useContext(CollectableContext)
  if (!ctx) {
    throw new Error('useCollectable must be used within a CollectableProvider')
  }
  return ctx
}
