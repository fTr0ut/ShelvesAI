import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
  StatusBar,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { AuthContext } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import {
  getNotificationPreferences,
  updateNotificationPreferences,
} from '../services/pushNotifications'

export default function NotificationSettingsScreen({ navigation }) {
  const { token, apiBase } = useContext(AuthContext)
  const { colors, spacing, typography, shadows, radius, isDark } = useTheme()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [preferences, setPreferences] = useState({
    pushEnabled: true,
    pushLikes: true,
    pushComments: true,
    pushFriendRequests: true,
    pushFriendAccepts: true,
  })

  const styles = useMemo(
    () => createStyles({ colors, spacing, typography, shadows, radius }),
    [colors, spacing, typography, shadows, radius]
  )

  // Load preferences on mount
  useEffect(() => {
    (async () => {
      try {
        const prefs = await getNotificationPreferences({ apiBase, token })
        setPreferences(prefs)
      } catch (e) {
        console.warn('Failed to load notification preferences:', e)
        Alert.alert('Error', 'Failed to load notification preferences')
      } finally {
        setLoading(false)
      }
    })()
  }, [apiBase, token])

  const handleToggle = useCallback(
    async (key, value) => {
      const previous = preferences[key]
      const updated = { ...preferences, [key]: value }
      setPreferences(updated)

      try {
        setSaving(true)
        await updateNotificationPreferences({
          apiBase,
          token,
          preferences: { [key]: value },
        })
      } catch (e) {
        // Revert on error
        setPreferences({ ...preferences, [key]: previous })
        Alert.alert('Error', 'Failed to update preference')
      } finally {
        setSaving(false)
      }
    },
    [apiBase, token, preferences]
  )

  if (loading) {
    return (
      <View style={[styles.screen, styles.centerContainer]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    )
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor={colors.background}
      />

      <ScrollView contentContainerStyle={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backButton}
          >
            <Ionicons name="arrow-back" size={22} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Notifications</Text>
          <View style={{ width: 40 }} />
        </View>

        {/* Master Toggle */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Push Notifications</Text>

          <View style={styles.settingsRow}>
            <View style={styles.settingsLeft}>
              <Ionicons name="notifications" size={20} color={colors.text} />
              <View>
                <Text style={styles.settingsLabel}>Enable Push Notifications</Text>
                <Text style={styles.settingsHint}>
                  Receive notifications on your device
                </Text>
              </View>
            </View>
            <Switch
              value={preferences.pushEnabled}
              onValueChange={(value) => handleToggle('pushEnabled', value)}
              disabled={saving}
              trackColor={{ false: colors.border, true: colors.primary + '80' }}
              thumbColor={
                preferences.pushEnabled ? colors.primary : colors.surfaceElevated
              }
            />
          </View>
        </View>

        {/* Notification Types */}
        <View style={[styles.card, !preferences.pushEnabled && styles.cardDisabled]}>
          <Text style={styles.cardTitle}>Notification Types</Text>

          <View style={styles.settingsRow}>
            <View style={styles.settingsLeft}>
              <Ionicons name="heart" size={20} color={colors.text} />
              <Text style={styles.settingsLabel}>Likes</Text>
            </View>
            <Switch
              value={preferences.pushLikes}
              onValueChange={(value) => handleToggle('pushLikes', value)}
              disabled={saving || !preferences.pushEnabled}
              trackColor={{ false: colors.border, true: colors.primary + '80' }}
              thumbColor={
                preferences.pushLikes ? colors.primary : colors.surfaceElevated
              }
            />
          </View>

          <View style={styles.settingsRow}>
            <View style={styles.settingsLeft}>
              <Ionicons name="chatbubble" size={20} color={colors.text} />
              <Text style={styles.settingsLabel}>Comments</Text>
            </View>
            <Switch
              value={preferences.pushComments}
              onValueChange={(value) => handleToggle('pushComments', value)}
              disabled={saving || !preferences.pushEnabled}
              trackColor={{ false: colors.border, true: colors.primary + '80' }}
              thumbColor={
                preferences.pushComments ? colors.primary : colors.surfaceElevated
              }
            />
          </View>

          <View style={styles.settingsRow}>
            <View style={styles.settingsLeft}>
              <Ionicons name="person-add" size={20} color={colors.text} />
              <Text style={styles.settingsLabel}>Friend Requests</Text>
            </View>
            <Switch
              value={preferences.pushFriendRequests}
              onValueChange={(value) => handleToggle('pushFriendRequests', value)}
              disabled={saving || !preferences.pushEnabled}
              trackColor={{ false: colors.border, true: colors.primary + '80' }}
              thumbColor={
                preferences.pushFriendRequests
                  ? colors.primary
                  : colors.surfaceElevated
              }
            />
          </View>

          <View style={[styles.settingsRow, styles.lastRow]}>
            <View style={styles.settingsLeft}>
              <Ionicons name="people" size={20} color={colors.text} />
              <Text style={styles.settingsLabel}>Friend Accepts</Text>
            </View>
            <Switch
              value={preferences.pushFriendAccepts}
              onValueChange={(value) => handleToggle('pushFriendAccepts', value)}
              disabled={saving || !preferences.pushEnabled}
              trackColor={{ false: colors.border, true: colors.primary + '80' }}
              thumbColor={
                preferences.pushFriendAccepts
                  ? colors.primary
                  : colors.surfaceElevated
              }
            />
          </View>
        </View>

        <Text style={styles.footerText}>
          Push notifications are delivered to your device even when the app is closed.
          You can also manage notification permissions in your device settings.
        </Text>
      </ScrollView>
    </SafeAreaView>
  )
}

const createStyles = ({ colors, spacing, typography, shadows, radius }) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: colors.background,
    },
    centerContainer: {
      justifyContent: 'center',
      alignItems: 'center',
    },
    content: {
      padding: spacing.md,
      paddingBottom: 40,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.lg,
    },
    backButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.surface,
      justifyContent: 'center',
      alignItems: 'center',
      ...shadows.sm,
    },
    headerTitle: {
      fontSize: 18,
      fontWeight: '600',
      color: colors.text,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      padding: spacing.md,
      marginBottom: spacing.md,
      ...shadows.sm,
    },
    cardDisabled: {
      opacity: 0.5,
    },
    cardTitle: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: spacing.md,
    },
    settingsRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: spacing.sm + 2,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    lastRow: {
      borderBottomWidth: 0,
    },
    settingsLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      flex: 1,
    },
    settingsLabel: {
      fontSize: 15,
      color: colors.text,
    },
    settingsHint: {
      fontSize: 12,
      color: colors.textMuted,
      marginTop: 2,
    },
    footerText: {
      fontSize: 13,
      color: colors.textMuted,
      textAlign: 'center',
      paddingHorizontal: spacing.md,
      lineHeight: 20,
    },
  })
