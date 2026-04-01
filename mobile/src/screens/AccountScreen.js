import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  InteractionManager,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AuthContext } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { usePush } from '../context/PushContext';
import { apiRequest, clearToken } from '../services/api';
import { useAsync } from '../hooks/useAsync';
const { getNonAuthInputProps } = require('../utils/textInputPolicy');

const FEEDBACK_MAX_LENGTH = 4000;

export default function AccountScreen({ navigation }) {
  const { token, setToken, apiBase, setNeedsOnboarding, premiumEnabled, setPremiumEnabled, visionQuota, setVisionQuota } = useContext(AuthContext);
  const { colors, spacing, typography, shadows, radius, isDark, toggleTheme } = useTheme();
  const { unregisterPush } = usePush();

  const [premiumSaving, setPremiumSaving] = useState(false);
  const [isPrivate, setIsPrivate] = useState(false);
  const [privateSaving, setPrivateSaving] = useState(false);
  const [showPersonalPhotos, setShowPersonalPhotos] = useState(true);
  const [photosSaving, setPhotosSaving] = useState(false);
  const [feedbackModalVisible, setFeedbackModalVisible] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const feedbackInputRef = useRef(null);
  const feedbackFocusTaskRef = useRef(null);
  const nonAuthInputProps = useMemo(() => getNonAuthInputProps(Platform.OS), []);

  const styles = useMemo(() => createStyles({ colors, spacing, typography, shadows, radius }), [colors, spacing, typography, shadows, radius]);

  const fetchAccount = useCallback(async () => {
    const data = await apiRequest({ apiBase, path: '/api/account', token });
    return data;
  }, [apiBase, token]);

  const { data: accountData, loading } = useAsync(fetchAccount, [fetchAccount]);

  const user = accountData?.user ?? null;

  // Sync premium, quota, and settings state from fetched account data.
  useEffect(() => {
    if (!accountData) return;
    if (typeof accountData.user?.isPremium === 'boolean') {
      setPremiumEnabled(accountData.user.isPremium);
    }
    if (typeof accountData.user?.isPrivate === 'boolean') {
      setIsPrivate(accountData.user.isPrivate);
    }
    if (typeof accountData.user?.showPersonalPhotos === 'boolean') {
      setShowPersonalPhotos(accountData.user.showPersonalPhotos);
    }
    if (accountData.visionQuota) {
      setVisionQuota(accountData.visionQuota);
    }
  }, [accountData, setPremiumEnabled, setVisionQuota]);

  useEffect(() => {
    if (!feedbackModalVisible || feedbackSubmitting) {
      return undefined;
    }

    let cancelled = false;
    const task = InteractionManager.runAfterInteractions(() => {
      if (cancelled) return;
      feedbackInputRef.current?.focus?.();
    });
    feedbackFocusTaskRef.current = task;

    return () => {
      cancelled = true;
      if (feedbackFocusTaskRef.current?.cancel) {
        feedbackFocusTaskRef.current.cancel();
      }
      feedbackFocusTaskRef.current = null;
    };
  }, [feedbackModalVisible, feedbackSubmitting]);

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

  const handlePrivateToggle = useCallback(async (value) => {
    const previous = isPrivate;
    setIsPrivate(value);
    try {
      setPrivateSaving(true);
      await apiRequest({
        apiBase,
        path: '/api/account',
        method: 'PUT',
        token,
        body: { isPrivate: value },
      });
    } catch (e) {
      setIsPrivate(previous);
      Alert.alert('Error', e.message);
    } finally {
      setPrivateSaving(false);
    }
  }, [apiBase, token, isPrivate]);

  const handleShowPersonalPhotosToggle = useCallback(async (value) => {
    const previous = showPersonalPhotos;
    setShowPersonalPhotos(value);
    try {
      setPhotosSaving(true);
      await apiRequest({
        apiBase,
        path: '/api/account',
        method: 'PUT',
        token,
        body: { showPersonalPhotos: value },
      });
    } catch (e) {
      setShowPersonalPhotos(previous);
      Alert.alert('Error', e.message);
    } finally {
      setPhotosSaving(false);
    }
  }, [apiBase, token, showPersonalPhotos]);

  const handleOpenFeedback = useCallback(() => {
    setFeedbackModalVisible(true);
  }, []);

  const handleCloseFeedback = useCallback(() => {
    if (feedbackSubmitting) return;
    feedbackInputRef.current?.blur?.();
    setFeedbackModalVisible(false);
    setFeedbackMessage('');
  }, [feedbackSubmitting]);

  const handleSubmitFeedback = useCallback(async () => {
    const message = feedbackMessage.trim();
    if (!message) {
      Alert.alert('Feedback required', 'Please enter feedback before submitting.');
      return;
    }

    try {
      setFeedbackSubmitting(true);
      await apiRequest({
        apiBase,
        path: '/api/account/feedback',
        method: 'POST',
        token,
        body: { message },
      });
      setFeedbackModalVisible(false);
      setFeedbackMessage('');
      Alert.alert('Feedback sent', 'Thanks. Your feedback has been sent to our support team.');
    } catch (e) {
      Alert.alert('Unable to submit feedback', e.message || 'Please try again later.');
    } finally {
      setFeedbackSubmitting(false);
    }
  }, [apiBase, feedbackMessage, token]);

  const handleLogout = useCallback(() => {
    Alert.alert('Log Out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log Out',
        style: 'destructive',
        onPress: async () => {
          // Unregister push notifications before logging out
          try {
            await unregisterPush();
          } catch (e) {
            console.warn('Failed to unregister push:', e);
          }
          await clearToken();
          setNeedsOnboarding(false);
          setToken('');
        },
      },
    ]);
  }, [setToken, setNeedsOnboarding, unregisterPush]);

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

          {premiumEnabled && visionQuota && (
            <View style={styles.quotaSection}>
              <View style={styles.quotaHeader}>
                <Ionicons name="scan" size={18} color={colors.text} />
                <Text style={styles.quotaLabel}>Vision Scans</Text>
              </View>
              <View style={styles.quotaContent}>
                <Text style={styles.quotaValue}>
                  {visionQuota.scansRemaining} / {visionQuota.monthlyLimit} remaining
                </Text>
                <Text style={styles.quotaHint}>
                  Resets in {visionQuota.daysRemaining} day{visionQuota.daysRemaining !== 1 ? 's' : ''}
                </Text>
              </View>
            </View>
          )}

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

          <View style={styles.settingsRow}>
            <View style={styles.settingsLeft}>
              <Ionicons name="lock-closed" size={20} color={colors.text} />
              <View>
                <Text style={styles.settingsLabel}>Private Account</Text>
                <Text style={styles.settingsHint}>Hide shelves from non-friends</Text>
              </View>
            </View>
            <Switch
              value={isPrivate}
              onValueChange={handlePrivateToggle}
              disabled={privateSaving}
              trackColor={{ false: colors.border, true: colors.primary + '80' }}
              thumbColor={isPrivate ? colors.primary : colors.surfaceElevated}
            />
          </View>

          <View style={styles.settingsRow}>
            <View style={styles.settingsLeft}>
              <Ionicons name="camera" size={20} color={colors.text} />
              <View>
                <Text style={styles.settingsLabel}>Share Personal Photos</Text>
                <Text style={styles.settingsHint}>Show your photos of items to friends/public</Text>
              </View>
            </View>
            <Switch
              value={showPersonalPhotos}
              onValueChange={handleShowPersonalPhotosToggle}
              disabled={photosSaving}
              trackColor={{ false: colors.border, true: colors.primary + '80' }}
              thumbColor={showPersonalPhotos ? colors.primary : colors.surfaceElevated}
            />
          </View>

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
            onPress={() => navigation.navigate('NotificationSettings')}
          >
            <View style={styles.settingsLeft}>
              <Ionicons name="notifications" size={20} color={colors.text} />
              <Text style={styles.settingsLabel}>Notification Settings</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.settingsRow}
            onPress={handleOpenFeedback}
          >
            <View style={styles.settingsLeft}>
              <Ionicons name="chatbubble-ellipses" size={20} color={colors.text} />
              <View>
                <Text style={styles.settingsLabel}>Send Feedback</Text>
                <Text style={styles.settingsHint}>Report bugs or suggest improvements</Text>
              </View>
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

        <Modal
          visible={feedbackModalVisible}
          transparent
          animationType="fade"
          onRequestClose={handleCloseFeedback}
        >
          <KeyboardAvoidingView
            style={styles.feedbackModalRoot}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <Pressable style={styles.feedbackBackdrop} onPress={handleCloseFeedback} />
            <View style={styles.feedbackCard}>
              <Text style={styles.feedbackTitle}>Send Feedback</Text>
              <Text style={styles.feedbackHint}>
                Tell us what happened or what you want improved.
              </Text>
              <TextInput
                ref={feedbackInputRef}
                {...nonAuthInputProps}
                value={feedbackMessage}
                onChangeText={setFeedbackMessage}
                style={styles.feedbackInput}
                placeholder="Write your feedback..."
                placeholderTextColor={colors.textMuted}
                multiline
                textAlignVertical="top"
                maxLength={FEEDBACK_MAX_LENGTH}
                editable={!feedbackSubmitting}
              />
              <Text style={styles.feedbackCharCount}>
                {feedbackMessage.length}/{FEEDBACK_MAX_LENGTH}
              </Text>
              <View style={styles.feedbackActions}>
                <TouchableOpacity
                  style={[styles.feedbackButton, styles.feedbackCancelButton]}
                  onPress={handleCloseFeedback}
                  disabled={feedbackSubmitting}
                >
                  <Text style={styles.feedbackCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.feedbackButton,
                    styles.feedbackSubmitButton,
                    (!feedbackMessage.trim() || feedbackSubmitting) && styles.feedbackSubmitButtonDisabled,
                  ]}
                  onPress={handleSubmitFeedback}
                  disabled={!feedbackMessage.trim() || feedbackSubmitting}
                >
                  {feedbackSubmitting ? (
                    <ActivityIndicator size="small" color={colors.textInverted} />
                  ) : (
                    <Text style={styles.feedbackSubmitText}>Submit</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

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
  quotaSection: {
    backgroundColor: colors.primary + '10',
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  quotaHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  quotaLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  quotaContent: {
    marginLeft: 26,
  },
  quotaValue: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.primary,
  },
  quotaHint: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  feedbackModalRoot: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.md,
  },
  feedbackBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  feedbackCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.md,
  },
  feedbackTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
  },
  feedbackHint: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  feedbackInput: {
    minHeight: 140,
    maxHeight: 240,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.background,
    padding: spacing.sm,
    color: colors.text,
    fontSize: 14,
  },
  feedbackCharCount: {
    alignSelf: 'flex-end',
    marginTop: spacing.xs,
    color: colors.textMuted,
    fontSize: 12,
  },
  feedbackActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  feedbackButton: {
    minWidth: 92,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  feedbackCancelButton: {
    backgroundColor: colors.surfaceElevated,
  },
  feedbackCancelText: {
    color: colors.text,
    fontWeight: '500',
  },
  feedbackSubmitButton: {
    backgroundColor: colors.primary,
  },
  feedbackSubmitButtonDisabled: {
    opacity: 0.6,
  },
  feedbackSubmitText: {
    color: colors.textInverted,
    fontWeight: '600',
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
