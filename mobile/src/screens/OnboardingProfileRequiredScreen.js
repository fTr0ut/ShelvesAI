import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
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

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function OnboardingProfileRequiredScreen({ navigation }) {
    const { token, apiBase, user, setUser } = useContext(AuthContext);
    const { colors, spacing, typography, shadows, radius, isDark } = useTheme();

    const [email, setEmail] = useState('');
    const [firstName, setFirstName] = useState('');
    const [city, setCity] = useState('');
    const [state, setState] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const styles = useMemo(
        () => createStyles({ colors, spacing, typography, shadows, radius }),
        [colors, spacing, typography, shadows, radius]
    );

    useEffect(() => {
        let mounted = true;

        const hydrate = async () => {
            if (!token) return;
            try {
                const data = await apiRequest({ apiBase, path: '/api/account', token });
                if (mounted && data.user) {
                    setUser(data.user);
                }
            } catch (err) {
                // ignore and rely on existing values
            }
        };

        if (!user) {
            hydrate();
        }

        return () => {
            mounted = false;
        };
    }, [apiBase, setUser, token, user]);

    useEffect(() => {
        if (user) {
            setEmail(user.email || '');
            setFirstName(user.firstName || '');
            setCity(user.city || '');
            setState(user.state || '');
        }
    }, [user]);

    const validate = useCallback(() => {
        const trimmedEmail = email.trim();
        if (!trimmedEmail || !emailPattern.test(trimmedEmail)) {
            return 'Enter a valid email address';
        }
        if (!firstName.trim()) {
            return 'First name is required';
        }
        if (!city.trim()) {
            return 'City is required';
        }
        if (!state.trim()) {
            return 'State is required';
        }
        return '';
    }, [email, firstName, city, state]);

    const handleContinue = useCallback(async () => {
        const validationError = validate();
        if (validationError) {
            setError(validationError);
            return;
        }

        try {
            setLoading(true);
            setError('');
            await apiRequest({
                apiBase,
                path: '/api/profile',
                method: 'PUT',
                token,
                body: {
                    email: email.trim(),
                    firstName: firstName.trim(),
                    city: city.trim(),
                    state: state.trim(),
                },
            });

            const refreshed = await apiRequest({ apiBase, path: '/api/account', token });
            if (refreshed.user) {
                setUser(refreshed.user);
            }

            navigation.navigate('OnboardingProfileOptional');
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [apiBase, city, email, firstName, navigation, state, token, validate, setUser]);

    return (
        <SafeAreaView style={styles.screen} edges={['top']}>
            <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />
            <KeyboardAvoidingView
                style={styles.container}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
                <View style={styles.header}>
                    <Text style={styles.title}>Complete your profile</Text>
                    <Text style={styles.subtitle}>We need a few details to get you started.</Text>
                </View>

                {error ? (
                    <View style={styles.errorBox}>
                        <Ionicons name="alert-circle" size={16} color={colors.error} />
                        <Text style={styles.errorText}>{error}</Text>
                    </View>
                ) : null}

                <View style={styles.card}>
                    <View style={styles.inputGroup}>
                        <Text style={styles.label}>Email</Text>
                        <TextInput
                            style={styles.input}
                            value={email}
                            onChangeText={setEmail}
                            placeholder="you@example.com"
                            placeholderTextColor={colors.textMuted}
                            autoCapitalize="none"
                            keyboardType="email-address"
                            editable={!loading}
                        />
                    </View>

                    <View style={styles.inputGroup}>
                        <Text style={styles.label}>First Name</Text>
                        <TextInput
                            style={styles.input}
                            value={firstName}
                            onChangeText={setFirstName}
                            placeholder="First name"
                            placeholderTextColor={colors.textMuted}
                            editable={!loading}
                        />
                    </View>

                    <View style={styles.row}>
                        <View style={styles.inputHalf}>
                            <Text style={styles.label}>City</Text>
                            <TextInput
                                style={styles.input}
                                value={city}
                                onChangeText={setCity}
                                placeholder="City"
                                placeholderTextColor={colors.textMuted}
                                editable={!loading}
                            />
                        </View>
                        <View style={styles.inputHalf}>
                            <Text style={styles.label}>State</Text>
                            <TextInput
                                style={styles.input}
                                value={state}
                                onChangeText={setState}
                                placeholder="State"
                                placeholderTextColor={colors.textMuted}
                                editable={!loading}
                            />
                        </View>
                    </View>
                </View>

                <TouchableOpacity
                    style={[styles.primaryButton, loading && styles.primaryButtonDisabled]}
                    onPress={handleContinue}
                    disabled={loading}
                >
                    <Text style={styles.primaryButtonText}>{loading ? 'Saving...' : 'Continue'}</Text>
                    <Ionicons name="arrow-forward" size={18} color={colors.textInverted} />
                </TouchableOpacity>
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
        container: {
            flex: 1,
            padding: spacing.lg,
            gap: spacing.lg,
        },
        header: {
            marginTop: spacing.md,
        },
        title: {
            fontSize: 24,
            fontWeight: '700',
            color: colors.text,
        },
        subtitle: {
            fontSize: 14,
            color: colors.textMuted,
            marginTop: spacing.xs,
        },
        card: {
            backgroundColor: colors.surface,
            borderRadius: radius.lg,
            padding: spacing.md,
            ...shadows.sm,
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
            paddingHorizontal: spacing.sm,
            paddingVertical: spacing.sm + 2,
            fontSize: 16,
            color: colors.text,
        },
        row: {
            flexDirection: 'row',
            gap: spacing.md,
        },
        inputHalf: {
            flex: 1,
        },
        errorBox: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
            backgroundColor: colors.error + '15',
            padding: spacing.sm,
            borderRadius: radius.md,
        },
        errorText: {
            color: colors.error,
            fontSize: 13,
            flex: 1,
        },
        primaryButton: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: spacing.sm,
            backgroundColor: colors.primary,
            paddingVertical: spacing.md,
            borderRadius: radius.lg,
        },
        primaryButtonDisabled: {
            opacity: 0.6,
        },
        primaryButtonText: {
            color: colors.textInverted,
            fontSize: 16,
            fontWeight: '600',
        },
    });
