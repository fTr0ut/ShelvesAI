import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { colors, radii, spacing, typography } from '../../../../shared/theme/tokens'

export default function ShelfListItem({
  name,
  typeLabel,
  visibilityLabel,
  description,
  onPress,
  actions,
  children,
  style,
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.container, pressed && styles.pressed, style]}>
      <View style={styles.body}>
        <View style={styles.header}>
          {name ? <Text style={styles.title}>{name}</Text> : null}
          <View style={styles.meta}>
            {typeLabel ? <Text style={styles.pill}>{typeLabel}</Text> : null}
            {visibilityLabel ? <Text style={styles.pill}>{visibilityLabel}</Text> : null}
          </View>
        </View>
        {description ? <Text style={styles.description}>{description}</Text> : null}
        {children ? <View style={styles.children}>{children}</View> : null}
      </View>
      {actions ? <View style={styles.actions}>{actions}</View> : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  pressed: {
    opacity: 0.9,
  },
  body: {
    flex: 1,
    gap: spacing.sm,
  },
  header: {
    gap: spacing.xs,
  },
  meta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  pill: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    fontSize: typography.tiny,
    color: colors.muted,
  },
  title: {
    fontSize: typography.subheading,
    fontWeight: '600',
    color: colors.text,
  },
  description: {
    color: colors.muted,
  },
  children: {
    marginTop: spacing.xs,
    gap: spacing.xs,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
})
