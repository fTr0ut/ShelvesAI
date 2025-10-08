import { useMemo } from 'react'
import { useSyncExternalStore } from 'react'
import { getBindingForTarget, subscribeToComponentBindings } from './componentBindings'

const normaliseTarget = (target) => {
  if (!target) return null
  const surfaceId = String(target.surfaceId || '').trim()
  const slotId = String(target.slotId || '').trim()
  const nodeId = String(target.nodeId || '').trim()
  if (!surfaceId || !slotId || !nodeId) return null
  return { surfaceId, slotId, nodeId }
}

export const useComponentBinding = (target) => {
  const stableTarget = useMemo(() => normaliseTarget(target), [target])

  const getSnapshot = () => {
    if (!stableTarget) return null
    return getBindingForTarget(stableTarget)
  }

  return useSyncExternalStore(subscribeToComponentBindings, getSnapshot, getSnapshot)
}
