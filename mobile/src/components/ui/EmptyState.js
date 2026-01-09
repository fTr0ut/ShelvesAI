import React from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { colors, spacing, typography } from '../../theme';
import Button from './Button';

export default function EmptyState({ title, description, icon, actionLabel, onAction, style }) {
    return (
        <View style={[styles.container, style]}>
            {icon && <View style={styles.iconContainer}>{icon}</View>}
            <Text style={styles.title}>{title}</Text>
            {description && <Text style={styles.description}>{description}</Text>}
            {actionLabel && onAction && (
                <View style={styles.actionContainer}>
                    <Button title={actionLabel} onPress={onAction} variant="secondary" size="sm" />
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        padding: spacing.xl,
        alignItems: 'center',
        justifyContent: 'center',
    },
    iconContainer: {
        marginBottom: spacing.md,
        opacity: 0.8,
    },
    title: {
        fontFamily: typography.fontFamily.bold,
        fontSize: typography.sizes.lg,
        color: colors.text,
        textAlign: 'center',
        marginBottom: spacing.xs,
    },
    description: {
        fontFamily: typography.fontFamily.regular,
        fontSize: typography.sizes.sm,
        color: colors.textSecondary,
        textAlign: 'center',
        marginBottom: spacing.md,
    },
    actionContainer: {
        marginTop: spacing.sm,
    },
});
