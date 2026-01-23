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
import { Ionicons } from '@expo/vector-icons';
import { AuthContext } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { apiRequest, saveToken } from '../services/api';

export default function LoginScreen() {
    const { setToken, apiBase, setNeedsOnboarding, setUser } = useContext(AuthContext);
    const { colors, spacing, typography, shadows, radius, isDark } = useTheme();

    const [isRegister, setIsRegister] = useState(false);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [email, setEmail] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const styles = createStyles({ colors, spacing, typography, shadows, radius });

    const handleSubmit = async () => {
        setError('');
        const trimmedUsername = username.trim();
        const trimmedEmail = email.trim();
        if (!trimmedUsername || !password) {
            setError('Please enter username and password');
            return;
        }
        if (isRegister && !trimmedEmail) {
            setError('Please enter your email');
            return;
        }
        if (isRegister && password !== confirmPassword) {
            setError('Passwords do not match');
            return;
        }

        try {
            setLoading(true);
            const endpoint = isRegister ? '/api/auth/register' : '/api/auth/login';
            const data = await apiRequest({
                apiBase,
                path: endpoint,
                method: 'POST',
                body: isRegister
                    ? { username: trimmedUsername, password, email: trimmedEmail }
                    : { username: trimmedUsername, password },
            });

            if (data.token) {
                await saveToken(data.token);
                if (data.user) {
                    setUser(data.user);
                }
                if (typeof data.onboardingCompleted === 'boolean') {
                    setNeedsOnboarding(!data.onboardingCompleted);
                } else {
                    setNeedsOnboarding(!!data.needsOnboarding);
                }
                setToken(data.token);
            } else {
                setError('Authentication failed');
            }
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <KeyboardAvoidingView
            style={styles.screen}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
            <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />

            <View style={styles.container}>
                {/* Logo */}
                <View style={styles.logoSection}>
                    <View style={styles.logoBox}>
                        <Ionicons name="library" size={48} color={colors.primary} />
                    </View>
                    <Text style={styles.appName}>ShelvesAI</Text>
                    <Text style={styles.tagline}>Organize your collections</Text>
                </View>

                {/* Form */}
                <View style={styles.form}>
                    <Text style={styles.formTitle}>{isRegister ? 'Create Account' : 'Welcome Back'}</Text>

                    {error ? (
                        <View style={styles.errorBox}>
                            <Ionicons name="alert-circle" size={16} color={colors.error} />
                            <Text style={styles.errorText}>{error}</Text>
                        </View>
                    ) : null}

                    <View style={styles.inputGroup}>
                        <Text style={styles.label}>Username</Text>
                        <TextInput
                            style={styles.input}
                            value={username}
                            onChangeText={setUsername}
                            placeholder="Enter username"
                            placeholderTextColor={colors.textMuted}
                            autoCapitalize="none"
                            autoCorrect={false}
                            editable={!loading}
                        />
                    </View>



                    {isRegister && (
                        <View style={styles.inputGroup}>
                            <Text style={styles.label}>Email</Text>
                            <TextInput
                                style={styles.input}
                                value={email}
                                onChangeText={setEmail}
                                placeholder="Enter email"
                                placeholderTextColor={colors.textMuted}
                                autoCapitalize="none"
                                autoCorrect={false}
                                keyboardType="email-address"
                                editable={!loading}
                            />
                        </View>
                    )}
                    
                    <View style={styles.inputGroup}>
                        <Text style={styles.label}>Password</Text>
                        <TextInput
                            style={styles.input}
                            value={password}
                            onChangeText={setPassword}
                            placeholder="Enter password"
                            placeholderTextColor={colors.textMuted}
                            secureTextEntry
                            editable={!loading}
                        />
                    </View>

                    {isRegister && (
                        <View style={styles.inputGroup}>
                            <Text style={styles.label}>Confirm Password</Text>
                            <TextInput
                                style={styles.input}
                                value={confirmPassword}
                                onChangeText={setConfirmPassword}
                                placeholder="Confirm password"
                                placeholderTextColor={colors.textMuted}
                                secureTextEntry
                                editable={!loading}
                            />
                        </View>
                    )}

                    <TouchableOpacity
                        style={[styles.submitButton, loading && styles.submitButtonDisabled]}
                        onPress={handleSubmit}
                        disabled={loading}
                    >
                        <Text style={styles.submitButtonText}>
                            {loading ? 'Please wait...' : isRegister ? 'Create Account' : 'Log In'}
                        </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={styles.toggleButton}
                        onPress={() => {
                            setIsRegister(!isRegister);
                            setError('');
                        }}
                    >
                        <Text style={styles.toggleText}>
                            {isRegister ? 'Already have an account? ' : "Don't have an account? "}
                            <Text style={styles.toggleLink}>{isRegister ? 'Log In' : 'Sign Up'}</Text>
                        </Text>
                    </TouchableOpacity>
                </View>
            </View>
        </KeyboardAvoidingView>
    );
}

const createStyles = ({ colors, spacing, typography, shadows, radius }) => StyleSheet.create({
    screen: {
        flex: 1,
        backgroundColor: colors.background,
    },
    container: {
        flex: 1,
        justifyContent: 'center',
        padding: spacing.lg,
    },
    logoSection: {
        alignItems: 'center',
        marginBottom: spacing['2xl'],
    },
    logoBox: {
        width: 88,
        height: 88,
        borderRadius: 22,
        backgroundColor: colors.primary + '15',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: spacing.md,
    },
    appName: {
        fontSize: 28,
        fontWeight: '700',
        color: colors.text,
    },
    tagline: {
        fontSize: 15,
        color: colors.textMuted,
        marginTop: 4,
    },
    form: {
        backgroundColor: colors.surface,
        borderRadius: radius.xl,
        padding: spacing.lg,
        ...shadows.md,
    },
    formTitle: {
        fontSize: 20,
        fontWeight: '600',
        color: colors.text,
        textAlign: 'center',
        marginBottom: spacing.lg,
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
    toggleButton: {
        marginTop: spacing.lg,
        alignItems: 'center',
    },
    toggleText: {
        fontSize: 14,
        color: colors.textMuted,
    },
    toggleLink: {
        color: colors.primary,
        fontWeight: '600',
    },
});
