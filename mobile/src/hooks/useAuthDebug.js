import { useCallback } from 'react'
import { Alert } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'

const TOKEN_KEYS = ['token', 'auth0_token', 'refresh_token']

/**
 * Hook to quickly clear persisted auth tokens during dev/testing.
 */
export default function useAuthDebug() {
  const clearAuthCache = useCallback(async () => {
    try {
      await Promise.all(TOKEN_KEYS.map((key) => AsyncStorage.removeItem(key)))
      Alert.alert('Auth cache cleared', 'All stored tokens have been removed.')
    } catch (err) {
      console.error('Error clearing auth token cache:', err)
      Alert.alert('Failed to clear cache', err?.message || 'Unknown error')
    }
  }, [])

  return { clearAuthCache }
}
