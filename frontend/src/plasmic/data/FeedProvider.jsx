import { DataProvider } from '@plasmicapp/loader-react'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { apiFetch, getBrowserToken, resolveApiBase } from './api'

const FeedContext = createContext(null)

const DEFAULT_SCOPE = 'friends'
const DEFAULT_PAGING = { limit: 20, skip: 0, hasMore: false }

function normalizePaging(paging = {}) {
  return {
    limit: paging.limit ?? DEFAULT_PAGING.limit,
    skip: paging.skip ?? DEFAULT_PAGING.skip,
    hasMore: paging.hasMore ?? DEFAULT_PAGING.hasMore,
  }
}

export function FeedProvider({
  apiBase = '',
  token: tokenProp,
  scope: scopeProp,
  type: typeProp,
  ownerId: ownerIdProp,
  since: sinceProp,
  limit: limitProp,
  skip: skipProp,
  children,
}) {
  const token = getBrowserToken(tokenProp)
  const base = resolveApiBase(apiBase)

  const [scopeState, setScopeState] = useState(() => scopeProp || DEFAULT_SCOPE)
  const [typeState, setTypeState] = useState(() => typeProp || '')
  const [ownerState, setOwnerState] = useState(() => ownerIdProp || '')
  const [sinceState, setSinceState] = useState(() => sinceProp || '')
  const [pagingState, setPagingState] = useState(() => normalizePaging({ limit: limitProp, skip: skipProp }))
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (scopeProp !== undefined && scopeProp !== scopeState) setScopeState(scopeProp)
  }, [scopeProp, scopeState])
  useEffect(() => {
    if (typeProp !== undefined && typeProp !== typeState) setTypeState(typeProp)
  }, [typeProp, typeState])
  useEffect(() => {
    if (ownerIdProp !== undefined && ownerIdProp !== ownerState) setOwnerState(ownerIdProp)
  }, [ownerIdProp, ownerState])
  useEffect(() => {
    if (sinceProp !== undefined && sinceProp !== sinceState) setSinceState(sinceProp)
  }, [sinceProp, sinceState])
  useEffect(() => {
    const desired = normalizePaging({ limit: limitProp, skip: skipProp })
    if (limitProp !== undefined || skipProp !== undefined) {
      setPagingState(desired)
    }
  }, [limitProp, skipProp])

  const effectiveScope = scopeProp ?? scopeState
  const effectiveType = typeProp ?? typeState
  const effectiveOwner = ownerIdProp ?? ownerState
  const effectiveSince = sinceProp ?? sinceState
  const effectiveLimit = limitProp ?? pagingState.limit
  const effectiveSkip = skipProp ?? pagingState.skip

  const refresh = useCallback(async () => {
    if (!token) {
      setEntries([])
      setError('')
      setLoading(false)
      return
    }
    const params = new URLSearchParams()
    if (effectiveScope) params.set('scope', effectiveScope)
    if (effectiveType) params.set('type', effectiveType)
    if (effectiveOwner) params.set('ownerId', effectiveOwner)
    if (effectiveSince) params.set('since', effectiveSince)
    params.set('limit', String(effectiveLimit))
    params.set('skip', String(effectiveSkip))

    try {
      setLoading(true)
      setError('')
      const data = await apiFetch(`/api/feed?${params.toString()}`, { apiBase: base, token })
      setEntries(Array.isArray(data?.entries) ? data.entries : [])
      setPagingState(normalizePaging({ ...data?.paging, limit: effectiveLimit, skip: effectiveSkip }))
    } catch (err) {
      setError(err.message || 'Failed to load feed')
      setEntries([])
      setPagingState(normalizePaging({ limit: effectiveLimit, skip: effectiveSkip }))
    } finally {
      setLoading(false)
    }
  }, [base, effectiveLimit, effectiveOwner, effectiveScope, effectiveSince, effectiveSkip, effectiveType, token])

  useEffect(() => {
    refresh()
  }, [refresh])

  const setScope = useCallback(
    (value) => {
      setScopeState(value)
    },
    []
  )

  const setType = useCallback(
    (value) => {
      setTypeState(value)
    },
    []
  )

  const setOwnerId = useCallback(
    (value) => {
      setOwnerState(value)
    },
    []
  )

  const setSince = useCallback(
    (value) => {
      setSinceState(value)
    },
    []
  )

  const setPaging = useCallback(({ limit, skip }) => {
    setPagingState((prev) => normalizePaging({
      limit: limit ?? prev.limit,
      skip: skip ?? prev.skip,
      hasMore: prev.hasMore,
    }))
  }, [])

  const value = useMemo(
    () => ({
      entries,
      loading,
      error,
      scope: effectiveScope,
      filters: { type: effectiveType, ownerId: effectiveOwner, since: effectiveSince },
      paging: { ...pagingState, limit: effectiveLimit, skip: effectiveSkip },
      refresh,
      setScope,
      setType,
      setOwnerId,
      setSince,
      setPaging,
      token,
      apiBase: base,
    }),
    [
      entries,
      loading,
      error,
      effectiveScope,
      effectiveType,
      effectiveOwner,
      effectiveSince,
      pagingState,
      effectiveLimit,
      effectiveSkip,
      refresh,
      setScope,
      setType,
      setOwnerId,
      setSince,
      setPaging,
      token,
      base,
    ]
  )

  return (
    <FeedContext.Provider value={value}>
      <DataProvider name="feedEntries" data={entries}>
        <DataProvider name="feedLoading" data={loading}>
          <DataProvider name="feedError" data={error}>
            <DataProvider name="feedScope" data={effectiveScope}>
              <DataProvider
                name="feedFilters"
                data={{ type: effectiveType, ownerId: effectiveOwner, since: effectiveSince }}
              >
                <DataProvider name="feedPaging" data={{ ...pagingState, limit: effectiveLimit, skip: effectiveSkip }}>
                  {typeof children === 'function' ? children(value) : children}
                </DataProvider>
              </DataProvider>
            </DataProvider>
          </DataProvider>
        </DataProvider>
      </DataProvider>
    </FeedContext.Provider>
  )
}

export function useFeed() {
  const ctx = useContext(FeedContext)
  if (!ctx) {
    throw new Error('useFeed must be used within a FeedProvider')
  }
  return ctx
}
