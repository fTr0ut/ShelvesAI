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
import SystemBroadcastModal from '../components/SystemBroadcastModal'

const PUSH_TOKEN_KEY = 'expoPushToken'

export const PushContext = createContext({
  expoPushToken: null,
  isRegistered: false,
  registerPush: () => {},
  unregisterPush: () => {},
  broadcastMessage: null,
  dismissBroadcast: () => {},
})

export function PushProvider({ children, navigationRef }) {
  const { token, apiBase, user } = useContext(AuthContext)
  const [expoPushToken, setExpoPushToken] = useState(null)
  const [isRegistered, setIsRegistered] = useState(false)
  const [broadcastMessage, setBroadcastMessage] = useState(null)

  const notificationListener = useRef()
  const responseListener = useRef()
  const isMountedRef = useRef(true)
  const launchNavigationTimeoutRef = useRef(null)

  /**
   * Handle navigation based on notification data
   */
  const dismissBroadcast = useCallback(() => setBroadcastMessage(null), [])

  const handleNotificationNavigation = useCallback((data) => {
    if (!data) return

    const { type, entityId, entityType, metadata, title, body, broadcastId } = data

    if (type === 'system_broadcast') {
      setBroadcastMessage({ title, body, broadcastId })
      return
    }

    if (!navigationRef?.current) return

    // Navigate based on notification type
    if (type === 'like' || type === 'comment' || type === 'mention') {
      // Navigate to feed detail for likes, comments, and mentions
      if (entityType === 'event' && entityId) {
        navigationRef.current.navigate('FeedDetail', { id: entityId })
      }
    } else if (type === 'friend_request' || type === 'friend_accept') {
      // Navigate to notifications screen for friend-related notifications
      navigationRef.current.navigate('Notifications')
    } else if (type === 'workflow_complete' || type === 'workflow_failed') {
      const shelfId = Number(metadata?.shelfId)
      if (Number.isFinite(shelfId) && shelfId > 0) {
        navigationRef.current.navigate('ShelfDetail', { id: shelfId })
      } else {
        navigationRef.current.navigate('Main', { screen: 'Shelves' })
      }
    }
  }, [navigationRef, setBroadcastMessage])

  /**
   * Register for push notifications
   */
  const registerPush = useCallback(async () => {
    if (!token || !apiBase) return

    try {
      // Always fetch the current Expo token so rotations are detected promptly.
      const latestPushToken = await registerForPushNotifications()
      if (!latestPushToken) {
        if (__DEV__) console.log('Could not get push token')
        return
      }

      if (expoPushToken !== latestPushToken) {
        if (isMountedRef.current) {
          setExpoPushToken(latestPushToken)
        }
        await AsyncStorage.setItem(PUSH_TOKEN_KEY, latestPushToken)
      }

      // Register with backend
      await registerPushTokenWithBackend({
        apiBase,
        token,
        expoPushToken: latestPushToken,
      })

      if (isMountedRef.current) {
        setIsRegistered(true)
      }
      if (__DEV__) console.log('Push notifications registered successfully')
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

      if (isMountedRef.current) {
        setIsRegistered(false)
      }
      // Clear stored token
      await AsyncStorage.removeItem(PUSH_TOKEN_KEY)
      if (isMountedRef.current) {
        setExpoPushToken(null)
      }
    } catch (error) {
      console.error('Failed to unregister push notifications:', error)
    }
  }, [token, apiBase, expoPushToken])

  useEffect(() => {
    return () => {
      isMountedRef.current = false
      if (launchNavigationTimeoutRef.current) {
        clearTimeout(launchNavigationTimeoutRef.current)
      }
    }
  }, [])

  // Load stored push token on mount
  useEffect(() => {
    let cancelled = false
    AsyncStorage.getItem(PUSH_TOKEN_KEY).then((storedToken) => {
      if (cancelled || !isMountedRef.current) return
      if (storedToken) {
        setExpoPushToken(storedToken)
      }
    })
    return () => {
      cancelled = true
    }
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
      if (__DEV__) console.log('Notification received in foreground:', notification)
      const data = parseNotificationData(notification)
      if (data?.type === 'system_broadcast') {
        setBroadcastMessage({ title: data.title, body: data.body, broadcastId: data.broadcastId })
      }
    })

    // Listener for when user taps on a notification
    responseListener.current = addNotificationResponseReceivedListener((response) => {
      if (__DEV__) console.log('Notification tapped:', response)
      const data = parseNotificationData(response.notification)
      handleNotificationNavigation(data)

      // Clear badge when user interacts with notification
      setBadgeCount(0)
    })

    // Check if app was opened via notification
    let cancelled = false
    getLastNotificationResponse().then((response) => {
      if (cancelled || !isMountedRef.current) return
      if (response) {
        const data = parseNotificationData(response.notification)
        // Delay navigation slightly to ensure navigation is ready
        launchNavigationTimeoutRef.current = setTimeout(() => {
          if (!isMountedRef.current) return
          handleNotificationNavigation(data)
        }, 500)
      }
    })

    return () => {
      cancelled = true
      if (launchNavigationTimeoutRef.current) {
        clearTimeout(launchNavigationTimeoutRef.current)
        launchNavigationTimeoutRef.current = null
      }
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
    broadcastMessage,
    dismissBroadcast,
  }

  return (
    <PushContext.Provider value={value}>
      {children}
      <SystemBroadcastModal
        visible={broadcastMessage !== null}
        title={broadcastMessage?.title}
        body={broadcastMessage?.body}
        broadcastId={broadcastMessage?.broadcastId}
        onDismiss={dismissBroadcast}
      />
    </PushContext.Provider>
  )
}

export function usePush() {
  return useContext(PushContext)
}
