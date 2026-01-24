import React, { useContext, useState, useEffect } from 'react';
import {
    KeyboardAvoidingView,
    Platform,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
    StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AuthContext } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { apiRequest } from '../services/api';

export default function ResetPasswordScreen({ navigation, route }) {
    const { apiBase } = useContext(AuthContext);
    const { colors, spacing, typography, shadows, radius, isDark } = useTheme();

    const tokenFromParams = route?.params?.token || '';

    const [token, setToken] = useState(tokenFromParams);
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);
    const [validating, setValidating] = useState(!!tokenFromParams);
    const [tokenValid, setTokenValid] = useState(null);

    const styles = createStyles({ colors, spacing, typography, shadows, radius });

    useEffect(() => {
        if (tokenFromParams) {
            validateToken(tokenFromParams);
        }
    }, [tokenFromParams]);

    const validateToken = async (t) => {
        try {
            setValidating(true);
            const result = await apiRequest({
                apiBase,
                path: `/api/auth/validate-reset-token?token=${encodeURIComponent(t)}`,
                method: 'GET',
            });
            setTokenValid(result.valid);
            if (!result.valid) {
                setError(result.error || 'Invalid or expired reset link');
            }
        } catch (e) {
            setTokenValid(false);
            setError('Failed to validate reset link');
        } finally {
            setValidating(false);
        }
    };

    const handleSubmit = async () => {
        setError('');

        if (!token.trim()) {
            setError('Please enter the reset code from your email');
            return;
        }

        if (!password || password.length < 6) {
            setError('Password must be at least 6 characters');
            return;
        }

        if (password !== confirmPassword) {
            setError('Passwords do not match');
            return;
        }

        try {
            setLoading(true);
            await apiRequest({
                apiBase,
                path: '/api/auth/reset-password',
                method: 'POST',
                body: { token: token.trim(), password },
            });
            setSuccess(true);
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    if (success) {
        return (
            <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
                <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />
                <View style={styles.successContainer}>
                    <View style={styles.iconBox}>
                        <Ionicons name="checkmark-circle" size={64} color={colors.success || '#22c55e'} />
                    </View>
                    <Text style={styles.successTitle}>Password Reset!</Text>
                    <Text style={styles.successText}>
                        Your password has been successfully reset. You can now log in with your new password.
                    </Text>
                    <TouchableOpacity
                        style={styles.submitButton}
                        onPress={() => navigation.navigate('Login')}
                    >
                        <Text style={styles.submitButtonText}>Go to Login</Text>
                    </TouchableOpacity>
                </View>
            </SafeAreaView>
        );
    }

    if (validating) {
        return (
            <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
                <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />
                <View style={styles.successContainer}>
                    <Ionicons name="hourglass" size={48} color={colors.primary} />
                    <Text style={styles.loadingText}>Validating reset link...</Text>
                </View>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
            <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />
            <KeyboardAvoidingView
                style={styles.keyboardView}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
                <View style={styles.container}>
                    <TouchableOpacity
                        style={styles.backArrow}
                        onPress={() => navigation.goBack()}
                    >
                        <Ionicons name="arrow-back" size={24} color={colors.text} />
                    </TouchableOpacity>

                    <View style={styles.header}>
                        <View style={styles.iconBox}>
                            <Ionicons name="key" size={40} color={colors.primary} />
                        </View>
                        <Text style={styles.title}>Reset Password</Text>
                        <Text style={styles.subtitle}>
                            Enter your new password below.
                        </Text>
                    </View>

                    <View style={styles.form}>
                        {error ? (
                            <View style={styles.errorBox}>
                                <Ionicons name="alert-circle" size={16} color={colors.error} />
                                <Text style={styles.errorText}>{error}</Text>
                            </View>
                        ) : null}

                        {!tokenFromParams && (
                            <View style={styles.inputGroup}>
                                <Text style={styles.label}>Reset Code</Text>
                                <TextInput
                                    style={styles.input}
                                    value={token}
                                    onChangeText={setToken}
                                    placeholder="Paste reset code from email"
                                    placeholderTextColor={colors.textMuted}
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    editable={!loading}
                                />
                            </View>
                        )}

                        <View style={styles.inputGroup}>
                            <Text style={styles.label}>New Password</Text>
                            <TextInput
                                style={styles.input}
                                value={password}
                                onChangeText={setPassword}
                                placeholder="Enter new password"
                                placeholderTextColor={colors.textMuted}
                                secureTextEntry
                                editable={!loading}
                            />
                        </View>

                        <View style={styles.inputGroup}>
                            <Text style={styles.label}>Confirm Password</Text>
                            <TextInput
                                style={styles.input}
                                value={confirmPassword}
                                onChangeText={setConfirmPassword}
                                placeholder="Confirm new password"
                                placeholderTextColor={colors.textMuted}
                                secureTextEntry
                                editable={!loading}
                            />
                        </View>

                        <TouchableOpacity
                            style={[styles.submitButton, loading && styles.submitButtonDisabled]}
                            onPress={handleSubmit}
                            disabled={loading}
                        >
                            <Text style={styles.submitButtonText}>
                                {loading ? 'Resetting...' : 'Reset Password'}
                            </Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const createStyles = ({ colors, spacing, typography, shadows, radius }) =>
    StyleSheet.create({
        screen: {
            flex: 1,
            backgroundColor: colors.background,
        },
        keyboardView: {
            flex: 1,
        },
        container: {
            flex: 1,
            padding: spacing.lg,
        },
        backArrow: {
            marginBottom: spacing.lg,
        },
        header: {
            alignItems: 'center',
            marginBottom: spacing.xl,
        },
        iconBox: {
            width: 80,
            height: 80,
            borderRadius: 20,
            backgroundColor: colors.primary + '15',
            justifyContent: 'center',
            alignItems: 'center',
            marginBottom: spacing.md,
        },
        title: {
            fontSize: 24,
            fontWeight: '700',
            color: colors.text,
            marginBottom: spacing.sm,
        },
        subtitle: {
            fontSize: 15,
            color: colors.textMuted,
            textAlign: 'center',
            lineHeight: 22,
        },
        form: {
            backgroundColor: colors.surface,
            borderRadius: radius.xl,
            padding: spacing.lg,
            ...shadows.md,
        },
        errorBox: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
            backgroundColor: colors.error + '15',
            padding: spacing.sm,
            borderRadius: radius.md,
            marginBottom: spacing.md,
        },
        errorText: {
            color: colors.error,
            fontSize: 13,
            flex: 1,
        },
        inputGroup: {
            marginBottom: spacing.md,
        },
        label: {
            fontSize: 13,
            fontWeight: '500',
            color: colors.textMuted,
            marginBottom: spacing.xs,
        },
        input: {
            backgroundColor: colors.background,
            borderRadius: radius.md,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm + 2,
            fontSize: 16,
            color: colors.text,
        },
        submitButton: {
            backgroundColor: colors.primary,
            paddingVertical: spacing.md,
            borderRadius: radius.md,
            alignItems: 'center',
            marginTop: spacing.sm,
        },
        submitButtonDisabled: {
            opacity: 0.6,
        },
        submitButtonText: {
            color: colors.textInverted,
            fontSize: 16,
            fontWeight: '600',
        },
        successContainer: {
            flex: 1,
            justifyContent: 'center',
            alignItems: 'center',
            padding: spacing.lg,
        },
        successTitle: {
            fontSize: 24,
            fontWeight: '700',
            color: colors.text,
            marginTop: spacing.md,
            marginBottom: spacing.sm,
        },
        successText: {
            fontSize: 15,
            color: colors.textMuted,
            textAlign: 'center',
            lineHeight: 22,
            marginBottom: spacing.xl,
        },
        loadingText: {
            fontSize: 16,
            color: colors.textMuted,
            marginTop: spacing.md,
        },
    });
