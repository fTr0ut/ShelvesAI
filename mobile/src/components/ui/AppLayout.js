import React from 'react'
import { SafeAreaView, ScrollView, StatusBar, StyleSheet, View } from 'react-native'
import { colors, spacing } from '../../../../shared/theme/tokens'

export default function AppLayout({ children, scrollable = true, contentStyle, style }) {
  const Container = scrollable ? ScrollView : View
  return (
    <SafeAreaView style={[styles.safeArea, style]}>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />
      <Container contentContainerStyle={scrollable ? [styles.content, contentStyle] : undefined} style={!scrollable ? [styles.content, contentStyle] : undefined}>
        {children}
      </Container>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
  },
})
