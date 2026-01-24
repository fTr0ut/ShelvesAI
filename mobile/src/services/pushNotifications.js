import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import { Platform } from 'react-native'
import Constants from 'expo-constants'
import { apiRequest } from './api'

// Configure how notifications are handled when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
})

/**
 * Register for push notifications and get the Expo push token
 * Returns the token string or null if registration fails
 */
export async function registerForPushNotifications() {
  // Push notifications only work on physical devices
  if (!Device.isDevice) {
    console.log('Push notifications require a physical device')
    return null
  }

  try {
    // Check/request permissions
    const { status: existingStatus } = await Notifications.getPermissionsAsync()
    let finalStatus = existingStatus

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync()
      finalStatus = status
    }

    if (finalStatus !== 'granted') {
      console.log('Push notification permission denied')
      return null
    }

    // Get the Expo push token
    const projectId = Constants?.expoConfig?.extra?.eas?.projectId
    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId,
    })

    // Android requires notification channel
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#FF231F7C',
      })
    }

    return tokenData.data
  } catch (error) {
    console.error('Error registering for push notifications:', error)
    return null
  }
}

/**
 * Register push token with backend
 */
export async function registerPushTokenWithBackend({ apiBase, token, expoPushToken }) {
  try {
    const response = await apiRequest({
      apiBase,
      path: '/api/push/register',
      method: 'POST',
      token,
      body: {
        expoPushToken,
        platform: Platform.OS,
        deviceId: Device.deviceName || undefined,
      },
    })
    return response
  } catch (error) {
    console.error('Error registering push token with backend:', error)
    throw error
  }
}

/**
 * Unregister push token from backend (on logout)
 */
export async function unregisterPushToken({ apiBase, token, expoPushToken }) {
  try {
    const response = await apiRequest({
      apiBase,
      path: '/api/push/unregister',
      method: 'POST',
      token,
      body: { expoPushToken },
    })
    return response
  } catch (error) {
    console.error('Error unregistering push token:', error)
    // Don't throw - we want logout to succeed even if this fails
  }
}

/**
 * Get notification preferences from backend
 */
export async function getNotificationPreferences({ apiBase, token }) {
  const response = await apiRequest({
    apiBase,
    path: '/api/push/preferences',
    method: 'GET',
    token,
  })
  return response.preferences
}

/**
 * Update notification preferences on backend
 */
export async function updateNotificationPreferences({ apiBase, token, preferences }) {
  const response = await apiRequest({
    apiBase,
    path: '/api/push/preferences',
    method: 'PATCH',
    token,
    body: preferences,
  })
  return response.preferences
}

/**
 * Add listener for notifications received while app is in foreground
 */
export function addNotificationReceivedListener(callback) {
  return Notifications.addNotificationReceivedListener(callback)
}

/**
 * Add listener for when user taps on a notification
 */
export function addNotificationResponseReceivedListener(callback) {
  return Notifications.addNotificationResponseReceivedListener(callback)
}

/**
 * Get the last notification response that opened the app
 */
export async function getLastNotificationResponse() {
  return Notifications.getLastNotificationResponseAsync()
}

/**
 * Clear all notifications
 */
export async function clearAllNotifications() {
  await Notifications.dismissAllNotificationsAsync()
}

/**
 * Set badge count (iOS)
 */
export async function setBadgeCount(count) {
  await Notifications.setBadgeCountAsync(count)
}

/**
 * Parse notification data for navigation
 */
export function parseNotificationData(notification) {
  const data = notification?.request?.content?.data
  if (!data) return null

  return {
    type: data.type,
    entityId: data.entityId,
    entityType: data.entityType,
    notificationId: data.notificationId,
  }
}
