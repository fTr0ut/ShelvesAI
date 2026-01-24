import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  registerForPushNotifications,
  registerPushTokenWithBackend,
  unregisterPushToken,
  addNotificationReceivedListener,
  addNotificationResponseReceivedListener,
  getLastNotificationResponse,
  parseNotificationData,
  setBadgeCount,
} from '../services/pushNotifications'
import { AuthContext } from './AuthContext'

const PUSH_TOKEN_KEY = 'expoPushToken'

export const PushContext = createContext({
  expoPushToken: null,
  isRegistered: false,
  registerPush: () => {},
  unregisterPush: () => {},
})

export function PushProvider({ children, navigationRef }) {
  const { token, apiBase, user } = useContext(AuthContext)
  const [expoPushToken, setExpoPushToken] = useState(null)
  const [isRegistered, setIsRegistered] = useState(false)

  const notificationListener = useRef()
  const responseListener = useRef()

  /**
   * Handle navigation based on notification data
   */
  const handleNotificationNavigation = useCallback((data) => {
    if (!navigationRef?.current || !data) return

    const { type, entityId, entityType } = data

    // Navigate based on notification type
    if (type === 'like' || type === 'comment') {
      // Navigate to feed detail for likes and comments
      if (entityType === 'event' && entityId) {
        navigationRef.current.navigate('FeedDetail', { eventId: entityId })
      }
    } else if (type === 'friend_request' || type === 'friend_accept') {
      // Navigate to notifications screen for friend-related notifications
      navigationRef.current.navigate('Notifications')
    }
  }, [navigationRef])

  /**
   * Register for push notifications
   */
  const registerPush = useCallback(async () => {
    if (!token || !apiBase) return

    try {
      // Get Expo push token
      let pushToken = expoPushToken

      if (!pushToken) {
        pushToken = await registerForPushNotifications()
        if (!pushToken) {
          console.log('Could not get push token')
          return
        }
        setExpoPushToken(pushToken)
        await AsyncStorage.setItem(PUSH_TOKEN_KEY, pushToken)
      }

      // Register with backend
      await registerPushTokenWithBackend({
        apiBase,
        token,
        expoPushToken: pushToken,
      })

      setIsRegistered(true)
      console.log('Push notifications registered successfully')
    } catch (error) {
      console.error('Failed to register push notifications:', error)
    }
  }, [token, apiBase, expoPushToken])

  /**
   * Unregister push notifications (on logout)
   */
  const unregisterPush = useCallback(async () => {
    if (!token || !apiBase || !expoPushToken) return

    try {
      await unregisterPushToken({
        apiBase,
        token,
        expoPushToken,
      })

      setIsRegistered(false)
      // Clear stored token
      await AsyncStorage.removeItem(PUSH_TOKEN_KEY)
      setExpoPushToken(null)
    } catch (error) {
      console.error('Failed to unregister push notifications:', error)
    }
  }, [token, apiBase, expoPushToken])

  // Load stored push token on mount
  useEffect(() => {
    AsyncStorage.getItem(PUSH_TOKEN_KEY).then((storedToken) => {
      if (storedToken) {
        setExpoPushToken(storedToken)
      }
    })
  }, [])

  // Register push notifications when user logs in
  useEffect(() => {
    if (token && user && !isRegistered) {
      registerPush()
    }
  }, [token, user, isRegistered, registerPush])

  // Set up notification listeners
  useEffect(() => {
    // Listener for notifications received while app is in foreground
    notificationListener.current = addNotificationReceivedListener((notification) => {
      console.log('Notification received in foreground:', notification)
      // Could show a custom in-app alert here if desired
    })

    // Listener for when user taps on a notification
    responseListener.current = addNotificationResponseReceivedListener((response) => {
      console.log('Notification tapped:', response)
      const data = parseNotificationData(response.notification)
      handleNotificationNavigation(data)

      // Clear badge when user interacts with notification
      setBadgeCount(0)
    })

    // Check if app was opened via notification
    getLastNotificationResponse().then((response) => {
      if (response) {
        const data = parseNotificationData(response.notification)
        // Delay navigation slightly to ensure navigation is ready
        setTimeout(() => handleNotificationNavigation(data), 500)
      }
    })

    return () => {
      if (notificationListener.current) {
        notificationListener.current.remove()
      }
      if (responseListener.current) {
        responseListener.current.remove()
      }
    }
  }, [handleNotificationNavigation])

  const value = {
    expoPushToken,
    isRegistered,
    registerPush,
    unregisterPush,
  }

  return (
    <PushContext.Provider value={value}>
      {children}
    </PushContext.Provider>
  )
}

export function usePush() {
  return useContext(PushContext)
}
