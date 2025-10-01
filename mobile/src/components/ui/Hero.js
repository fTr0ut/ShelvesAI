import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { colors, spacing, typography } from '../../../../shared/theme/tokens'

export default function Hero({ eyebrow, title, description, actions, children, style }) {
  return (
    <View style={[styles.hero, style]}>
      {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {description ? <Text style={styles.description}>{description}</Text> : null}
      {actions ? <View style={styles.actions}>{actions}</View> : null}
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  hero: {
    gap: spacing.sm,
  },
  eyebrow: {
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    color: colors.muted,
    fontSize: typography.tiny,
  },
  title: {
    fontSize: typography.heading,
    fontWeight: '700',
    color: colors.text,
  },
  description: {
    color: colors.muted,
    fontSize: typography.body,
  },
  actions: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
})
