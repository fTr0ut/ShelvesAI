import { DataProvider } from '@plasmicapp/loader-react'
import { forwardRef, useCallback, useContext, useImperativeHandle, useState } from 'react'
import { apiFetch } from '../data/api'
import { AccountContext } from '../data/AccountProvider'

export const SendFriendRequestAction = forwardRef(function SendFriendRequestAction(props, ref) {
  const { targetUserId = '', message = '', apiBase = '', children = null } = props

  const accountContext = useContext(AccountContext)

  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('idle')

  const run = useCallback(
    async (overrides = {}) => {
      const resolvedTarget = String(overrides.targetUserId ?? targetUserId ?? '').trim()
      const resolvedMessage = overrides.message ?? message ?? ''
      const baseOption = overrides.apiBase ?? apiBase ?? accountContext?.apiBase

      if (!resolvedTarget) {
        const errMessage = 'Target user id is required to send a friend request'
        setStatus('error')
        setError(errMessage)
        setResult(null)
        throw new Error(errMessage)
      }

      setStatus('loading')
      setError('')
      setResult(null)

      try {
        const data = await apiFetch('/api/friends/request', {
          apiBase: baseOption,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetUserId: resolvedTarget, message: resolvedMessage }),
          credentials: 'include',
        })
        setResult(data ?? null)
        setStatus('success')

        if (accountContext?.refresh) {
          try {
            await accountContext.refresh()
          } catch (refreshErr) {
            console.warn('SendFriendRequestAction: unable to refresh account after request', refreshErr)
          }
        }

        return data
      } catch (err) {
        const errMessage = err?.message || 'Failed to send friend request'
        setError(errMessage)
        setStatus('error')
        throw err
      }
    },
    [accountContext, apiBase, message, targetUserId]
  )

  useImperativeHandle(
    ref,
    () => ({
      run,
    }),
    [run]
  )

  return (
    <DataProvider name="sendFriendRequestResult" data={result}>
      <DataProvider name="sendFriendRequestError" data={error}>
        <DataProvider name="sendFriendRequestStatus" data={status}>
          {children}
        </DataProvider>
      </DataProvider>
    </DataProvider>
  )
})
