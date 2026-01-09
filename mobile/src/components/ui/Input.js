import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, View, TouchableWithoutFeedback, Keyboard } from 'react-native';
import { colors, spacing, radius, typography } from '../../theme';

export default function Input({
    label,
    value,
    onChangeText,
    error,
    leftIcon,
    rightIcon,
    disabled,
    secureTextEntry,
    keyboardType,
    autoCapitalize,
    placeholder,
    multiline,
    numberOfLines,
    style,
    ...props
}) {
    const [isFocused, setIsFocused] = useState(false);

    // If we have a value or focus, label moves up? 
    // For simplicity, we'll do a fixed label above the input for now, 
    // but styled cleanly. "Floating label" usually needs animation.
    // Let's stick to a clean "Label \n Input" or "Input with Placeholder" for robustness if animation libraries arent available yet.
    // But storyboard said "Modern floating label". 
    // I'll simulate it with a small absolute position label if value/focused, else large placeholder.

    // Actually, standard stacked label is often cleaner and safer to implement quickly.
    // Let's do: Label (textSecondary) -> Input Box (Border).

    return (
        <View style={[styles.container, style]}>
            {label && <Text style={styles.label}>{label}</Text>}

            <View
                style={[
                    styles.inputContainer,
                    isFocused && styles.focused,
                    error && styles.errorBorder,
                    disabled && styles.disabled,
                    multiline && { height: 'auto', minHeight: 100, alignItems: 'flex-start' }
                ]}
            >
                {leftIcon && <View style={styles.iconLeft}>{leftIcon}</View>}

                <TextInput
                    value={value}
                    onChangeText={onChangeText}
                    style={[styles.input, multiline && styles.textArea, disabled && { color: colors.textMuted }]}
                    placeholder={placeholder}
                    placeholderTextColor={colors.textMuted}
                    onFocus={() => setIsFocused(true)}
                    onBlur={() => setIsFocused(false)}
                    editable={!disabled}
                    secureTextEntry={secureTextEntry}
                    keyboardType={keyboardType}
                    autoCapitalize={autoCapitalize}
                    multiline={multiline} // Note: multiline needs handled properly
                    numberOfLines={numberOfLines}
                    textAlignVertical={multiline ? 'top' : 'center'}
                    {...props}
                />

                {rightIcon && <View style={styles.iconRight}>{rightIcon}</View>}
            </View>

            {error && <Text style={styles.errorText}>{error}</Text>}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        marginBottom: spacing.md,
    },
    label: {
        fontFamily: typography.fontFamily.medium,
        fontSize: typography.sizes.sm,
        color: colors.textSecondary,
        marginBottom: spacing.xs,
        marginLeft: spacing.xs,
    },
    inputContainer: {
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radius.lg,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: spacing.md,
        height: 56, // Tall touch target
    },
    focused: {
        borderColor: colors.primary,
        backgroundColor: colors.surfaceElevated,
    },
    errorBorder: {
        borderColor: colors.error,
    },
    disabled: {
        opacity: 0.5,
        backgroundColor: colors.background,
    },
    input: {
        flex: 1,
        color: colors.text,
        fontFamily: typography.fontFamily.regular,
        fontSize: typography.sizes.base,
        height: '100%',
    },
    textArea: {
        paddingTop: spacing.md,
        height: undefined, // allow expansion
    },
    iconLeft: {
        marginRight: spacing.sm,
    },
    iconRight: {
        marginLeft: spacing.sm,
    },
    errorText: {
        color: colors.error,
        fontSize: typography.sizes.xs,
        marginTop: spacing.xs,
        marginLeft: spacing.xs,
    },
});
