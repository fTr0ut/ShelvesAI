import React from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../context/ToastContext';

/**
 * Toast container component
 * Renders all active toasts from ToastContext
 */
export default function ToastContainer() {
    const { toasts, dismissToast } = useToast();
    const insets = useSafeAreaInsets();
    const { colors } = useTheme();

    if (toasts.length === 0) return null;

    return (
        <View style={[styles.container, { top: insets.top + 10 }]} pointerEvents="box-none">
            {toasts.map(toast => (
                <Toast
                    key={toast.id}
                    toast={toast}
                    onDismiss={() => dismissToast(toast.id)}
                    colors={colors}
                />
            ))}
        </View>
    );
}

/**
 * Individual toast component
 */
function Toast({ toast, onDismiss, colors }) {
    const typeColors = {
        success: colors.success || '#22c55e',
        warning: colors.warning || '#f59e0b',
        error: colors.error || '#ef4444',
        info: colors.primary || '#3b82f6',
    };

    const backgroundColor = typeColors[toast.type] || typeColors.info;

    const handleAction = () => {
        if (toast.onAction) {
            toast.onAction();
        }
        onDismiss();
    };

    return (
        <Animated.View style={[styles.toast, { backgroundColor }]}>
            <View style={styles.iconContainer}>
                <Ionicons name={toast.icon} size={22} color="#fff" />
            </View>
            <Text style={styles.message} numberOfLines={2}>
                {toast.message}
            </Text>
            {toast.actionLabel ? (
                <TouchableOpacity onPress={handleAction} style={styles.actionButton}>
                    <Text style={styles.actionText}>{toast.actionLabel}</Text>
                </TouchableOpacity>
            ) : null}
            <TouchableOpacity onPress={onDismiss} style={styles.closeButton}>
                <Ionicons name="close" size={18} color="rgba(255,255,255,0.8)" />
            </TouchableOpacity>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    container: {
        position: 'absolute',
        left: 16,
        right: 16,
        zIndex: 9999,
        elevation: 9999,
    },
    toast: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        paddingHorizontal: 14,
        borderRadius: 12,
        marginBottom: 8,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 8,
    },
    iconContainer: {
        marginRight: 10,
    },
    message: {
        flex: 1,
        color: '#fff',
        fontSize: 14,
        fontWeight: '500',
    },
    actionButton: {
        backgroundColor: 'rgba(255,255,255,0.25)',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 6,
        marginLeft: 10,
    },
    actionText: {
        color: '#fff',
        fontSize: 13,
        fontWeight: '600',
    },
    closeButton: {
        marginLeft: 8,
        padding: 4,
    },
});
