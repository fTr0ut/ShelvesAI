import React, { useContext, useState, useMemo, useEffect, useRef } from 'react';
import {
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AuthContext } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { apiRequest } from '../services/api';

export default function RequestAccountDeletionScreen({ navigation }) {
    const { token, apiBase } = useContext(AuthContext);
    const { colors, spacing, typography, shadows, radius, isDark } = useTheme();
    const styles = useMemo(
        () => createStyles({ colors, spacing, typography, shadows, radius }),
        [colors, spacing, typography, shadows, radius]
    );

    const [email, setEmail] = useState('');
    const [reason, setReason] = useState('');
    const [confirmation, setConfirmation] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [revoking, setRevoking] = useState(false);
    const [pendingRequest, setPendingRequest] = useState(null);
    const [loadingStatus, setLoadingStatus] = useState(true);

    const confirmRef = useRef(null);

    useEffect(() => {
        let cancelled = false;

        async function load() {
            try {
                const [accountRes, statusRes] = await Promise.all([
                    apiRequest({ apiBase, path: '/api/account', token }),
                    apiRequest({ apiBase, path: '/api/account/deletion-request', token }),
                ]);
                if (!cancelled) {
                    setEmail(accountRes?.user?.email || '');
                    setPendingRequest(statusRes?.request || null);
                }
            } catch (err) {
                // Non-fatal — form still usable without email pre-filled
            } finally {
                if (!cancelled) setLoadingStatus(false);
            }
        }

        load();
        return () => { cancelled = true; };
    }, [apiBase, token]);

    const canSubmit = confirmation === 'DELETE' && !submitting;

    async function handleSubmit() {
        if (!canSubmit) return;
        setSubmitting(true);
        try {
            await apiRequest({
                apiBase,
                path: '/api/account/deletion-request',
                method: 'POST',
                token,
                body: { reason: reason.trim() || undefined },
            });
            Alert.alert(
                'Request Submitted',
                'Your deletion request has been received. You can expect it to be processed within 3 business days.',
                [{ text: 'OK', onPress: () => navigation.goBack() }]
            );
        } catch (err) {
            if (err?.status === 409) {
                Alert.alert('Already Submitted', 'You already have a pending deletion request.', [
                    { text: 'OK', onPress: () => navigation.goBack() },
                ]);
            } else {
                Alert.alert('Error', 'Unable to submit request. Please try again.');
            }
        } finally {
            setSubmitting(false);
        }
    }

    async function handleRevoke() {
        Alert.alert(
            'Revoke Deletion Request',
            'Are you sure you want to cancel your account deletion request?',
            [
                { text: 'No', style: 'cancel' },
                {
                    text: 'Yes, Revoke',
                    onPress: async () => {
                        setRevoking(true);
                        try {
                            await apiRequest({
                                apiBase,
                                path: '/api/account/deletion-request',
                                method: 'DELETE',
                                token,
                            });
                            setPendingRequest(null);
                        } catch {
                            Alert.alert('Error', 'Unable to revoke request. Please try again.');
                        } finally {
                            setRevoking(false);
                        }
                    },
                },
            ]
        );
    }

    if (loadingStatus) {
        return (
            <SafeAreaView style={styles.screen} edges={['top']}>
                <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />
                <View style={styles.header}>
                    <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
                        <Ionicons name="arrow-back" size={22} color={colors.text} />
                    </TouchableOpacity>
                    <Text style={styles.headerTitle}>Request Account Deletion</Text>
                    <View style={{ width: 40 }} />
                </View>
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color={colors.primary} />
                </View>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={styles.screen} edges={['top']}>
            <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />

            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
                    <Ionicons name="arrow-back" size={22} color={colors.text} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Request Account Deletion</Text>
                <View style={{ width: 40 }} />
            </View>

            <KeyboardAvoidingView
                style={{ flex: 1 }}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
                <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

                    {/* Warning card */}
                    <View style={styles.warningCard}>
                        <Ionicons name="warning" size={20} color={colors.error} style={{ marginTop: 2 }} />
                        <Text style={styles.warningText}>
                            This will permanently delete your account and all associated data. This action cannot be undone.
                        </Text>
                    </View>

                    {pendingRequest ? (
                        /* ---- Pending state ---- */
                        <>
                            <View style={styles.card}>
                                <Ionicons name="time-outline" size={20} color={colors.textMuted} style={styles.infoIcon} />
                                <Text style={styles.infoText}>
                                    You have a pending deletion request submitted on{' '}
                                    {new Date(pendingRequest.createdAt).toLocaleDateString(undefined, {
                                        year: 'numeric', month: 'long', day: 'numeric',
                                    })}.
                                    {'\n\n'}Your request will be reviewed and processed within 3 business days.
                                </Text>
                            </View>

                            <TouchableOpacity
                                style={[styles.revokeButton, revoking && styles.buttonDisabled]}
                                onPress={handleRevoke}
                                disabled={revoking}
                            >
                                {revoking ? (
                                    <ActivityIndicator size="small" color={colors.text} />
                                ) : (
                                    <Text style={styles.revokeButtonText}>Revoke Request</Text>
                                )}
                            </TouchableOpacity>
                        </>
                    ) : (
                        /* ---- Submission form ---- */
                        <>
                            {/* Info card */}
                            <View style={styles.card}>
                                <Text style={styles.infoText}>
                                    Your request will be reviewed and processed within{' '}
                                    <Text style={styles.bold}>3 business days</Text>.
                                    {email ? ` You will receive an email at ${email} once it has been actioned.` : ''}
                                </Text>
                            </View>

                            {/* Optional reason */}
                            <View style={styles.fieldBlock}>
                                <Text style={styles.label}>Why are you leaving? (optional)</Text>
                                <TextInput
                                    style={styles.reasonInput}
                                    value={reason}
                                    onChangeText={setReason}
                                    placeholder="Tell us why you'd like to delete your account"
                                    placeholderTextColor={colors.textMuted}
                                    multiline
                                    maxLength={1000}
                                    returnKeyType="next"
                                    onSubmitEditing={() => confirmRef.current?.focus()}
                                />
                                <Text style={styles.charCount}>{reason.length} / 1000</Text>
                            </View>

                            {/* Confirmation */}
                            <View style={styles.fieldBlock}>
                                <Text style={styles.label}>
                                    Type <Text style={styles.deleteWord}>DELETE</Text> to confirm
                                </Text>
                                <TextInput
                                    ref={confirmRef}
                                    style={styles.confirmInput}
                                    value={confirmation}
                                    onChangeText={setConfirmation}
                                    placeholder="DELETE"
                                    placeholderTextColor={colors.textMuted}
                                    autoCapitalize="characters"
                                    autoCorrect={false}
                                    returnKeyType="done"
                                />
                            </View>

                            {/* Submit */}
                            <TouchableOpacity
                                style={[styles.submitButton, !canSubmit && styles.buttonDisabled]}
                                onPress={handleSubmit}
                                disabled={!canSubmit}
                            >
                                {submitting ? (
                                    <ActivityIndicator size="small" color="#fff" />
                                ) : (
                                    <Text style={styles.submitButtonText}>Submit Deletion Request</Text>
                                )}
                            </TouchableOpacity>
                        </>
                    )}
                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const createStyles = ({ colors, spacing, typography, shadows, radius }) => StyleSheet.create({
    screen: {
        flex: 1,
        backgroundColor: colors.background,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: spacing.md,
        paddingTop: spacing.lg,
        paddingBottom: spacing.md,
    },
    backButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: colors.surface,
        justifyContent: 'center',
        alignItems: 'center',
        ...shadows.sm,
    },
    headerTitle: {
        fontSize: 17,
        fontWeight: '600',
        color: colors.text,
        flex: 1,
        textAlign: 'center',
        marginHorizontal: spacing.xs,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    content: {
        padding: spacing.md,
        paddingBottom: 48,
    },
    warningCard: {
        flexDirection: 'row',
        gap: spacing.sm,
        backgroundColor: colors.error + '18',
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: colors.error + '50',
        padding: spacing.md,
        marginBottom: spacing.md,
    },
    warningText: {
        flex: 1,
        fontSize: 14,
        color: colors.error,
        lineHeight: 20,
    },
    card: {
        backgroundColor: colors.surface,
        borderRadius: radius.lg,
        padding: spacing.md,
        marginBottom: spacing.md,
        ...shadows.sm,
        flexDirection: 'row',
        gap: spacing.sm,
    },
    infoIcon: {
        marginTop: 2,
    },
    infoText: {
        flex: 1,
        fontSize: 14,
        color: colors.text,
        lineHeight: 21,
    },
    bold: {
        fontWeight: '700',
    },
    fieldBlock: {
        marginBottom: spacing.md,
    },
    label: {
        fontSize: 13,
        fontWeight: '600',
        color: colors.textMuted,
        textTransform: 'uppercase',
        letterSpacing: 0.4,
        marginBottom: spacing.sm,
    },
    deleteWord: {
        color: colors.error,
        fontWeight: '700',
    },
    reasonInput: {
        backgroundColor: colors.surface,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.border,
        padding: spacing.md,
        fontSize: 15,
        color: colors.text,
        minHeight: 100,
        textAlignVertical: 'top',
        ...shadows.sm,
    },
    charCount: {
        fontSize: 12,
        color: colors.textMuted,
        textAlign: 'right',
        marginTop: 4,
    },
    confirmInput: {
        backgroundColor: colors.surface,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.border,
        padding: spacing.md,
        fontSize: 15,
        color: colors.text,
        ...shadows.sm,
    },
    submitButton: {
        backgroundColor: colors.error,
        borderRadius: radius.md,
        paddingVertical: spacing.md,
        alignItems: 'center',
        marginTop: spacing.sm,
        ...shadows.sm,
    },
    submitButtonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '600',
    },
    revokeButton: {
        backgroundColor: colors.surface,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.border,
        paddingVertical: spacing.md,
        alignItems: 'center',
        marginTop: spacing.sm,
        ...shadows.sm,
    },
    revokeButtonText: {
        color: colors.text,
        fontSize: 16,
        fontWeight: '600',
    },
    buttonDisabled: {
        opacity: 0.45,
    },
});
