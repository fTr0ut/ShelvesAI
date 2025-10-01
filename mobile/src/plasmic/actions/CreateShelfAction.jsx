import React, { useCallback, useContext, useMemo, useState } from 'react'
import { DataProvider } from '@plasmicapp/loader-react'
import { AuthContext } from '../../App'
import { apiRequest } from '../../services/api'
import { renderActionChildren } from './utils'

const DEFAULT_VISIBILITY = 'private'

export default function CreateShelfAction({
  name = '',
  type = '',
  description = '',
  visibility = DEFAULT_VISIBILITY,
  payload: payloadProp = {},
  children,
  onSuccess,
  onError,
}) {
  const { token, apiBase } = useContext(AuthContext)
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

      const nextName = `${overrides.name ?? name}`.trim()
      if (!nextName) {
        const err = new Error('Shelf name is required')
        setError(err.message)
        setStatus('error')
        onError?.(err)
        throw err
      }

      const body = {
        name: nextName,
        type: `${overrides.type ?? type}`.trim(),
        description: `${overrides.description ?? description}`.trim(),
        visibility: overrides.visibility ?? visibility ?? DEFAULT_VISIBILITY,
        ...payloadProp,
        ...(overrides.payload || {}),
      }

      setStatus('loading')
      setError('')
      setResult(null)

      try {
        const data = await apiRequest({
          apiBase,
          path: '/api/shelves',
          method: 'POST',
          token,
          body,
        })
        setResult(data)
        setStatus('success')
        onSuccess?.(data)
        return data
      } catch (err) {
        const message = err?.message || 'Failed to create shelf'
        setError(message)
        setStatus('error')
        onError?.(err)
        throw err
      }
    },
    [apiBase, description, name, onError, onSuccess, payloadProp, token, type, visibility],
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

