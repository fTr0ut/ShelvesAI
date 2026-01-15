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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { AuthContext } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { apiRequest } from '../services/api';
import { prepareProfilePhotoAsset } from '../services/imageUpload';

export default function OnboardingProfileOptionalScreen({ navigation }) {
    const { token, apiBase, setNeedsOnboarding, setUser, onboardingConfig } = useContext(AuthContext);
    const { colors, spacing, typography, shadows, radius, isDark } = useTheme();

    const [profile, setProfile] = useState(null);
    const [bio, setBio] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [uploadingPhoto, setUploadingPhoto] = useState(false);
    const [error, setError] = useState('');

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
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
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

            const res = await fetch(`${apiBase}/api/profile/photo`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
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
        const result = await apiRequest({
            apiBase,
            path: '/api/onboarding/complete',
            method: 'POST',
            token,
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
    }, [apiBase, navigation, setNeedsOnboarding, setUser, token]);

    const handleContinue = useCallback(async () => {
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
    }, [apiBase, bio, completeOnboarding, profile, token]);

    const handleSkip = useCallback(async () => {
        try {
            setSaving(true);
            setError('');
            await completeOnboarding();
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    }, [completeOnboarding]);

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
                </View>

                <TouchableOpacity
                    style={[styles.primaryButton, saving && styles.primaryButtonDisabled]}
                    onPress={handleContinue}
                    disabled={saving}
                >
                    <Text style={styles.primaryButtonText}>
                        {saving ? onboardingConfig.optional.savingLabel : onboardingConfig.optional.continueLabel}
                    </Text>
                    <Ionicons name="arrow-forward" size={18} color={colors.textInverted} />
                </TouchableOpacity>

                <TouchableOpacity style={styles.skipButton} onPress={handleSkip} disabled={saving}>
                    <Text style={styles.skipText}>{onboardingConfig.optional.skipLabel}</Text>
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
    });
