/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { apiFetch, getBrowserToken, resolveApiBase } from './api'

export const AccountContext = createContext(null)

export function AccountProvider({ apiBase = '', token: tokenProp, children }) {
  const token = getBrowserToken(tokenProp)
  const base = resolveApiBase(apiBase)
  const [account, setAccount] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadAccount = useCallback(async () => {
    if (!token) {
      setAccount(null)
      setLoading(false)
      setError('')
      return
    }
    try {
      setLoading(true)
      setError('')
      const data = await apiFetch('/api/account', { apiBase: base, token })
      setAccount(data?.user || null)
    } catch (err) {
      setError(err.message || 'Failed to load account')
      setAccount(null)
    } finally {
      setLoading(false)
    }
  }, [base, token])

  useEffect(() => {
    loadAccount()
  }, [loadAccount])

  const updateAccount = useCallback(
    async (updates) => {
      if (!token) throw new Error('Missing authentication token')
      const data = await apiFetch('/api/account', {
        apiBase: base,
        token,
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates || {}),
      })
      setAccount(data?.user || null)
      return data?.user || null
    },
    [base, token]
  )

  const value = useMemo(
    () => ({ account, loading, error, refresh: loadAccount, updateAccount, token, apiBase: base }),
    [account, loading, error, loadAccount, updateAccount, token, base]
  )

  return (
    <AccountContext.Provider value={value}>
      {typeof children === 'function' ? children(value) : children}
    </AccountContext.Provider>
  )
}

export function useAccount() {
  const ctx = useContext(AccountContext)
  if (!ctx) {
    throw new Error('useAccount must be used within an AccountProvider')
  }
  return ctx
}
