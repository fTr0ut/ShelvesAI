import { useSyncExternalStore } from 'react'
import { getComponentLibrary, subscribeToComponentLibrary } from './componentLoader'

export const useComponentLibrary = () => {
  return useSyncExternalStore(subscribeToComponentLibrary, getComponentLibrary, getComponentLibrary)
}
