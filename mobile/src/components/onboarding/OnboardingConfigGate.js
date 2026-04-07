import React, { useContext, useMemo } from 'react'
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { AuthContext } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'
import { getOnboardingConfigGateState } from '../../utils/onboardingConfig'

export default function OnboardingConfigGate({
  section,
  loadingMessage = 'Loading onboarding...',
  retryLabel = 'Retry',
  children,
}) {
  const {
    onboardingConfig,
    onboardingConfigLoading,
    onboardingConfigError,
    refreshOnboardingConfig,
  } = useContext(AuthContext)
  const { colors, spacing, radius, shadows } = useTheme()

  const gateState = getOnboardingConfigGateState({
    onboardingConfig,
    onboardingConfigLoading,
    onboardingConfigError,
    section,
  })

  const styles = useMemo(() => createStyles({ colors, spacing, radius, shadows }), [colors, spacing, radius, shadows])

  if (gateState.status === 'ready') {
    return children
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.container}>
        {gateState.status === 'loading' ? (
          <>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.message}>{loadingMessage}</Text>
          </>
        ) : (
          <>
            <Text style={styles.title}>Unable to load onboarding</Text>
            <Text style={styles.message}>{gateState.errorMessage}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={refreshOnboardingConfig}>
              <Text style={styles.retryText}>{retryLabel}</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </SafeAreaView>
  )
}

const createStyles = ({ colors, spacing, radius, shadows }) => StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },
  message: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
  retryButton: {
    marginTop: spacing.sm,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    ...shadows.sm,
  },
  retryText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textInverted,
  },
})
