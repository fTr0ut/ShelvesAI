import React, { useEffect, useRef, useContext } from 'react'
import {
    Modal,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../context/ThemeContext'
import { AuthContext } from '../context/AuthContext'
import { apiRequest } from '../services/api'

/**
 * Full-screen modal for admin-broadcast system messages.
 * On mount, checks /api/broadcasts/:broadcastId/status — if suppressed (recalled
 * by admin), dismisses immediately without showing content.
 * If the status check fails (network error), the modal is shown anyway (fail open).
 */
export default function SystemBroadcastModal({ visible, title, body, broadcastId, onDismiss }) {
    const { colors, spacing, typography } = useTheme()
    const { apiBase } = useContext(AuthContext)
    const suppressChecked = useRef(false)

    useEffect(() => {
        if (!visible || !broadcastId || suppressChecked.current) return

        suppressChecked.current = true

        apiRequest({
            apiBase,
            path: `/api/broadcasts/${broadcastId}/status`,
            method: 'GET',
        })
            .then((data) => {
                if (data?.isSuppressed) {
                    onDismiss()
                }
            })
            .catch(() => {
                // Network error — show the modal anyway (fail open)
            })
    }, [visible, broadcastId, apiBase, onDismiss])

    // Reset the suppress check when the modal closes so a new broadcast
    // (different broadcastId) is checked fresh.
    useEffect(() => {
        if (!visible) {
            suppressChecked.current = false
        }
    }, [visible])

    return (
        <Modal
            visible={visible}
            transparent={false}
            animationType="slide"
            onRequestClose={onDismiss}
            presentationStyle="fullScreen"
        >
            <SafeAreaView
                style={[styles.safeArea, { backgroundColor: colors.background }]}
                edges={['top', 'bottom', 'left', 'right']}
            >
                <View style={styles.container}>
                    {/* Header */}
                    <View style={styles.iconRow}>
                        <Ionicons name="megaphone-outline" size={40} color={colors.primary} />
                    </View>

                    <Text style={[styles.label, { color: colors.textMuted }]}>
                        Message from ShelvesAI
                    </Text>

                    {/* Title */}
                    {!!title && (
                        <Text style={[styles.title, { color: colors.text }]}>
                            {title}
                        </Text>
                    )}

                    {/* Body */}
                    {!!body && (
                        <Text style={[styles.body, { color: colors.textMuted }]}>
                            {body}
                        </Text>
                    )}

                    {/* Dismiss */}
                    <TouchableOpacity
                        style={[styles.button, { backgroundColor: colors.primary }]}
                        onPress={onDismiss}
                        activeOpacity={0.8}
                    >
                        <Text style={styles.buttonText}>Got it</Text>
                    </TouchableOpacity>
                </View>
            </SafeAreaView>
        </Modal>
    )
}

const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
    },
    container: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 32,
        paddingVertical: 40,
    },
    iconRow: {
        marginBottom: 16,
    },
    label: {
        fontSize: 12,
        fontWeight: '600',
        letterSpacing: 1,
        textTransform: 'uppercase',
        marginBottom: 12,
    },
    title: {
        fontSize: 24,
        fontWeight: '700',
        textAlign: 'center',
        marginBottom: 16,
    },
    body: {
        fontSize: 16,
        lineHeight: 24,
        textAlign: 'center',
        marginBottom: 40,
    },
    button: {
        paddingVertical: 14,
        paddingHorizontal: 48,
        borderRadius: 10,
        alignItems: 'center',
    },
    buttonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '600',
    },
})
