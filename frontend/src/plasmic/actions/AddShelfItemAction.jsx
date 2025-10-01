import { DataProvider } from '@plasmicapp/loader-react'
import { forwardRef, useCallback, useContext, useImperativeHandle, useState } from 'react'
import { apiFetch } from '../data/api'
import { ShelfDetailContext } from '../data/ShelfDetailProvider'
import { ShelvesContext } from '../data/ShelvesProvider'

function extractShelfId(detailContext) {
  if (!detailContext) {
    return ''
  }
  const { shelfId, shelf } = detailContext
  if (shelfId) {
    return String(shelfId)
  }
  if (shelf && (shelf._id || shelf.id)) {
    return String(shelf._id || shelf.id)
  }
  return ''
}

export const AddShelfItemAction = forwardRef(function AddShelfItemAction(props, ref) {
  const { shelfId = '', collectableId = '', apiBase = '', children = null } = props

  const shelfDetailContext = useContext(ShelfDetailContext)
  const shelvesContext = useContext(ShelvesContext)

  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('idle')

  const run = useCallback(
    async (overrides = {}) => {
      const resolvedShelfId = String(
        overrides.shelfId ?? shelfId ?? extractShelfId(shelfDetailContext)
      ).trim()
      const resolvedCollectableId = String(
        overrides.collectableId ?? collectableId ?? ''
      ).trim()
      const baseOption = overrides.apiBase ?? apiBase ?? shelfDetailContext?.apiBase ?? shelvesContext?.apiBase

      if (!resolvedShelfId) {
        const message = 'Shelf ID is required to add an item'
        setStatus('error')
        setError(message)
        setResult(null)
        throw new Error(message)
      }

      if (!resolvedCollectableId) {
        const message = 'Collectable ID is required to add an item'
        setStatus('error')
        setError(message)
        setResult(null)
        throw new Error(message)
      }

      setStatus('loading')
      setError('')
      setResult(null)

      try {
        const data = await apiFetch(`/api/shelves/${resolvedShelfId}/items`, {
          apiBase: baseOption,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ collectableId: resolvedCollectableId }),
          credentials: 'include',
        })
        setResult(data ?? null)
        setStatus('success')

        if (shelfDetailContext?.refreshItems) {
          try {
            await shelfDetailContext.refreshItems()
          } catch (refreshErr) {
            console.warn('AddShelfItemAction: unable to refresh shelf items', refreshErr)
          }
        }

        if (shelfDetailContext?.refresh) {
          try {
            await shelfDetailContext.refresh()
          } catch (refreshErr) {
            console.warn('AddShelfItemAction: unable to refresh shelf detail', refreshErr)
          }
        }

        if (shelvesContext?.refresh) {
          try {
            await shelvesContext.refresh()
          } catch (refreshErr) {
            console.warn('AddShelfItemAction: unable to refresh shelves list', refreshErr)
          }
        }

        return data
      } catch (err) {
        const message = err?.message || 'Failed to add item to shelf'
        setError(message)
        setStatus('error')
        throw err
      }
    },
    [apiBase, collectableId, shelfDetailContext, shelfId, shelvesContext]
  )

  useImperativeHandle(
    ref,
    () => ({
      run,
    }),
    [run]
  )

  return (
    <DataProvider name="addShelfItemResult" data={result}>
      <DataProvider name="addShelfItemError" data={error}>
        <DataProvider name="addShelfItemStatus" data={status}>
          {children}
        </DataProvider>
      </DataProvider>
    </DataProvider>
  )
})
