import React, { useCallback, useContext, useMemo, useState } from 'react'
import { DataProvider } from '@plasmicapp/loader-react'
import { AuthContext } from '../../App'
import { apiRequest } from '../../services/api'
import { useShelfDetailSync } from '../../hooks/useShelfDetailSync'
import { renderActionChildren } from './utils'

export default function AddShelfItemAction({
  shelfId,
  collectableId,
  payload: payloadProp = {},
  children,
  onSuccess,
  onError,
}) {
  const { token, apiBase } = useContext(AuthContext)
  const { shelfId: contextShelfId, onItemAdded, refreshItems } = useShelfDetailSync()
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

      const targetShelfId = overrides.shelfId ?? shelfId ?? contextShelfId
      if (!targetShelfId) {
        const err = new Error('Missing shelf id for adding item')
        setError(err.message)
        setStatus('error')
        onError?.(err)
        throw err
      }

      const resolvedCollectableId = overrides.collectableId ?? collectableId ?? payloadProp.collectableId
      if (!resolvedCollectableId) {
        const err = new Error('Missing collectable id')
        setError(err.message)
        setStatus('error')
        onError?.(err)
        throw err
      }

      const body = {
        collectableId: resolvedCollectableId,
        ...payloadProp,
        ...(overrides.payload || {}),
      }

      setStatus('loading')
      setError('')
      setResult(null)

      try {
        const data = await apiRequest({
          apiBase,
          path: `/api/shelves/${targetShelfId}/items`,
          method: 'POST',
          token,
          body,
        })
        setResult(data)
        setStatus('success')
        if (typeof onItemAdded === 'function') {
          await onItemAdded(data)
        } else if (typeof refreshItems === 'function') {
          await refreshItems()
        }
        onSuccess?.(data)
        return data
      } catch (err) {
        const message = err?.message || 'Failed to add item to shelf'
        setError(message)
        setStatus('error')
        onError?.(err)
        throw err
      }
    },
    [
      apiBase,
      collectableId,
      contextShelfId,
      onError,
      onItemAdded,
      onSuccess,
      payloadProp,
      refreshItems,
      shelfId,
      token,
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

