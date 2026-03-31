import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Image,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
    StatusBar,
    Platform,
    Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { AuthContext } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { apiRequest, clearToken, getValidToken } from '../services/api';
import { prepareProfilePhotoAsset } from '../services/imageUpload';

export default function OnboardingProfileOptionalScreen({ navigation }) {
    const { token, apiBase, setNeedsOnboarding, setUser, setToken, onboardingConfig, user } = useContext(AuthContext);
    const { colors, spacing, typography, shadows, radius, isDark } = useTheme();

    const [profile, setProfile] = useState(null);
    const [bio, setBio] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [loggingOut, setLoggingOut] = useState(false);
    const [uploadingPhoto, setUploadingPhoto] = useState(false);
    const [error, setError] = useState('');
    const [termsAccepted, setTermsAccepted] = useState(false);

    const styles = useMemo(
        () => createStyles({ colors, spacing, typography, shadows, radius }),
        [colors, spacing, typography, shadows, radius]
    );

    const loadProfile = useCallback(async () => {
        try {
            setLoading(true);
            const data = await apiRequest({ apiBase, path: '/api/profile', token });
            setProfile(data.profile || null);
            setBio(data.profile?.bio || '');
        } catch (err) {
            setError(onboardingConfig?.optional?.loadError || 'Failed to load profile');
        } finally {
            setLoading(false);
        }
    }, [apiBase, token, onboardingConfig]);

    useEffect(() => {
        loadProfile();
    }, [loadProfile]);

    useEffect(() => {
        const requiredTermsVersion = onboardingConfig?.terms?.version;
        const acceptedActiveTerms = user?.termsAccepted === true
            && (!requiredTermsVersion || user?.termsAcceptedVersion === requiredTermsVersion);
        if (acceptedActiveTerms) {
            setTermsAccepted(true);
        }
    }, [onboardingConfig?.terms?.version, user?.termsAccepted, user?.termsAcceptedVersion]);

    const getProfileImageSource = () => {
        if (profile?.profileMediaPath) {
            return { uri: `${apiBase}/media/${profile.profileMediaPath}` };
        }
        if (profile?.picture) {
            return { uri: profile.picture };
        }
        return null;
    };

    const handlePickPhoto = async () => {
        try {
            const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (status !== 'granted') {
                Alert.alert('Permission Required', 'Please grant photo library access to upload a profile photo');
                return;
            }

            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ['images'],
                allowsEditing: Platform.OS === 'ios',
                aspect: [1, 1],
                quality: 1,
            });

            if (!result.canceled && result.assets?.[0]) {
                await uploadPhoto(result.assets[0]);
            }
        } catch (err) {
            Alert.alert('Error', 'Failed to pick image');
        }
    };

    const uploadPhoto = async (asset) => {
        try {
            setUploadingPhoto(true);

            const prepared = await prepareProfilePhotoAsset(asset, { forceSquare: Platform.OS === 'android' });
            if (!prepared) {
                throw new Error('Invalid photo selection');
            }

            const formData = new FormData();
            formData.append('photo', prepared);
            const authToken = await getValidToken(token);
            if (!authToken) {
                throw new Error('Session expired. Please sign in again.');
            }

            const res = await fetch(`${apiBase}/api/profile/photo`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                    'ngrok-skip-browser-warning': 'true',
                },
                body: formData,
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.error || 'Upload failed');
            }

            await loadProfile();
        } catch (err) {
            Alert.alert('Error', err.message || 'Failed to upload photo');
        } finally {
            setUploadingPhoto(false);
        }
    };

    const completeOnboarding = useCallback(async () => {
        const payload = { termsAccepted: true };
        const requiredTermsVersion = onboardingConfig?.terms?.version;
        if (requiredTermsVersion) {
            payload.termsVersion = requiredTermsVersion;
        }

        const result = await apiRequest({
            apiBase,
            path: '/api/onboarding/complete',
            method: 'POST',
            token,
            body: payload,
        });
        if (result?.user) {
            setUser(result.user);
        }
        setNeedsOnboarding(false);
        setTimeout(() => {
            navigation.reset({
                index: 1,
                routes: [{ name: 'Main' }, { name: 'ShelfCreateScreen' }],
            });
        }, 0);
    }, [apiBase, navigation, onboardingConfig?.terms?.version, setNeedsOnboarding, setUser, token]);

    const requireTermsAcceptance = useCallback(() => {
        if (termsAccepted) {
            return true;
        }
        setError(onboardingConfig?.terms?.requiredError || 'You must accept the Terms of Service to continue.');
        return false;
    }, [onboardingConfig?.terms?.requiredError, termsAccepted]);

    const openTerms = useCallback(() => {
        const url = onboardingConfig?.terms?.url;
        if (!url) {
            return;
        }
        Linking.openURL(url).catch(() => {
            setError('Unable to open Terms of Service link.');
        });
    }, [onboardingConfig?.terms?.url]);

    const handleContinue = useCallback(async () => {
        if (!requireTermsAcceptance()) {
            return;
        }
        try {
            setSaving(true);
            setError('');

            const trimmedBio = bio.trim();
            const existingBio = (profile?.bio || '').trim();
            if (trimmedBio !== existingBio) {
                await apiRequest({
                    apiBase,
                    path: '/api/profile',
                    method: 'PUT',
                    token,
                    body: { bio: trimmedBio },
                });
            }

            await completeOnboarding();
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    }, [apiBase, bio, completeOnboarding, profile, requireTermsAcceptance, token]);

    const handleSkip = useCallback(async () => {
        if (!requireTermsAcceptance()) {
            return;
        }
        try {
            setSaving(true);
            setError('');
            await completeOnboarding();
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    }, [completeOnboarding, requireTermsAcceptance]);

    const handleBackToLogin = useCallback(async () => {
        try {
            setLoggingOut(true);
            setError('');
            await clearToken();
            setUser(null);
            setNeedsOnboarding(false);
            setToken('');
        } catch (err) {
            setError('Unable to log out right now. Please try again.');
        } finally {
            setLoggingOut(false);
        }
    }, [setNeedsOnboarding, setToken, setUser]);

    if (!onboardingConfig?.optional) {
        return (
            <View style={[styles.screen, styles.centerContainer]}>
                <ActivityIndicator size="large" color={colors.primary} />
            </View>
        );
    }

    if (loading) {
        return (
            <View style={[styles.screen, styles.centerContainer]}>
                <ActivityIndicator size="large" color={colors.primary} />
            </View>
        );
    }

    const profileImage = getProfileImageSource();

    return (
        <SafeAreaView style={styles.screen} edges={['top']}>
            <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />

            <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
                <View style={styles.header}>
                    <Text style={styles.title}>{onboardingConfig.optional.title}</Text>
                    <Text style={styles.subtitle}>{onboardingConfig.optional.subtitle}</Text>
                </View>

                {error ? (
                    <View style={styles.errorBox}>
                        <Ionicons name="alert-circle" size={16} color={colors.error} />
                        <Text style={styles.errorText}>{error}</Text>
                    </View>
                ) : null}

                <View style={styles.card}>
                    <View style={styles.photoSection}>
                        <TouchableOpacity onPress={handlePickPhoto} disabled={uploadingPhoto}>
                            {profileImage ? (
                                <Image source={profileImage} style={styles.avatar} />
                            ) : (
                                <View style={styles.avatarPlaceholder}>
                                    <Ionicons name="person" size={36} color={colors.textInverted} />
                                </View>
                            )}
                            <View style={styles.photoOverlay}>
                                {uploadingPhoto ? (
                                    <ActivityIndicator size="small" color={colors.text} />
                                ) : (
                                    <Ionicons name="camera" size={20} color={colors.text} />
                                )}
                            </View>
                        </TouchableOpacity>
                        <Text style={styles.photoHint}>{onboardingConfig.optional.photoHint}</Text>
                    </View>

                    <View style={styles.inputGroup}>
                        <Text style={styles.label}>{onboardingConfig.optional.bioLabel}</Text>
                        <TextInput
                            style={[styles.input, styles.textArea]}
                            value={bio}
                            onChangeText={setBio}
                            placeholder={onboardingConfig.optional.bioPlaceholder}
                            placeholderTextColor={colors.textMuted}
                            multiline
                            numberOfLines={4}
                            maxLength={500}
                        />
                        <Text style={styles.charCount}>{bio.length}/500</Text>
                    </View>

                    <View style={styles.termsSection}>
                        <Text style={styles.termsTitle}>{onboardingConfig.terms?.title || 'Terms of Service'}</Text>
                        <Text style={styles.termsSubtitle}>
                            {onboardingConfig.terms?.subtitle || 'Please review and accept our Terms before continuing.'}
                        </Text>
                        <TouchableOpacity style={styles.termsLinkRow} onPress={openTerms} disabled={saving}>
                            <Ionicons name="document-text-outline" size={16} color={colors.primary} />
                            <Text style={styles.termsLinkText}>{onboardingConfig.terms?.readLabel || 'Read Terms of Service'}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={styles.checkboxRow}
                            onPress={() => setTermsAccepted((prev) => !prev)}
                            disabled={saving}
                        >
                            <Ionicons
                                name={termsAccepted ? 'checkbox' : 'square-outline'}
                                size={20}
                                color={termsAccepted ? colors.primary : colors.textMuted}
                            />
                            <Text style={styles.checkboxLabel}>
                                {onboardingConfig.terms?.agreeLabel || 'I agree to the Terms of Service'}
                            </Text>
                        </TouchableOpacity>
                    </View>
                </View>

                <TouchableOpacity
                    style={[styles.primaryButton, (saving || loggingOut || uploadingPhoto) && styles.primaryButtonDisabled]}
                    onPress={handleContinue}
                    disabled={saving || loggingOut || uploadingPhoto}
                >
                    <Text style={styles.primaryButtonText}>
                        {saving ? onboardingConfig.optional.savingLabel : onboardingConfig.optional.continueLabel}
                    </Text>
                    <Ionicons name="arrow-forward" size={18} color={colors.textInverted} />
                </TouchableOpacity>

                <TouchableOpacity style={styles.skipButton} onPress={handleSkip} disabled={saving || loggingOut || uploadingPhoto}>
                    <Text style={styles.skipText}>{onboardingConfig.optional.skipLabel}</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.logoutButton} onPress={handleBackToLogin} disabled={saving || loggingOut || uploadingPhoto}>
                    <Text style={styles.logoutButtonText}>
                        {loggingOut ? 'Returning to login...' : 'Back to Login'}
                    </Text>
                </TouchableOpacity>
            </ScrollView>
        </SafeAreaView>
    );
}

