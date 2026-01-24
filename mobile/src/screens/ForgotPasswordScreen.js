import React, { useContext, useState } from 'react';
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

export default function ForgotPasswordScreen({ navigation }) {
    const { apiBase } = useContext(AuthContext);
    const { colors, spacing, typography, shadows, radius, isDark } = useTheme();

    const [email, setEmail] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [sent, setSent] = useState(false);

    const styles = createStyles({ colors, spacing, typography, shadows, radius });

    const handleSubmit = async () => {
        setError('');
        const trimmedEmail = email.trim().toLowerCase();

        if (!trimmedEmail) {
            setError('Please enter your email address');
            return;
        }

        try {
            setLoading(true);
            await apiRequest({
                apiBase,
                path: '/api/auth/forgot-password',
                method: 'POST',
                body: { email: trimmedEmail },
            });
            setSent(true);
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    if (sent) {
        return (
            <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
                <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />
                <View style={styles.container}>
                    <View style={styles.successCard}>
                        <View style={styles.iconBox}>
                            <Ionicons name="mail" size={48} color={colors.primary} />
                        </View>
                        <Text style={styles.successTitle}>Check your email</Text>
                        <Text style={styles.successText}>
                            If an account exists for {email}, we've sent a password reset link.
                        </Text>
                        <TouchableOpacity
                            style={styles.backButton}
                            onPress={() => navigation.goBack()}
                        >
                            <Ionicons name="arrow-back" size={18} color={colors.primary} />
                            <Text style={styles.backButtonText}>Back to login</Text>
                        </TouchableOpacity>
                    </View>
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
                            <Ionicons name="lock-open" size={40} color={colors.primary} />
                        </View>
                        <Text style={styles.title}>Forgot password?</Text>
                        <Text style={styles.subtitle}>
                            Enter the email address associated with your account and we'll send you a link to reset your password.
                        </Text>
                    </View>

                    <View style={styles.form}>
                        {error ? (
                            <View style={styles.errorBox}>
                                <Ionicons name="alert-circle" size={16} color={colors.error} />
                                <Text style={styles.errorText}>{error}</Text>
                            </View>
                        ) : null}

                        <View style={styles.inputGroup}>
                            <Text style={styles.label}>Email</Text>
                            <TextInput
                                style={styles.input}
                                value={email}
                                onChangeText={setEmail}
                                placeholder="Enter your email"
                                placeholderTextColor={colors.textMuted}
                                autoCapitalize="none"
                                autoCorrect={false}
                                keyboardType="email-address"
                                editable={!loading}
                                autoFocus
                            />
                        </View>

                        <TouchableOpacity
                            style={[styles.submitButton, loading && styles.submitButtonDisabled]}
                            onPress={handleSubmit}
                            disabled={loading}
                        >
                            <Text style={styles.submitButtonText}>
                                {loading ? 'Sending...' : 'Send Reset Link'}
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
        successCard: {
            flex: 1,
            justifyContent: 'center',
            alignItems: 'center',
            padding: spacing.lg,
        },
        successTitle: {
            fontSize: 24,
            fontWeight: '700',
            color: colors.text,
            marginBottom: spacing.sm,
        },
        successText: {
            fontSize: 15,
            color: colors.textMuted,
            textAlign: 'center',
            lineHeight: 22,
            marginBottom: spacing.xl,
        },
        backButton: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.xs,
        },
        backButtonText: {
            fontSize: 16,
            color: colors.primary,
            fontWeight: '600',
        },
    });
