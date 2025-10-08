import { useSyncExternalStore } from 'react'
import { getComponentBindings, subscribeToComponentBindings } from './componentBindings'

export const useComponentBindings = () => {
  return useSyncExternalStore(subscribeToComponentBindings, getComponentBindings, getComponentBindings)
}