const createStyles = ({ colors, spacing, typography, shadows, radius }) =>
    StyleSheet.create({
        screen: {
            flex: 1,
            backgroundColor: colors.background,
        },
        centerContainer: {
            flex: 1,
            justifyContent: 'center',
            alignItems: 'center',
        },
        content: {
            padding: spacing.lg,
            paddingBottom: spacing['2xl'],
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
        photoSection: {
            alignItems: 'center',
            marginBottom: spacing.lg,
        },
        avatar: {
            width: 100,
            height: 100,
            borderRadius: 50,
        },
        avatarPlaceholder: {
            width: 100,
            height: 100,
            borderRadius: 50,
            backgroundColor: colors.primary,
            justifyContent: 'center',
            alignItems: 'center',
        },
        photoOverlay: {
            position: 'absolute',
            bottom: 0,
            right: 0,
            width: 32,
            height: 32,
            borderRadius: 16,
            backgroundColor: colors.surface,
            justifyContent: 'center',
            alignItems: 'center',
            ...shadows.sm,
        },
        photoHint: {
            fontSize: 13,
            color: colors.textMuted,
            marginTop: spacing.sm,
        },
        inputGroup: {
            marginBottom: spacing.sm,
        },
        termsSection: {
            marginTop: spacing.md,
            paddingTop: spacing.md,
            borderTopWidth: 1,
            borderTopColor: colors.border,
            gap: spacing.xs,
        },
        termsTitle: {
            fontSize: 14,
            fontWeight: '600',
            color: colors.text,
        },
        termsSubtitle: {
            fontSize: 13,
            color: colors.textMuted,
            lineHeight: 18,
        },
        termsLinkRow: {
            marginTop: spacing.xs,
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.xs,
        },
        termsLinkText: {
            color: colors.primary,
            fontSize: 13,
            fontWeight: '500',
            textDecorationLine: 'underline',
        },
        checkboxRow: {
            marginTop: spacing.sm,
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
        },
        checkboxLabel: {
            fontSize: 13,
            color: colors.text,
            flex: 1,
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
            fontSize: 15,
            color: colors.text,
        },
        textArea: {
            height: 110,
            textAlignVertical: 'top',
        },
        charCount: {
            fontSize: 12,
            color: colors.textMuted,
            textAlign: 'right',
            marginTop: 4,
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
        skipButton: {
            alignItems: 'center',
            paddingVertical: spacing.sm,
        },
        skipText: {
            color: colors.textMuted,
            fontSize: 14,
            textDecorationLine: 'underline',
        },
        logoutButton: {
            alignItems: 'center',
            paddingVertical: spacing.sm,
        },
        logoutButtonText: {
            color: colors.error,
            fontSize: 14,
            fontWeight: '600',
        },
    });
