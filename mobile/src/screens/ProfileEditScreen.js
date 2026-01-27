import React, { useContext, useEffect, useMemo, useState, useCallback } from 'react';
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

export default function ProfileEditScreen({ navigation }) {
    const { token, apiBase, user: currentUser } = useContext(AuthContext);
    const { colors, spacing, typography, shadows, radius, isDark } = useTheme();

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [uploadingPhoto, setUploadingPhoto] = useState(false);
    const [profile, setProfile] = useState(null);

    // Form fields
    const [firstName, setFirstName] = useState('');
    const [lastName, setLastName] = useState('');
    const [bio, setBio] = useState('');
    const [city, setCity] = useState('');
    const [state, setState] = useState('');
    const [country, setCountry] = useState('');
    const [email, setEmail] = useState('');

    const styles = useMemo(
        () => createStyles({ colors, spacing, typography, shadows, radius }),
        [colors, spacing, typography, shadows, radius]
    );

    useEffect(() => {
        loadProfile();
    }, []);

    const loadProfile = async () => {
        try {
            setLoading(true);
            const data = await apiRequest({ apiBase, path: '/api/profile', token });
            setProfile(data.profile);
            setFirstName(data.profile?.firstName || '');
            setLastName(data.profile?.lastName || '');
            setBio(data.profile?.bio || '');
            setCity(data.profile?.city || '');
            setState(data.profile?.state || '');
            setCountry(data.profile?.country || '');
            setEmail(data.profile?.email || '');
        } catch (e) {
            Alert.alert('Error', 'Failed to load profile');
        } finally {
            setLoading(false);
        }
    };

    const handleSave = useCallback(async () => {
        try {
            setSaving(true);
            await apiRequest({
                apiBase,
                path: '/api/profile',
                method: 'PUT',
                token,
                body: { firstName, lastName, bio, city, state, country, email },
            });
            Alert.alert('Saved', 'Your profile has been updated', [
                { text: 'OK', onPress: () => navigation.goBack() }
            ]);
        } catch (e) {
            Alert.alert('Error', e.message);
        } finally {
            setSaving(false);
        }
    }, [apiBase, token, firstName, lastName, bio, city, state, country, email, navigation]);

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
        } catch (e) {
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
                    'ngrok-skip-browser-warning': 'true',
                },
                body: formData,
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.error || 'Upload failed');
            }

            const data = await res.json();

            // Reload profile to get new photo
            await loadProfile();
            Alert.alert('Success', 'Profile photo updated!');
        } catch (e) {
            Alert.alert('Error', e.message || 'Failed to upload photo');
        } finally {
            setUploadingPhoto(false);
        }
    };

    const getProfileImageSource = () => {
        if (profile?.profileMediaPath) {
            return { uri: `${apiBase}/media/${profile.profileMediaPath}` };
        }
        if (profile?.picture) {
            return { uri: profile.picture };
        }
        return null;
    };

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
                {/* Header */}
                <View style={styles.header}>
                    <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
                        <Ionicons name="arrow-back" size={22} color={colors.text} />
                    </TouchableOpacity>
                    <Text style={styles.headerTitle}>Edit Profile</Text>
                    <View style={{ width: 40 }} />
                </View>

                {/* Profile Photo */}
                <View style={styles.photoSection}>
                    <TouchableOpacity onPress={handlePickPhoto} disabled={uploadingPhoto}>
                        {profileImage ? (
                            <Image source={profileImage} style={styles.avatar} />
                        ) : (
                            <View style={styles.avatarPlaceholder}>
                                <Text style={styles.avatarText}>
                                    {(firstName?.[0] || currentUser?.username?.[0] || '?').toUpperCase()}
                                </Text>
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
                    <Text style={styles.photoHint}>Tap to change photo</Text>
                </View>

                {/* Form */}
                <View style={styles.card}>
                    <View style={styles.inputFull}>
                        <Text style={styles.label}>Email</Text>
                        <TextInput
                            style={styles.input}
                            value={email}
                            onChangeText={setEmail}
                            placeholder="Email"
                            placeholderTextColor={colors.textMuted}
                            autoCapitalize="none"
                            keyboardType="email-address"
                        />
                    </View>

                    <View style={styles.row}>
                        <View style={styles.inputHalf}>
                            <Text style={styles.label}>First Name</Text>
                            <TextInput
                                style={styles.input}
                                value={firstName}
                                onChangeText={setFirstName}
                                placeholder="First"
                                placeholderTextColor={colors.textMuted}
                            />
                        </View>
                        <View style={styles.inputHalf}>
                            <Text style={styles.label}>Last Name</Text>
                            <TextInput
                                style={styles.input}
                                value={lastName}
                                onChangeText={setLastName}
                                placeholder="Last"
                                placeholderTextColor={colors.textMuted}
                            />
                        </View>
                    </View>

                    <View style={styles.inputFull}>
                        <Text style={styles.label}>Bio</Text>
                        <TextInput
                            style={[styles.input, styles.textArea]}
                            value={bio}
                            onChangeText={setBio}
                            placeholder="Write something about yourself..."
                            placeholderTextColor={colors.textMuted}
                            multiline
                            numberOfLines={4}
                            maxLength={500}
                        />
                        <Text style={styles.charCount}>{bio.length}/500</Text>
                    </View>
                </View>

                <View style={styles.card}>
                    <Text style={styles.cardTitle}>Location</Text>

                    <View style={styles.inputFull}>
                        <Text style={styles.label}>City</Text>
                        <TextInput
                            style={styles.input}
                            value={city}
                            onChangeText={setCity}
                            placeholder="City"
                            placeholderTextColor={colors.textMuted}
                        />
                    </View>

                    <View style={styles.row}>
                        <View style={styles.inputHalf}>
                            <Text style={styles.label}>State/Province</Text>
                            <TextInput
                                style={styles.input}
                                value={state}
                                onChangeText={setState}
                                placeholder="State"
                                placeholderTextColor={colors.textMuted}
                            />
                        </View>
                        <View style={styles.inputHalf}>
                            <Text style={styles.label}>Country</Text>
                            <TextInput
                                style={styles.input}
                                value={country}
                                onChangeText={setCountry}
                                placeholder="Country"
                                placeholderTextColor={colors.textMuted}
                            />
                        </View>
                    </View>
                </View>

                {/* Save Button */}
                <TouchableOpacity
                    style={[styles.saveButton, saving && styles.saveButtonDisabled]}
                    onPress={handleSave}
                    disabled={saving}
                >
                    <Text style={styles.saveButtonText}>{saving ? 'Saving...' : 'Save Changes'}</Text>
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
            justifyContent: 'center',
            alignItems: 'center',
        },
        content: {
            padding: spacing.md,
            paddingBottom: 40,
        },
        header: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: spacing.lg,
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
            fontSize: 18,
            fontWeight: '600',
            color: colors.text,
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
        avatarText: {
            fontSize: 36,
            fontWeight: '600',
            color: colors.textInverted,
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
        card: {
            backgroundColor: colors.surface,
            borderRadius: radius.lg,
            padding: spacing.md,
            marginBottom: spacing.md,
            ...shadows.sm,
        },
        cardTitle: {
            fontSize: 14,
            fontWeight: '600',
            color: colors.textMuted,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            marginBottom: spacing.md,
        },
        row: {
            flexDirection: 'row',
            gap: spacing.md,
        },
        inputHalf: {
            flex: 1,
            marginBottom: spacing.sm,
        },
        inputFull: {
            marginBottom: spacing.sm,
        },
        label: {
            fontSize: 13,
            color: colors.textMuted,
            marginBottom: 4,
        },
        input: {
            backgroundColor: colors.background,
            borderRadius: radius.md,
            paddingHorizontal: spacing.sm,
            paddingVertical: spacing.sm,
            fontSize: 15,
            color: colors.text,
        },
        textArea: {
            height: 100,
            textAlignVertical: 'top',
        },
        charCount: {
            fontSize: 12,
            color: colors.textMuted,
            textAlign: 'right',
            marginTop: 4,
        },
        saveButton: {
            backgroundColor: colors.primary,
            paddingVertical: spacing.md,
            borderRadius: radius.md,
            alignItems: 'center',
            marginTop: spacing.sm,
        },
        saveButtonDisabled: {
            opacity: 0.6,
        },
        saveButtonText: {
            color: colors.textInverted,
            fontWeight: '600',
            fontSize: 16,
        },
    });
