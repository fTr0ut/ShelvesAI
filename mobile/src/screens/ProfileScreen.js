import React, { useContext, useEffect, useMemo, useState, useCallback } from 'react';
import {
    ActivityIndicator,
    Alert,
    Image,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    TextInput,
    TouchableOpacity,
    View,
    StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { AuthContext } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { apiRequest } from '../services/api';

export default function ProfileScreen({ navigation, route }) {
    const { token, apiBase, user: currentUser } = useContext(AuthContext);
    const { colors, spacing, typography, shadows, radius, isDark } = useTheme();

    const username = route.params?.username || currentUser?.username;
    const [profile, setProfile] = useState(null);
    const [shelves, setShelves] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [editing, setEditing] = useState(false);
    const [uploadingPhoto, setUploadingPhoto] = useState(false);
    const [error, setError] = useState(null);

    // Editable fields
    const [firstName, setFirstName] = useState('');
    const [lastName, setLastName] = useState('');
    const [bio, setBio] = useState('');
    const [city, setCity] = useState('');
    const [state, setState] = useState('');
    const [country, setCountry] = useState('');
    const [isPrivate, setIsPrivate] = useState(false);

    const styles = useMemo(
        () => createStyles({ colors, spacing, typography, shadows, radius }),
        [colors, spacing, typography, shadows, radius]
    );

    const isOwnProfile = !route.params?.username || profile?.username === currentUser?.username;

    useEffect(() => {
        loadProfile();
    }, [username]);

    const loadProfile = async () => {
        try {
            setLoading(true);
            setError(null);

            const profilePath = route.params?.username ? `/api/profile/${username}` : '/api/profile';
            const profileData = await apiRequest({ apiBase, path: profilePath, token });
            setProfile(profileData.profile);

            // Set editable fields
            if (profileData.profile) {
                setFirstName(profileData.profile.firstName || '');
                setLastName(profileData.profile.lastName || '');
                setBio(profileData.profile.bio || '');
                setCity(profileData.profile.city || '');
                setState(profileData.profile.state || '');
                setCountry(profileData.profile.country || '');
                setIsPrivate(profileData.profile.isPrivate || false);
            }

            // Load shelves if not private or own profile
            if (profileData.profile && (!profileData.profile.isPrivate || isOwnProfile)) {
                try {
                    const shelvesPath = route.params?.username
                        ? `/api/profile/${username}/shelves`
                        : `/api/profile/${currentUser?.username}/shelves`;
                    const shelvesData = await apiRequest({ apiBase, path: shelvesPath, token });
                    setShelves(shelvesData.shelves || []);
                } catch (e) {
                    console.warn('Failed to load shelves:', e);
                    setShelves([]);
                }
            }
        } catch (e) {
            console.error('Failed to load profile:', e);
            setError(e.message);
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
                body: { firstName, lastName, bio, city, state, country, isPrivate },
            });
            setEditing(false);
            loadProfile();
            Alert.alert('Saved', 'Your profile has been updated');
        } catch (e) {
            Alert.alert('Error', e.message);
        } finally {
            setSaving(false);
        }
    }, [apiBase, token, firstName, lastName, bio, city, state, country, isPrivate]);

    const handlePickPhoto = async () => {
        try {
            const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (status !== 'granted') {
                Alert.alert('Permission Required', 'Please grant photo library access');
                return;
            }

            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                allowsEditing: true,
                aspect: [1, 1],
                quality: 0.8,
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
            const formData = new FormData();
            formData.append('photo', {
                uri: asset.uri,
                type: asset.type || 'image/jpeg',
                name: asset.fileName || 'profile.jpg',
            });

            const res = await fetch(`${apiBase}/api/profile/photo`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
                body: formData,
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.error || 'Upload failed');
            }

            await loadProfile();
            Alert.alert('Success', 'Profile photo updated!');
        } catch (e) {
            Alert.alert('Error', e.message || 'Failed to upload photo');
        } finally {
            setUploadingPhoto(false);
        }
    };

    const handleAddFriend = async () => {
        if (!profile?.id) return;
        try {
            await apiRequest({
                apiBase,
                path: '/api/friends/request',
                method: 'POST',
                token,
                body: { targetUserId: profile.id },
            });
            Alert.alert('Success', 'Friend request sent!');
        } catch (e) {
            Alert.alert('Error', e.message);
        }
    };

    const handleRemoveFriend = useCallback(() => {
        if (!profile?.friendshipId) return;

        Alert.alert(
            'Remove Friend',
            `Are you sure you want to remove ${profile.firstName || profile.username} from your friends?`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Remove',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            await apiRequest({
                                apiBase,
                                path: `/api/friends/${profile.friendshipId}`,
                                method: 'DELETE',
                                token,
                            });
                            Alert.alert('Removed', 'Friend removed successfully');
                            navigation.goBack();
                        } catch (e) {
                            Alert.alert('Error', e.message);
                        }
                    },
                },
            ]
        );
    }, [apiBase, token, profile, navigation]);

    const getProfileImageSource = () => {
        if (profile?.profileMediaPath) {
            return { uri: `${apiBase}/media/${profile.profileMediaPath}` };
        }
        if (profile?.picture) {
            return { uri: profile.picture };
        }
        return null;
    };

    const renderShelfCard = ({ item }) => (
        <TouchableOpacity
            style={styles.shelfCard}
            onPress={() => navigation.navigate('ShelfDetail', { id: item.id })}
        >
            <View style={styles.shelfIcon}>
                <Ionicons name="library" size={24} color={colors.primary} />
            </View>
            <View style={styles.shelfInfo}>
                <Text style={styles.shelfName} numberOfLines={1}>{item.name}</Text>
                <Text style={styles.shelfMeta}>{item.itemCount || 0} items • {item.type}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </TouchableOpacity>
    );

    if (loading) {
        return (
            <View style={[styles.screen, styles.centerContainer]}>
                <ActivityIndicator size="large" color={colors.primary} />
            </View>
        );
    }

    if (error || !profile) {
        return (
            <SafeAreaView style={styles.screen} edges={['top']}>
                <View style={styles.header}>
                    <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
                        <Ionicons name="arrow-back" size={22} color={colors.text} />
                    </TouchableOpacity>
                    <Text style={styles.headerTitle}>Profile</Text>
                    <View style={{ width: 40 }} />
                </View>
                <View style={styles.centerContainer}>
                    <Ionicons name="alert-circle" size={48} color={colors.textMuted} />
                    <Text style={styles.errorText}>{error || 'User not found'}</Text>
                    <TouchableOpacity style={styles.retryButton} onPress={loadProfile}>
                        <Text style={styles.retryButtonText}>Try Again</Text>
                    </TouchableOpacity>
                </View>
            </SafeAreaView>
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
                    <Text style={styles.headerTitle}>Profile</Text>
                    {isOwnProfile && !editing ? (
                        <TouchableOpacity onPress={() => setEditing(true)} style={styles.editButton}>
                            <Ionicons name="pencil" size={18} color={colors.text} />
                        </TouchableOpacity>
                    ) : isOwnProfile && editing ? (
                        <TouchableOpacity onPress={() => setEditing(false)} style={styles.editButton}>
                            <Ionicons name="close" size={20} color={colors.text} />
                        </TouchableOpacity>
                    ) : (
                        <View style={{ width: 40 }} />
                    )}
                </View>

                {/* Profile Photo */}
                <View style={styles.profileSection}>
                    <TouchableOpacity
                        onPress={isOwnProfile ? handlePickPhoto : undefined}
                        disabled={!isOwnProfile || uploadingPhoto}
                    >
                        {profileImage ? (
                            <Image source={profileImage} style={styles.avatar} />
                        ) : (
                            <View style={styles.avatarPlaceholder}>
                                <Text style={styles.avatarText}>
                                    {(firstName?.[0] || profile.username?.[0] || '?').toUpperCase()}
                                </Text>
                            </View>
                        )}
                        {isOwnProfile && (
                            <View style={styles.photoOverlay}>
                                {uploadingPhoto ? (
                                    <ActivityIndicator size="small" color={colors.text} />
                                ) : (
                                    <Ionicons name="camera" size={18} color={colors.text} />
                                )}
                            </View>
                        )}
                    </TouchableOpacity>

                    {/* Name and Username */}
                    {editing ? (
                        <View style={styles.editNameRow}>
                            <TextInput
                                style={styles.nameInput}
                                value={firstName}
                                onChangeText={setFirstName}
                                placeholder="First"
                                placeholderTextColor={colors.textMuted}
                            />
                            <TextInput
                                style={styles.nameInput}
                                value={lastName}
                                onChangeText={setLastName}
                                placeholder="Last"
                                placeholderTextColor={colors.textMuted}
                            />
                        </View>
                    ) : (
                        <Text style={styles.displayName}>
                            {[profile.firstName, profile.lastName].filter(Boolean).join(' ') || profile.username}
                        </Text>
                    )}
                    <Text style={styles.username}>@{profile.username}</Text>

                    {/* Bio */}
                    {editing ? (
                        <View style={styles.bioContainer}>
                            <TextInput
                                style={styles.bioInput}
                                value={bio}
                                onChangeText={setBio}
                                placeholder="Write something about yourself..."
                                placeholderTextColor={colors.textMuted}
                                multiline
                                maxLength={500}
                            />
                            <Text style={styles.charCount}>{bio.length}/500</Text>
                        </View>
                    ) : profile.bio ? (
                        <Text style={styles.bio}>{profile.bio}</Text>
                    ) : isOwnProfile ? (
                        <TouchableOpacity onPress={() => setEditing(true)}>
                            <Text style={styles.addBioHint}>+ Add bio</Text>
                        </TouchableOpacity>
                    ) : null}

                    {/* Location */}
                    {editing ? (
                        <View style={styles.locationEditRow}>
                            <TextInput
                                style={styles.locationInput}
                                value={city}
                                onChangeText={setCity}
                                placeholder="City"
                                placeholderTextColor={colors.textMuted}
                            />
                            <TextInput
                                style={styles.locationInput}
                                value={state}
                                onChangeText={setState}
                                placeholder="State"
                                placeholderTextColor={colors.textMuted}
                            />
                            <TextInput
                                style={styles.locationInput}
                                value={country}
                                onChangeText={setCountry}
                                placeholder="Country"
                                placeholderTextColor={colors.textMuted}
                            />
                        </View>
                    ) : (profile.city || profile.state || profile.country) ? (
                        <View style={styles.locationRow}>
                            <Ionicons name="location" size={14} color={colors.textMuted} />
                            <Text style={styles.locationText}>
                                {[profile.city, profile.state, profile.country].filter(Boolean).join(', ')}
                            </Text>
                        </View>
                    ) : null}

                    {/* Privacy toggle (owner only) */}
                    {editing && (
                        <View style={styles.privacyRow}>
                            <View>
                                <Text style={styles.privacyLabel}>Private Account</Text>
                                <Text style={styles.privacyHint}>Hide shelves from non-friends</Text>
                            </View>
                            <Switch
                                value={isPrivate}
                                onValueChange={setIsPrivate}
                                trackColor={{ false: colors.border, true: colors.primary + '80' }}
                                thumbColor={isPrivate ? colors.primary : colors.surfaceElevated}
                            />
                        </View>
                    )}

                    {/* Save button */}
                    {editing && (
                        <TouchableOpacity
                            style={[styles.saveButton, saving && styles.saveButtonDisabled]}
                            onPress={handleSave}
                            disabled={saving}
                        >
                            <Text style={styles.saveButtonText}>{saving ? 'Saving...' : 'Save Changes'}</Text>
                        </TouchableOpacity>
                    )}

                    {/* Stats and Actions */}
                    {!editing && (
                        <>
                            <View style={styles.statsRow}>
                                <View style={styles.stat}>
                                    <Text style={styles.statNumber}>{profile.shelfCount || shelves.length || 0}</Text>
                                    <Text style={styles.statLabel}>Shelves</Text>
                                </View>
                                {profile.isFriend && (
                                    <View style={styles.friendBadge}>
                                        <Ionicons name="people" size={14} color={colors.success} />
                                        <Text style={styles.friendBadgeText}>Friends</Text>
                                    </View>
                                )}
                            </View>

                            {!isOwnProfile && !profile.isFriend && (
                                <TouchableOpacity style={styles.addFriendButton} onPress={handleAddFriend}>
                                    <Ionicons name="person-add" size={18} color={colors.textInverted} />
                                    <Text style={styles.addFriendText}>Add Friend</Text>
                                </TouchableOpacity>
                            )}

                            {!isOwnProfile && profile.isFriend && (
                                <TouchableOpacity style={styles.removeFriendButton} onPress={handleRemoveFriend}>
                                    <Ionicons name="person-remove-outline" size={18} color={colors.error} />
                                    <Text style={styles.removeFriendText}>Remove Friend</Text>
                                </TouchableOpacity>
                            )}

                            {isOwnProfile && (
                                <TouchableOpacity
                                    style={styles.wishlistButton}
                                    onPress={() => navigation.navigate('Wishlists')}
                                >
                                    <Ionicons name="heart" size={18} color={colors.primary} />
                                    <Text style={styles.wishlistButtonText}>My Wishlists</Text>
                                </TouchableOpacity>
                            )}
                        </>
                    )}
                </View>

                {/* Private Profile Notice */}
                {!editing && profile.isPrivate && !isOwnProfile && !profile.isFriend && (
                    <View style={styles.privateNotice}>
                        <Ionicons name="lock-closed" size={20} color={colors.textMuted} />
                        <Text style={styles.privateNoticeText}>This profile is private</Text>
                    </View>
                )}

                {/* Shelves */}
                {!editing && shelves.length > 0 && (
                    <View style={styles.shelvesSection}>
                        <Text style={styles.sectionTitle}>Shelves</Text>
                        {shelves.map((shelf) => (
                            <View key={shelf.id}>{renderShelfCard({ item: shelf })}</View>
                        ))}
                    </View>
                )}

                {!editing && !profile.isPrivate && shelves.length === 0 && (
                    <View style={styles.emptyState}>
                        <Ionicons name="library-outline" size={32} color={colors.textMuted} />
                        <Text style={styles.emptyStateText}>No visible shelves</Text>
                    </View>
                )}
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
            padding: spacing.lg,
        },
        content: {
            padding: spacing.md,
            paddingBottom: 40,
        },
        header: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: spacing.md,
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
        editButton: {
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
        profileSection: {
            alignItems: 'center',
            marginBottom: spacing.lg,
        },
        avatar: {
            width: 100,
            height: 100,
            borderRadius: 50,
            marginBottom: spacing.md,
        },
        avatarPlaceholder: {
            width: 100,
            height: 100,
            borderRadius: 50,
            backgroundColor: colors.primary,
            justifyContent: 'center',
            alignItems: 'center',
            marginBottom: spacing.md,
        },
        avatarText: {
            fontSize: 36,
            fontWeight: '600',
            color: colors.textInverted,
        },
        photoOverlay: {
            position: 'absolute',
            bottom: spacing.md,
            right: 0,
            width: 30,
            height: 30,
            borderRadius: 15,
            backgroundColor: colors.surface,
            justifyContent: 'center',
            alignItems: 'center',
            ...shadows.sm,
        },
        displayName: {
            fontSize: 24,
            fontWeight: '700',
            color: colors.text,
            marginBottom: spacing.xs,
        },
        editNameRow: {
            flexDirection: 'row',
            gap: spacing.sm,
            marginBottom: spacing.sm,
            width: '100%',
            paddingHorizontal: spacing.lg,
        },
        nameInput: {
            flex: 1,
            backgroundColor: colors.surface,
            borderRadius: radius.md,
            padding: spacing.sm,
            fontSize: 16,
            color: colors.text,
            textAlign: 'center',
        },
        username: {
            fontSize: 16,
            color: colors.textMuted,
            marginBottom: spacing.sm,
        },
        bioContainer: {
            width: '100%',
            paddingHorizontal: spacing.md,
            marginBottom: spacing.sm,
        },
        bioInput: {
            backgroundColor: colors.surface,
            borderRadius: radius.md,
            padding: spacing.sm,
            fontSize: 15,
            color: colors.text,
            minHeight: 80,
            textAlignVertical: 'top',
        },
        charCount: {
            fontSize: 12,
            color: colors.textMuted,
            textAlign: 'right',
            marginTop: 4,
        },
        bio: {
            fontSize: 15,
            color: colors.textSecondary,
            textAlign: 'center',
            paddingHorizontal: spacing.lg,
            marginBottom: spacing.sm,
        },
        addBioHint: {
            fontSize: 14,
            color: colors.primary,
            marginBottom: spacing.sm,
        },
        locationEditRow: {
            flexDirection: 'row',
            gap: spacing.xs,
            width: '100%',
            paddingHorizontal: spacing.md,
            marginBottom: spacing.sm,
        },
        locationInput: {
            flex: 1,
            backgroundColor: colors.surface,
            borderRadius: radius.md,
            padding: spacing.sm,
            fontSize: 14,
            color: colors.text,
            textAlign: 'center',
        },
        locationRow: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.xs,
            marginBottom: spacing.md,
        },
        locationText: {
            fontSize: 14,
            color: colors.textMuted,
        },
        privacyRow: {
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            width: '100%',
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
            backgroundColor: colors.surface,
            borderRadius: radius.md,
            marginBottom: spacing.md,
        },
        privacyLabel: {
            fontSize: 15,
            color: colors.text,
        },
        privacyHint: {
            fontSize: 12,
            color: colors.textMuted,
            marginTop: 2,
        },
        saveButton: {
            backgroundColor: colors.primary,
            paddingVertical: spacing.sm + 2,
            paddingHorizontal: spacing.xl,
            borderRadius: radius.md,
            marginTop: spacing.sm,
        },
        saveButtonDisabled: {
            opacity: 0.6,
        },
        saveButtonText: {
            color: colors.textInverted,
            fontWeight: '600',
            fontSize: 15,
        },
        statsRow: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.lg,
            marginBottom: spacing.md,
        },
        stat: {
            alignItems: 'center',
        },
        statNumber: {
            fontSize: 20,
            fontWeight: '700',
            color: colors.text,
        },
        statLabel: {
            fontSize: 13,
            color: colors.textMuted,
        },
        friendBadge: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.xs,
            backgroundColor: colors.success + '20',
            paddingHorizontal: spacing.sm,
            paddingVertical: spacing.xs,
            borderRadius: radius.full,
        },
        friendBadgeText: {
            fontSize: 13,
            color: colors.success,
            fontWeight: '500',
        },
        addFriendButton: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
            backgroundColor: colors.primary,
            paddingHorizontal: spacing.lg,
            paddingVertical: spacing.sm + 2,
            borderRadius: radius.md,
            marginTop: spacing.sm,
        },
        addFriendText: {
            fontSize: 15,
            fontWeight: '600',
            color: colors.textInverted,
        },
        removeFriendButton: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
            backgroundColor: colors.surface,
            paddingHorizontal: spacing.lg,
            paddingVertical: spacing.sm + 2,
            borderRadius: radius.md,
            marginTop: spacing.sm,
            borderWidth: 1,
            borderColor: colors.error,
        },
        removeFriendText: {
            fontSize: 15,
            fontWeight: '600',
            color: colors.error,
        },
        wishlistButton: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
            backgroundColor: colors.surface,
            paddingHorizontal: spacing.lg,
            paddingVertical: spacing.sm + 2,
            borderRadius: radius.md,
            marginTop: spacing.sm,
            borderWidth: 1,
            borderColor: colors.primary,
        },
        wishlistButtonText: {
            fontSize: 15,
            fontWeight: '600',
            color: colors.primary,
        },
        privateNotice: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: spacing.sm,
            backgroundColor: colors.surface,
            padding: spacing.md,
            borderRadius: radius.md,
            marginBottom: spacing.md,
        },
        privateNoticeText: {
            fontSize: 15,
            color: colors.textMuted,
        },
        shelvesSection: {
            marginTop: spacing.sm,
        },
        sectionTitle: {
            fontSize: 14,
            fontWeight: '600',
            color: colors.textMuted,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            marginBottom: spacing.sm,
        },
        shelfCard: {
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: colors.surface,
            padding: spacing.md,
            borderRadius: radius.md,
            marginBottom: spacing.sm,
            ...shadows.sm,
        },
        shelfIcon: {
            width: 44,
            height: 44,
            borderRadius: radius.md,
            backgroundColor: colors.primary + '20',
            justifyContent: 'center',
            alignItems: 'center',
            marginRight: spacing.md,
        },
        shelfInfo: {
            flex: 1,
        },
        shelfName: {
            fontSize: 16,
            fontWeight: '600',
            color: colors.text,
        },
        shelfMeta: {
            fontSize: 13,
            color: colors.textMuted,
            marginTop: 2,
        },
        emptyState: {
            alignItems: 'center',
            padding: spacing.xl,
        },
        emptyStateText: {
            fontSize: 15,
            color: colors.textMuted,
            marginTop: spacing.sm,
        },
        errorText: {
            fontSize: 16,
            color: colors.textMuted,
            textAlign: 'center',
            marginTop: spacing.sm,
        },
        retryButton: {
            backgroundColor: colors.primary,
            paddingHorizontal: spacing.lg,
            paddingVertical: spacing.sm,
            borderRadius: radius.md,
            marginTop: spacing.md,
        },
        retryButtonText: {
            color: colors.textInverted,
            fontWeight: '600',
        },
    });
