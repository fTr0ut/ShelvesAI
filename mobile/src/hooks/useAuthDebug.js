import { useCallback } from 'react'
import { Alert } from 'react-native'
import * as SecureStore from 'expo-secure-store'

/**
 * Hook to quickly clear SecureStore auth tokens during dev/testing.
 * Usage:
 *   const { clearAuthCache } = useAuthDebug()
 *   <Button title="Clear Cache" onPress={clearAuthCache} />
 */
export default function useAuthDebug() {
  const clearAuthCache = useCallback(async () => {
    try {
      await SecureStore.deleteItemAsync('token')
      await SecureStore.deleteItemAsync('auth0_token')
      await SecureStore.deleteItemAsync('refresh_token')
      Alert.alert('✅ Auth cache cleared', 'All tokens removed from SecureStore.')
    } catch (err) {
      console.error('Error clearing SecureStore:', err)
      Alert.alert('❌ Failed to clear cache', err.message)
    }
  }, [])

  return { clearAuthCache }
}