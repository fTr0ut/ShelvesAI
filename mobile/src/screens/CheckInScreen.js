import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../context/ThemeContext';

export default function CheckInScreen() {
    const navigation = useNavigation();
    const { colors, spacing, typography, shadows, radius, isDark } = useTheme();
    const styles = useMemo(
        () => createStyles({ colors, spacing, typography, shadows, radius }),
        [colors, spacing, typography, shadows, radius]
    );
    const overlayColor = isDark ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.35)';

    return (
        <View style={styles.screen}>
            <Pressable
                style={[styles.backdrop, { backgroundColor: overlayColor }]}
                onPress={() => navigation.goBack()}
            />
            <View style={styles.card}>
                <View style={styles.header}>
                    <Text style={styles.title}>Check In</Text>
                    <Pressable
                        onPress={() => navigation.goBack()}
                        style={({ pressed }) => [
                            styles.closeButton,
                            pressed && styles.closeButtonPressed,
                        ]}
                    >
                        <Ionicons name="close" size={20} color={colors.text} />
                    </Pressable>
                </View>
                <Text style={styles.subtitle}>
                    Capture a quick moment about what you are adding or enjoying.
                </Text>
                <Pressable
                    onPress={() => navigation.goBack()}
                    style={({ pressed }) => [
                        styles.primaryButton,
                        { backgroundColor: colors.primary },
                        pressed && styles.primaryButtonPressed,
                    ]}
                >
                    <Text style={styles.primaryButtonText}>Continue</Text>
                </Pressable>
            </View>
        </View>
    );
}

const createStyles = ({ colors, spacing, typography, shadows, radius }) => StyleSheet.create({
    screen: {
        flex: 1,
        backgroundColor: 'transparent',
        justifyContent: 'center',
        alignItems: 'center',
    },
    backdrop: {
        ...StyleSheet.absoluteFillObject,
    },
    card: {
        width: '88%',
        maxWidth: 360,
        backgroundColor: colors.surface,
        borderRadius: radius.lg,
        padding: spacing.lg,
        gap: spacing.sm,
        ...shadows.lg,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    title: {
        fontSize: 20,
        fontWeight: '700',
        color: colors.text,
        fontFamily: typography.bold,
    },
    subtitle: {
        fontSize: 14,
        color: colors.textMuted,
        lineHeight: 20,
        fontFamily: typography.regular,
    },
    closeButton: {
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.surfaceElevated,
    },
    closeButtonPressed: {
        opacity: 0.7,
    },
    primaryButton: {
        marginTop: spacing.sm,
        paddingVertical: 12,
        borderRadius: radius.full,
        alignItems: 'center',
        justifyContent: 'center',
    },
    primaryButtonPressed: {
        opacity: 0.9,
        transform: [{ scale: 0.98 }],
    },
    primaryButtonText: {
        fontSize: 15,
        fontWeight: '600',
        color: colors.textInverted,
        fontFamily: typography.medium,
    },
});
