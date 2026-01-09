import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { colors, spacing, radius, shadows } from '../../theme';

export default function Card({ children, onPress, style, contentStyle }) {
  const Container = onPress ? TouchableOpacity : View;

  return (
    <Container
      onPress={onPress}
      activeOpacity={onPress ? 0.7 : 1}
      style={[styles.card, style]}
    >
      <View style={[styles.content, contentStyle]}>
        {children}
      </View>
    </Container>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
    overflow: 'hidden',
    // ...shadows.sm, // Shadows strictly for iOS, elevation for Android (usually handled by platform specific styles or needs View wrapping)
  },
  content: {
    padding: spacing.md,
  },
});
