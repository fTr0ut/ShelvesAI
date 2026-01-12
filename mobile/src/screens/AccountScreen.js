import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AuthContext } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { apiRequest, clearToken } from '../services/api';

export default function AccountScreen({ navigation }) {
  const { token, setToken, apiBase, setNeedsOnboarding, premiumEnabled, setPremiumEnabled } = useContext(AuthContext);
  const { colors, spacing, typography, shadows, radius, isDark, toggleTheme } = useTheme();

  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [premiumSaving, setPremiumSaving] = useState(false);

  const styles = useMemo(() => createStyles({ colors, spacing, typography, shadows, radius }), [colors, spacing, typography, shadows, radius]);

  useEffect(() => {
    (async () => {
      try {
        const data = await apiRequest({ apiBase, path: '/api/account', token });
        setUser(data.user);
        if (typeof data.user?.isPremium === 'boolean') {
          setPremiumEnabled(data.user.isPremium);
        }
      } catch (e) {
        console.warn('Failed to load account:', e);
      } finally {
        setLoading(false);
      }
    })();
  }, [apiBase, token, setPremiumEnabled]);

  const handlePremiumToggle = useCallback(async (value) => {
    const previous = premiumEnabled;
    setPremiumEnabled(value);
    try {
      setPremiumSaving(true);
      await apiRequest({
        apiBase,
        path: '/api/account',
        method: 'PUT',
        token,
        body: { isPremium: value },
      });
    } catch (e) {
      setPremiumEnabled(previous);
      Alert.alert('Error', e.message);
    } finally {
      setPremiumSaving(false);
    }
  }, [apiBase, token, premiumEnabled, setPremiumEnabled]);

  const handleLogout = useCallback(() => {
    Alert.alert('Log Out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log Out',
        style: 'destructive',
        onPress: async () => {
          await clearToken();
          setNeedsOnboarding(false);
          setToken('');
        },
      },
    ]);
  }, [setToken, setNeedsOnboarding]);

  if (loading) {
    return (
      <View style={[styles.screen, styles.centerContainer]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />

      <ScrollView contentContainerStyle={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={22} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Account</Text>
          <View style={{ width: 40 }} />
        </View>

        {/* Profile Section - Tappable to go to profile */}
        <TouchableOpacity
          style={styles.profileCard}
          onPress={() => navigation.navigate('Profile')}
        >
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {(user?.firstName?.[0] || user?.username?.[0] || '?').toUpperCase()}
            </Text>
          </View>
          <View style={styles.profileInfo}>
            <Text style={styles.displayName}>
              {[user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.username}
            </Text>
            <Text style={styles.username}>@{user?.username}</Text>
            <Text style={styles.profileHint}>View & edit your profile</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </TouchableOpacity>

        {/* Settings */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Settings</Text>

          <View style={styles.settingsRow}>
            <View style={styles.settingsLeft}>
              <Ionicons name="star" size={20} color={colors.text} />
              <View>
                <Text style={styles.settingsLabel}>Premium Features</Text>
                <Text style={styles.settingsHint}>Use cloud vision scanning</Text>
              </View>
            </View>
            <Switch
              value={premiumEnabled}
              onValueChange={handlePremiumToggle}
              disabled={premiumSaving}
              trackColor={{ false: colors.border, true: colors.primary + '80' }}
              thumbColor={premiumEnabled ? colors.primary : colors.surfaceElevated}
            />
          </View>

          <TouchableOpacity style={styles.settingsRow} onPress={toggleTheme}>
            <View style={styles.settingsLeft}>
              <Ionicons name={isDark ? 'moon' : 'sunny'} size={20} color={colors.text} />
              <Text style={styles.settingsLabel}>Dark Mode</Text>
            </View>
            <Switch
              value={isDark}
              onValueChange={toggleTheme}
              trackColor={{ false: colors.border, true: colors.primary + '80' }}
              thumbColor={isDark ? colors.primary : colors.surfaceElevated}
            />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.settingsRow}
            onPress={() => navigation.navigate('Wishlists')}
          >
            <View style={styles.settingsLeft}>
              <Ionicons name="heart" size={20} color={colors.text} />
              <Text style={styles.settingsLabel}>My Wishlists</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.settingsRow}
            onPress={() => navigation.navigate('FriendsList')}
          >
            <View style={styles.settingsLeft}>
              <Ionicons name="people-circle" size={20} color={colors.text} />
              <Text style={styles.settingsLabel}>My Friends</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.settingsRow}
            onPress={() => navigation.navigate('FriendSearch')}
          >
            <View style={styles.settingsLeft}>
              <Ionicons name="person-add" size={20} color={colors.text} />
              <Text style={styles.settingsLabel}>Find Friends</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.settingsRow}
            onPress={() => navigation.navigate('About')}
          >
            <View style={styles.settingsLeft}>
              <Ionicons name="information-circle" size={20} color={colors.text} />
              <Text style={styles.settingsLabel}>About</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        {/* Logout */}
        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={20} color={colors.error} />
          <Text style={styles.logoutText}>Log Out</Text>
        </TouchableOpacity>

        <Text style={styles.versionText}>ShelvesAI v1.0.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = ({ colors, spacing, typography, shadows, radius }) => StyleSheet.create({
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
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    ...shadows.sm,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  avatarText: {
    fontSize: 22,
    fontWeight: '600',
    color: colors.textInverted,
  },
  profileInfo: {
    flex: 1,
  },
  displayName: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
  },
  username: {
    fontSize: 14,
    color: colors.textMuted,
  },
  profileHint: {
    fontSize: 12,
    color: colors.primary,
    marginTop: 2,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    ...shadows.sm,
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
  settingsLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
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
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    marginTop: spacing.md,
  },
  logoutText: {
    fontSize: 15,
    color: colors.error,
    fontWeight: '500',
  },
  versionText: {
    textAlign: 'center',
    fontSize: 12,
    color: colors.textMuted,
    marginTop: spacing.md,
  },
});
