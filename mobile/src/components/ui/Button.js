import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { colors, radii, spacing } from '../../../../shared/theme/tokens'

const VARIANT_STYLES = {
  default: {
    backgroundColor: '#0d1726',
    borderColor: colors.border,
    textColor: colors.text,
  },
  primary: {
    backgroundColor: colors.brand,
    borderColor: 'transparent',
    textColor: '#0b0f14',
  },
  ghost: {
    backgroundColor: 'transparent',
    borderColor: colors.border,
    textColor: colors.text,
  },
  danger: {
    backgroundColor: colors.danger,
    borderColor: 'transparent',
    textColor: '#ffffff',
  },
}

export default function Button({
  children,
  variant = 'default',
  fullWidth = false,
  disabled = false,
  startIcon,
  endIcon,
  style,
  contentStyle,
  onPress,
}) {
  const palette = VARIANT_STYLES[variant] || VARIANT_STYLES.default
  const baseStyle = [
    styles.base,
    { backgroundColor: palette.backgroundColor, borderColor: palette.borderColor },
    fullWidth && styles.fullWidth,
    disabled && styles.disabled,
    style,
  ]

  const renderLabel = () => {
    if (typeof children === 'string' || typeof children === 'number') {
      return <Text style={[styles.label, { color: palette.textColor }]}>{children}</Text>
    }
    return children
  }

  return (
    <Pressable disabled={disabled} onPress={onPress} style={({ pressed }) => [baseStyle, pressed && !disabled && styles.pressed]}>
      <View style={[styles.content, contentStyle]}>
        {startIcon ? <View style={styles.icon}>{startIcon}</View> : null}
        {renderLabel()}
        {endIcon ? <View style={styles.icon}>{endIcon}</View> : null}
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  base: {
    borderWidth: 1,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    alignItems: 'center',
  },
  fullWidth: {
    width: '100%',
  },
  disabled: {
    opacity: 0.6,
  },
  pressed: {
    transform: [{ scale: 0.99 }],
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    marginHorizontal: spacing.xs,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
  },
})
