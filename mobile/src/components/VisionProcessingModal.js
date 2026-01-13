import React from 'react';
import {
    ActivityIndicator,
    Modal,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';

/**
 * Full-screen modal shown during vision processing
 * Displays progress, allows cancel or hide to background
 */
export default function VisionProcessingModal({
    visible,
    progress = 0,
    message = 'Processing...',
    status,
    onCancel,
    onHideBackground,
}) {
    const { colors, spacing, typography } = useTheme();

    const getStepIcon = () => {
        if (status === 'completed') return 'checkmark-circle';
        if (status === 'failed' || status === 'aborted') return 'close-circle';
        return 'scan-outline';
    };

    const getStepColor = () => {
        if (status === 'completed') return colors.success || '#22c55e';
        if (status === 'failed' || status === 'aborted') return colors.error || '#ef4444';
        return colors.primary;
    };

    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={onHideBackground}
        >
            <View style={styles.overlay}>
                <View style={[styles.container, { backgroundColor: colors.surface }]}>
                    {/* Icon and Progress */}
                    <View style={styles.iconContainer}>
                        {status !== 'completed' && status !== 'failed' ? (
                            <ActivityIndicator size="large" color={colors.primary} />
                        ) : (
                            <Ionicons name={getStepIcon()} size={48} color={getStepColor()} />
                        )}
                    </View>

                    {/* Progress Bar */}
                    <View style={[styles.progressContainer, { backgroundColor: colors.border }]}>
                        <View
                            style={[
                                styles.progressBar,
                                { width: `${progress}%`, backgroundColor: getStepColor() },
                            ]}
                        />
                    </View>
                    <Text style={[styles.progressText, { color: colors.textMuted }]}>
                        {Math.round(progress)}%
                    </Text>

                    {/* Status Message */}
                    <Text style={[styles.message, { color: colors.text }]}>
                        {message}
                    </Text>

                    {/* Action Buttons */}
                    {status !== 'completed' && status !== 'failed' && (
                        <View style={styles.buttonContainer}>
                            <TouchableOpacity
                                style={[styles.button, styles.cancelButton, { borderColor: colors.error }]}
                                onPress={onCancel}
                            >
                                <Text style={[styles.buttonText, { color: colors.error }]}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.button, styles.backgroundButton, { backgroundColor: colors.primary }]}
                                onPress={onHideBackground}
                            >
                                <Text style={[styles.buttonText, { color: '#fff' }]}>Hide in Background</Text>
                            </TouchableOpacity>
                        </View>
                    )}
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
    },
    container: {
        width: '100%',
        maxWidth: 340,
        borderRadius: 16,
        padding: 24,
        alignItems: 'center',
    },
    iconContainer: {
        marginBottom: 20,
        height: 60,
        justifyContent: 'center',
        alignItems: 'center',
    },
    progressContainer: {
        width: '100%',
        height: 8,
        borderRadius: 4,
        overflow: 'hidden',
        marginBottom: 8,
    },
    progressBar: {
        height: '100%',
        borderRadius: 4,
    },
    progressText: {
        fontSize: 13,
        marginBottom: 16,
    },
    message: {
        fontSize: 16,
        fontWeight: '500',
        textAlign: 'center',
        marginBottom: 24,
    },
    buttonContainer: {
        flexDirection: 'row',
        gap: 12,
    },
    button: {
        paddingVertical: 12,
        paddingHorizontal: 20,
        borderRadius: 8,
        minWidth: 100,
        alignItems: 'center',
    },
    cancelButton: {
        borderWidth: 1,
        backgroundColor: 'transparent',
    },
    backgroundButton: {
        borderWidth: 0,
    },
    buttonText: {
        fontSize: 14,
        fontWeight: '600',
    },
});
