import React, { useCallback, useContext, useMemo, useState } from 'react'
import { DataProvider } from '@plasmicapp/loader-react'
import { AuthContext } from '../../App'
import { apiRequest } from '../../services/api'
import { useFriendSearchSync } from '../../hooks/useFriendSearchSync'
import { renderActionChildren } from './utils'

export default function SendFriendRequestAction({
  userId,
  message = '',
  payload: payloadProp = {},
  children,
  onSuccess,
  onError,
}) {
  const { token, apiBase } = useContext(AuthContext)
  const { setBusyForUser, handleRequestSuccess, handleMutationError } = useFriendSearchSync()
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  const run = useCallback(
    async (overrides = {}) => {
      if (!apiBase) {
        const err = new Error('Missing API base URL')
        setError(err.message)
        setStatus('error')
        onError?.(err)
        throw err
      }
      if (!token) {
        const err = new Error('Missing auth token')
        setError(err.message)
        setStatus('error')
        onError?.(err)
        throw err
      }

      const targetUserId = overrides.userId ?? userId ?? payloadProp.userId
      if (!targetUserId) {
        const err = new Error('Missing target user id')
        setError(err.message)
        setStatus('error')
        onError?.(err)
        throw err
      }

      const body = {
        ...payloadProp,
        ...(overrides.payload || {}),
        targetUserId,
      }
      const nextMessage = overrides.message ?? message
      if (nextMessage) {
        body.message = nextMessage
      }

      setStatus('loading')
      setError('')
      setResult(null)
      if (typeof setBusyForUser === 'function') {
        setBusyForUser(targetUserId, true)
      }

      try {
        const data = await apiRequest({
          apiBase,
          path: '/api/friends/request',
          method: 'POST',
          token,
          body,
        })
        setResult(data)
        setStatus('success')
        if (typeof handleRequestSuccess === 'function') {
          handleRequestSuccess(targetUserId, data)
        }
        onSuccess?.(data)
        return data
      } catch (err) {
        const messageText = err?.message || 'Failed to send friend request'
        setError(messageText)
        setStatus('error')
        if (typeof handleMutationError === 'function') {
          handleMutationError(messageText)
        }
        onError?.(err)
        throw err
      } finally {
        if (typeof setBusyForUser === 'function') {
          setBusyForUser(targetUserId, false)
        }
      }
    },
    [
      apiBase,
      handleMutationError,
      handleRequestSuccess,
      message,
      onError,
      onSuccess,
      payloadProp,
      setBusyForUser,
      token,
      userId,
    ],
  )

  const actionState = useMemo(
    () => ({ status, error, result, run }),
    [error, result, run, status],
  )

  return (
    <DataProvider name="status" data={status}>
      <DataProvider name="error" data={error}>
        <DataProvider name="result" data={result}>
          {renderActionChildren(children, actionState)}
        </DataProvider>
      </DataProvider>
    </DataProvider>
  )
}

