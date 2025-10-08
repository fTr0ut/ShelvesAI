import { useSyncExternalStore } from 'react'
import { getProjectSettings, subscribeToProjectSettings } from './projectSettings'

export const useProjectSettings = () => {
  return useSyncExternalStore(subscribeToProjectSettings, getProjectSettings, getProjectSettings)
}
