import React from 'react';
import { StyleSheet, Text, View, ActivityIndicator, Pressable } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { colors, spacing, radius, typography } from '../../theme';

import * as Haptics from 'expo-haptics';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export default function Button({
  title,
  onPress,
  variant = 'primary', // primary, secondary, ghost, danger
  size = 'md', // sm, md, lg
  disabled = false,
  loading = false,
  fullWidth = false,
  style,
  textStyle,
  icon,
}) {
  const scale = useSharedValue(1);

  const getBackgroundColor = () => {
    if (disabled) return colors.surfaceElevated;
    switch (variant) {
      case 'primary': return colors.primary;
      case 'secondary': return colors.surfaceElevated;
      case 'ghost': return 'transparent';
      case 'danger': return colors.error;
      default: return colors.primary;
    }
  };

  const getTextColor = () => {
    if (disabled) return colors.textMuted;
    switch (variant) {
      case 'primary': return colors.text;
      case 'secondary': return colors.text;
      case 'ghost': return colors.primaryLight;
      case 'danger': return colors.text;
      default: return colors.text;
    }
  };

  const getBorder = () => {
    if (variant === 'secondary') return { borderWidth: 1, borderColor: colors.borderLight }; // subtle border for secondary
    if (variant === 'ghost') return {};
    return {};
  };

  const height = { sm: 32, md: 48, lg: 56 }[size];
  const fontSize = { sm: 12, md: 16, lg: 18 }[size];
  const paddingHorizontal = { sm: 16, md: 24, lg: 32 }[size];

  const animatedStyle = useAnimatedStyle(() => {
    return {
      transform: [{ scale: scale.value }],
    };
  });

  const handlePressIn = () => {
    if (disabled || loading) return;
    scale.value = withSpring(0.96, { damping: 10, stiffness: 300 });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handlePressOut = () => {
    if (disabled || loading) return;
    scale.value = withSpring(1, { damping: 10, stiffness: 300 });
  };

  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled || loading}
      style={[
        styles.container,
        {
          backgroundColor: getBackgroundColor(),
          height,
          paddingHorizontal: variant === 'ghost' ? 0 : paddingHorizontal,
          width: fullWidth ? '100%' : undefined,
          opacity: disabled ? 0.6 : 1,
        },
        getBorder(),
        style,
        animatedStyle
      ]}
    >
      {loading ? (
        <ActivityIndicator color={getTextColor()} />
      ) : (
        <View style={styles.content}>
          {icon && <View style={{ marginRight: spacing.sm }}>{icon}</View>}
          <Text
            style={[
              styles.text,
              { color: getTextColor(), fontSize },
              textStyle,
            ]}
          >
            {title}
          </Text>
        </View>
      )}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: radius.full,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontFamily: typography.fontFamily.medium,
    fontWeight: '600',
    textAlign: 'center', // Ensure text centers nicely
  },
});
