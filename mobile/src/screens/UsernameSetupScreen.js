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
import { apiRequest } from '../services/api';

export default function UsernameSetupScreen({ navigation }) {
    const { token, apiBase, setNeedsOnboarding } = useContext(AuthContext);
    const { colors, spacing, typography, shadows, radius, isDark } = useTheme();

    const [username, setUsername] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const styles = createStyles({ colors, spacing, typography, shadows, radius });

    const handleSubmit = async () => {
        const trimmed = username.trim();
        if (!trimmed) {
            setError('Please enter a username');
            return;
        }
        if (trimmed.length < 3) {
            setError('Username must be at least 3 characters');
            return;
        }

        try {
            setLoading(true);
            setError('');
            await apiRequest({
                apiBase,
                path: '/api/auth/username',
                method: 'POST',
                token,
                body: { username: trimmed },
            });
            setNeedsOnboarding(false);
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
                <View style={styles.iconBox}>
                    <Ionicons name="person-add" size={40} color={colors.primary} />
                </View>

                <Text style={styles.title}>Choose a Username</Text>
                <Text style={styles.subtitle}>This is how other collectors will find you</Text>

                {error ? (
                    <View style={styles.errorBox}>
                        <Text style={styles.errorText}>{error}</Text>
                    </View>
                ) : null}

                <View style={styles.inputContainer}>
                    <Text style={styles.atSign}>@</Text>
                    <TextInput
                        style={styles.input}
                        value={username}
                        onChangeText={setUsername}
                        placeholder="username"
                        placeholderTextColor={colors.textMuted}
                        autoCapitalize="none"
                        autoCorrect={false}
                        autoFocus
                        editable={!loading}
                    />
                </View>

                <TouchableOpacity
                    style={[styles.continueButton, loading && styles.continueButtonDisabled]}
                    onPress={handleSubmit}
                    disabled={loading}
                >
                    <Text style={styles.continueButtonText}>
                        {loading ? 'Setting up...' : 'Continue'}
                    </Text>
                    <Ionicons name="arrow-forward" size={18} color={colors.textInverted} />
                </TouchableOpacity>
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
        alignItems: 'center',
        padding: spacing.lg,
    },
    iconBox: {
        width: 80,
        height: 80,
        borderRadius: 20,
        backgroundColor: colors.primary + '15',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: spacing.lg,
    },
    title: {
        fontSize: 24,
        fontWeight: '700',
        color: colors.text,
        textAlign: 'center',
    },
    subtitle: {
        fontSize: 15,
        color: colors.textMuted,
        textAlign: 'center',
        marginTop: spacing.xs,
        marginBottom: spacing.xl,
    },
    errorBox: {
        backgroundColor: colors.error + '15',
        padding: spacing.sm,
        borderRadius: radius.md,
        marginBottom: spacing.md,
        width: '100%',
    },
    errorText: {
        color: colors.error,
        fontSize: 13,
        textAlign: 'center',
    },
    inputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.surface,
        borderRadius: radius.lg,
        paddingHorizontal: spacing.md,
        width: '100%',
        ...shadows.sm,
    },
    atSign: {
        fontSize: 20,
        color: colors.textMuted,
        marginRight: 4,
    },
    input: {
        flex: 1,
        fontSize: 18,
        color: colors.text,
        paddingVertical: spacing.md,
    },
    continueButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.sm,
        backgroundColor: colors.primary,
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.xl,
        borderRadius: radius.lg,
        marginTop: spacing.lg,
        width: '100%',
    },
    continueButtonDisabled: {
        opacity: 0.6,
    },
    continueButtonText: {
        color: colors.textInverted,
        fontSize: 16,
        fontWeight: '600',
    },
});
