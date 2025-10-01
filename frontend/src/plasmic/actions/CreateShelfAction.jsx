import { DataProvider } from '@plasmicapp/loader-react'
import { forwardRef, useCallback, useContext, useImperativeHandle, useState } from 'react'
import { apiFetch } from '../data/api'
import { ShelvesContext } from '../data/ShelvesProvider'

const DEFAULT_VISIBILITY = 'private'

function normalizePosition(position) {
  if (!position || typeof position !== 'object') {
    return undefined
  }
  return position
}

export const CreateShelfAction = forwardRef(function CreateShelfAction(props, ref) {
  const {
    name,
    type,
    description = '',
    visibility = DEFAULT_VISIBILITY,
    position = undefined,
    apiBase = '',
    children = null,
  } = props

  const shelvesContext = useContext(ShelvesContext)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('idle')

  const run = useCallback(
    async (overrides = {}) => {
      const payloadName = (overrides.name ?? name ?? '').trim()
      const payloadType = (overrides.type ?? type ?? '').trim()
      const payloadDescription = overrides.description ?? description ?? ''
      const payloadVisibility = overrides.visibility ?? visibility ?? DEFAULT_VISIBILITY
      const payloadPosition = normalizePosition(overrides.position ?? position)
      const baseOption = overrides.apiBase ?? apiBase ?? shelvesContext?.apiBase

      if (!payloadName || !payloadType) {
        const message = 'Shelf name and type are required'
        setStatus('error')
        setError(message)
        setResult(null)
        throw new Error(message)
      }

      setStatus('loading')
      setError('')
      setResult(null)
      try {
        const body = {
          name: payloadName,
          type: payloadType,
          description: payloadDescription,
          visibility: payloadVisibility,
        }
        if (payloadPosition) {
          body.position = payloadPosition
        }
        const data = await apiFetch('/api/shelves', {
          apiBase: baseOption,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          credentials: 'include',
        })
        setResult(data ?? null)
        setStatus('success')
        if (shelvesContext?.refresh) {
          try {
            await shelvesContext.refresh()
          } catch (refreshErr) {
            console.warn('CreateShelfAction: unable to refresh shelves after creation', refreshErr)
          }
        }
        return data
      } catch (err) {
        const message = err?.message || 'Failed to create shelf'
        setError(message)
        setStatus('error')
        throw err
      }
    },
    [apiBase, description, name, position, shelvesContext, type, visibility]
  )

  useImperativeHandle(
    ref,
    () => ({
      run,
    }),
    [run]
  )

  return (
    <DataProvider name="createShelfResult" data={result}>
      <DataProvider name="createShelfError" data={error}>
        <DataProvider name="createShelfStatus" data={status}>
          {children}
        </DataProvider>
      </DataProvider>
    </DataProvider>
  )
})
