import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    InteractionManager,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { CommonActions, useFocusEffect } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { AuthContext } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { CachedImage, CategoryIcon } from '../components/ui';
import { apiRequest, getValidToken } from '../services/api';
import { clearShelvesListCache } from '../services/shelvesListCache';

const VISIBILITY_OPTIONS = [
    { value: 'private', label: 'Private', icon: 'lock-closed' },
    { value: 'friends', label: 'Friends', icon: 'people' },
    { value: 'public', label: 'Public', icon: 'globe' },
];

const GAME_PLATFORM_OPTIONS = [
    { value: '', label: 'No default' },
    { value: 'all', label: 'All' },
    { value: 'playstation', label: 'PlayStation' },
    { value: 'xbox', label: 'Xbox' },
    { value: 'nintendo', label: 'Nintendo' },
    { value: 'pc', label: 'PC' },
    { value: 'steam_deck', label: 'Steam Deck' },
    { value: 'custom', label: 'Custom' },
];

const GAME_FORMAT_OPTIONS = [
    { value: '', label: 'No default' },
    { value: 'physical', label: 'Physical' },
    { value: 'digital', label: 'Digital' },
];

function normalizeGameDefaults(value) {
    if (!value || typeof value !== 'object') return null;
    const platformType = String(value.platformType || '').trim().toLowerCase() || null;
    const customPlatformText = platformType === 'custom'
        ? String(value.customPlatformText || '').trim() || null
        : null;
    const formatRaw = String(value.format || '').trim().toLowerCase();
    const format = formatRaw === 'physical' || formatRaw === 'digital' ? formatRaw : null;
    if (!platformType && !customPlatformText && !format) return null;
    return { platformType, customPlatformText, format };
}

export default function ShelfEditScreen({ route, navigation }) {
    const { shelf: initialShelf } = route.params || {};
    const shelfId = initialShelf?.id || initialShelf?._id || route.params?.shelfId || route.params?.id;
    const { token, apiBase } = useContext(AuthContext);
    const { colors, spacing, typography, shadows, radius, isDark } = useTheme();

    // State
    const [shelf, setShelf] = useState(initialShelf || null);
    const [loading, setLoading] = useState(!initialShelf);
    const [name, setName] = useState(initialShelf?.name || '');
    const [description, setDescription] = useState(initialShelf?.description || '');
    const [visibility, setVisibility] = useState(initialShelf?.visibility || 'private');
    const [gamePlatformType, setGamePlatformType] = useState(initialShelf?.gameDefaults?.platformType || '');
    const [customPlatformText, setCustomPlatformText] = useState(initialShelf?.gameDefaults?.customPlatformText || '');
    const [gameFormat, setGameFormat] = useState(initialShelf?.gameDefaults?.format || '');
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [shelfPhotoBusy, setShelfPhotoBusy] = useState(false);
    const [shelfPhotoLoadFailed, setShelfPhotoLoadFailed] = useState(false);
    const [imageAuthToken, setImageAuthToken] = useState(null);
    const hasLoadedShelfRef = useRef(false);
    const shelfLoadInFlightRef = useRef(false);
    const isMountedRef = useRef(true);

    useEffect(() => {
        return () => {
            isMountedRef.current = false;
        };
    }, []);

    useEffect(() => {
        let isActive = true;
        if (!token) {
            setImageAuthToken(null);
            return () => { isActive = false; };
        }
        getValidToken(token)
            .then((resolved) => {
                if (isActive) setImageAuthToken(resolved || token);
            })
            .catch(() => {
                if (isActive) setImageAuthToken(token);
            });
        return () => { isActive = false; };
    }, [token]);

    const shelfType = String(shelf?.type || initialShelf?.type || '').toLowerCase();
    const isOtherShelf = shelfType === 'other';
    const isGamesShelf = shelfType === 'games';

    const styles = createStyles({ colors, spacing, typography, shadows, radius });

    const loadShelf = useCallback(async (options = {}) => {
        const { showBlockingLoader = false } = options;
        if (!shelfId) return;
        if (shelfLoadInFlightRef.current) return;
        shelfLoadInFlightRef.current = true;
        try {
            if (showBlockingLoader && isMountedRef.current) {
                setLoading(true);
            }
            const data = await apiRequest({
                apiBase,
                path: `/api/shelves/${shelfId}`,
                token,
            });
            if (!isMountedRef.current) return;
            const fetchedShelf = data.shelf || data;
            setShelf(fetchedShelf);
            setName(fetchedShelf?.name || '');
            setDescription(fetchedShelf?.description || '');
            setVisibility(fetchedShelf?.visibility || 'private');
            setGamePlatformType(fetchedShelf?.gameDefaults?.platformType || '');
            setCustomPlatformText(fetchedShelf?.gameDefaults?.customPlatformText || '');
            setGameFormat(fetchedShelf?.gameDefaults?.format || '');
            setShelfPhotoLoadFailed(false);
            hasLoadedShelfRef.current = true;
        } catch (e) {
            console.warn('Failed to load shelf:', e);
            Alert.alert('Error', 'Could not load shelf details');
        } finally {
            shelfLoadInFlightRef.current = false;
            if (isMountedRef.current) {
                setLoading(false);
            }
        }
    }, [apiBase, shelfId, token]);

    useEffect(() => {
        hasLoadedShelfRef.current = false;
        shelfLoadInFlightRef.current = false;
        if (!shelfId) return;

        if (initialShelf) {
            setShelf(initialShelf);
            setName(initialShelf?.name || '');
            setDescription(initialShelf?.description || '');
            setVisibility(initialShelf?.visibility || 'private');
            setGamePlatformType(initialShelf?.gameDefaults?.platformType || '');
            setCustomPlatformText(initialShelf?.gameDefaults?.customPlatformText || '');
            setGameFormat(initialShelf?.gameDefaults?.format || '');
            setShelfPhotoLoadFailed(false);
            setLoading(false);
        } else {
            setShelf(null);
            setName('');
            setDescription('');
            setVisibility('private');
            setGamePlatformType('');
            setCustomPlatformText('');
            setGameFormat('');
            setShelfPhotoLoadFailed(false);
            setLoading(true);
        }
    }, [shelfId, initialShelf]);

    // Initial load is blocking only when we do not already have shelf data.
    useEffect(() => {
        if (!shelfId) return;
        loadShelf({ showBlockingLoader: !initialShelf });
    }, [loadShelf, shelfId, initialShelf]);

    // Focus refresh is non-blocking (prevents swipe-back flicker/rebuild flash).
    useFocusEffect(
        useCallback(() => {
            if (!hasLoadedShelfRef.current) return undefined;
            const refreshTask = InteractionManager.runAfterInteractions(() => {
                loadShelf({ showBlockingLoader: false });
            });
            return () => {
                if (refreshTask?.cancel) refreshTask.cancel();
            };
        }, [loadShelf]),
    );

    const resolveApiUri = useCallback((value) => {
        if (!value) return null;
        if (/^https?:/i.test(value)) return value;
        if (!apiBase) return value.startsWith('/') ? value : `/${value}`;
        return `${apiBase.replace(/\/+$/, '')}${value.startsWith('/') ? '' : '/'}${value}`;
    }, [apiBase]);

    const withVersion = useCallback((uri, rawVersion) => {
        if (!uri) return null;
        const versionTs = rawVersion ? new Date(rawVersion).getTime() : NaN;
        if (!Number.isFinite(versionTs)) return uri;
        return `${uri}${uri.includes('?') ? '&' : '?'}v=${versionTs}`;
    }, []);

    const shelfPhotoHeaders = imageAuthToken
        ? {
            Authorization: `Bearer ${imageAuthToken}`,
            'ngrok-skip-browser-warning': 'true',
        }
        : null;
    const shelfPhotoSource = (() => {
        const shelfPhoto = shelf?.shelfPhoto;
        if (!shelfPhoto?.hasPhoto || !shelfPhoto?.imageUrl || !shelfPhotoHeaders || shelfPhotoLoadFailed) {
            return null;
        }
        const uri = withVersion(resolveApiUri(shelfPhoto.imageUrl), shelfPhoto.updatedAt || null);
        if (!uri) return null;
        return {
            uri,
            headers: shelfPhotoHeaders,
        };
    })();

    const buildShelfPhotoFilename = useCallback((asset) => {
        const uriName = String(asset?.uri || '').split('/').pop();
        if (uriName && uriName.includes('.')) return uriName;
        const mime = String(asset?.mimeType || '').toLowerCase();
        const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
        return `shelf-photo-${Date.now()}.${ext}`;
    }, []);

    const uploadShelfPhotoAsset = useCallback(async (asset) => {
        if (!asset?.uri || shelfPhotoBusy || !shelfId || !apiBase) return;
        setShelfPhotoBusy(true);
        try {
            const authToken = await getValidToken(token);
            if (!authToken) {
                throw new Error('Authentication required');
            }

            const formData = new FormData();
            formData.append('photo', {
                uri: asset.uri,
                name: buildShelfPhotoFilename(asset),
                type: asset.mimeType || 'image/jpeg',
            });

            const response = await fetch(`${apiBase}/api/shelves/${shelfId}/photo`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                    'ngrok-skip-browser-warning': 'true',
                },
                body: formData,
            });
            const raw = await response.text();
            let payload = {};
            try {
                payload = raw ? JSON.parse(raw) : {};
            } catch (_err) {
                payload = {};
            }

            if (!response.ok) {
                throw new Error(payload?.error || `HTTP ${response.status}`);
            }

            clearShelvesListCache();
            setShelfPhotoLoadFailed(false);
            await loadShelf({ showBlockingLoader: false });
        } catch (err) {
            Alert.alert('Error', err?.message || 'Failed to upload shelf photo');
        } finally {
            setShelfPhotoBusy(false);
        }
    }, [apiBase, buildShelfPhotoFilename, loadShelf, shelfId, shelfPhotoBusy, token]);

    const handleShelfPhotoUpload = useCallback(async () => {
        if (shelfPhotoBusy || saving || deleting) return;

        const cameraPermission = await ImagePicker.requestCameraPermissionsAsync();
        const libraryPermission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!cameraPermission.granted && !libraryPermission.granted) {
            Alert.alert('Permission required', 'Camera or photo library permission is required.');
            return;
        }

        let selectedSource = null;
        if (cameraPermission.granted && libraryPermission.granted) {
            selectedSource = await new Promise((resolve) => {
                Alert.alert('Shelf Photo', 'Choose photo source', [
                    { text: 'Take Photo', onPress: () => resolve('camera') },
                    { text: 'Choose from Library', onPress: () => resolve('library') },
                    { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
                ]);
            });
            if (!selectedSource) return;
        } else if (cameraPermission.granted) {
            selectedSource = 'camera';
        } else {
            selectedSource = 'library';
        }

        const pickerConfig = {
            quality: 0.8,
            mediaTypes: ['images'],
            allowsMultipleSelection: false,
            exif: false,
        };
        const result = selectedSource === 'camera'
            ? await ImagePicker.launchCameraAsync(pickerConfig)
            : await ImagePicker.launchImageLibraryAsync(pickerConfig);
        if (result.canceled) return;

        const asset = result.assets?.[0];
        if (!asset?.uri) {
            Alert.alert('Error', 'No photo selected');
            return;
        }
        await uploadShelfPhotoAsset(asset);
    }, [deleting, saving, shelfPhotoBusy, uploadShelfPhotoAsset]);

    const handleShelfPhotoDelete = useCallback(async () => {
        if (shelfPhotoBusy || saving || deleting || !shelf?.shelfPhoto?.hasPhoto || !shelfId) return;

        Alert.alert('Remove shelf photo', 'Remove this custom shelf photo?', [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Remove',
                style: 'destructive',
                onPress: async () => {
                    setShelfPhotoBusy(true);
                    try {
                        await apiRequest({
                            apiBase,
                            path: `/api/shelves/${shelfId}/photo`,
                            method: 'DELETE',
                            token,
                        });
                        clearShelvesListCache();
                        setShelfPhotoLoadFailed(false);
                        await loadShelf({ showBlockingLoader: false });
                    } catch (err) {
                        Alert.alert('Error', err?.message || 'Failed to remove shelf photo');
                    } finally {
                        setShelfPhotoBusy(false);
                    }
                },
            },
        ]);
    }, [apiBase, deleting, loadShelf, saving, shelf?.shelfPhoto?.hasPhoto, shelfId, shelfPhotoBusy, token]);

    const handleSave = useCallback(async () => {
        const trimmedName = name.trim();
        const trimmedDescription = description.trim();

        if (!trimmedName) {
            Alert.alert('Error', 'Shelf name is required');
            return;
        }
        if (isOtherShelf && !trimmedDescription) {
            Alert.alert('Error', 'Description is required for Other shelves');
            return;
        }
        if (isGamesShelf && gamePlatformType === 'custom' && !customPlatformText.trim()) {
            Alert.alert('Error', 'Custom platform text is required when Platform is Custom');
            return;
        }

        const nextGameDefaults = isGamesShelf
            ? normalizeGameDefaults({
                platformType: gamePlatformType || null,
                customPlatformText: gamePlatformType === 'custom' ? customPlatformText.trim() : null,
                format: gameFormat || null,
            })
            : null;
        const originalGameDefaults = normalizeGameDefaults(shelf?.gameDefaults);
        const defaultsChanged = isGamesShelf
            && JSON.stringify(originalGameDefaults) !== JSON.stringify(nextGameDefaults);

        const performSave = async () => {
            try {
                setSaving(true);
                await apiRequest({
                    apiBase,
                    path: `/api/shelves/${shelfId}`,
                    method: 'PUT',
                    token,
                    body: {
                        name: trimmedName,
                        description: trimmedDescription,
                        visibility,
                        ...(isGamesShelf ? { gameDefaults: nextGameDefaults } : {}),
                    },
                });
                navigation.goBack();
            } catch (e) {
                Alert.alert('Error', e.message);
            } finally {
                setSaving(false);
            }
        };

        if (defaultsChanged) {
            Alert.alert(
                'Update all shelf items?',
                'Changing Games defaults will overwrite platform and format values for existing items on this shelf.',
                [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Save', style: 'destructive', onPress: () => { performSave(); } },
                ],
            );
            return;
        }

        await performSave();
    }, [
        apiBase,
        shelfId,
        name,
        description,
        visibility,
        token,
        navigation,
        isOtherShelf,
        isGamesShelf,
        gamePlatformType,
        customPlatformText,
        gameFormat,
        shelf?.gameDefaults,
    ]);

    const routeBackToShelvesAfterDelete = useCallback(() => {
        let currentNavigation = navigation;
        while (currentNavigation) {
            const state = currentNavigation.getState?.();
            const routeNames = Array.isArray(state?.routeNames) ? state.routeNames : [];
            if (routeNames.includes('Main')) {
                currentNavigation.dispatch(
                    CommonActions.reset({
                        index: 0,
                        routes: [
                            {
                                name: 'Main',
                                params: {
                                    screen: 'Shelves',
                                    params: { screen: 'ShelvesHome' },
                                },
                            },
                        ],
                    }),
                );
                return;
            }
            currentNavigation = currentNavigation.getParent?.();
        }

        navigation.navigate('Main', {
            screen: 'Shelves',
            params: { screen: 'ShelvesHome' },
        });
    }, [navigation]);

    const handleDelete = useCallback(() => {
        Alert.alert(
            'Delete Shelf',
            `Are you sure you want to delete "${shelf?.name || name}"? This cannot be undone.`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            setDeleting(true);
                            await apiRequest({
                                apiBase,
                                path: `/api/shelves/${shelfId}`,
                                method: 'DELETE',
                                token,
                            });
                            routeBackToShelvesAfterDelete();
                        } catch (e) {
                            Alert.alert('Error', e.message);
                            setDeleting(false);
                        }
                    },
                },
            ]
        );
    }, [apiBase, shelfId, shelf, name, token, routeBackToShelvesAfterDelete]);

    if (loading) {
        return (
            <SafeAreaView style={[styles.screen, styles.centerContainer]} edges={['top']}>
                <ActivityIndicator size="large" color={colors.primary} />
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={styles.screen} edges={['top']}>
            <KeyboardAvoidingView
                style={styles.container}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
                <ScrollView style={styles.scrollContainer} contentContainerStyle={styles.content}>
                    {/* Header */}
                    <View style={styles.header}>
                        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
                            <Ionicons name="close" size={24} color={colors.text} />
                        </TouchableOpacity>
                        <Text style={styles.headerTitle}>Edit Shelf</Text>
                        <View style={{ width: 40 }} />
                    </View>

                    <View style={styles.shelfPhotoCard}>
                        <View style={styles.shelfPhotoMedia}>
                            {shelfPhotoSource ? (
                                <CachedImage
                                    source={shelfPhotoSource}
                                    style={styles.shelfPhotoImage}
                                    contentFit="cover"
                                    onError={() => setShelfPhotoLoadFailed(true)}
                                />
                            ) : (
                                <View style={styles.shelfPhotoFallback}>
                                    <CategoryIcon type={shelfType || 'item'} size={28} />
                                </View>
                            )}
                        </View>
                        <View style={styles.shelfPhotoContent}>
                            <Text style={styles.shelfPhotoTitle}>Shelf Photo</Text>
                            <Text style={styles.shelfPhotoSubtitle}>
                                {shelf?.shelfPhoto?.hasPhoto
                                    ? 'Custom photo is visible on your shelves.'
                                    : 'Add a custom image to represent this shelf.'}
                            </Text>
                            <View style={styles.shelfPhotoActions}>
                                <TouchableOpacity
                                    style={[styles.shelfPhotoButton, shelfPhotoBusy && styles.shelfPhotoButtonDisabled]}
                                    onPress={handleShelfPhotoUpload}
                                    disabled={shelfPhotoBusy || saving || deleting}
                                >
                                    {shelfPhotoBusy ? (
                                        <ActivityIndicator size="small" color={colors.primary} />
                                    ) : (
                                        <>
                                            <Ionicons name="image-outline" size={16} color={colors.primary} />
                                            <Text style={styles.shelfPhotoButtonText}>
                                                {shelf?.shelfPhoto?.hasPhoto ? 'Replace' : 'Upload'}
                                            </Text>
                                        </>
                                    )}
                                </TouchableOpacity>
                                {shelf?.shelfPhoto?.hasPhoto ? (
                                    <TouchableOpacity
                                        style={[styles.shelfPhotoRemoveButton, shelfPhotoBusy && styles.shelfPhotoButtonDisabled]}
                                        onPress={handleShelfPhotoDelete}
                                        disabled={shelfPhotoBusy || saving || deleting}
                                    >
                                        <Ionicons name="trash-outline" size={16} color={colors.error} />
                                        <Text style={styles.shelfPhotoRemoveText}>Remove</Text>
                                    </TouchableOpacity>
                                ) : null}
                            </View>
                        </View>
                    </View>

                    {/* Name */}
                    <View style={styles.inputGroup}>
                        <Text style={styles.label}>Name</Text>
                        <TextInput
                            style={styles.input}
                            value={name}
                            onChangeText={setName}
                            placeholder="Shelf name"
                            placeholderTextColor={colors.textMuted}
                            editable={!saving && !deleting && !shelfPhotoBusy}
                        />
                    </View>

                    {/* Description */}
                    <View style={styles.inputGroup}>
                        <Text style={styles.label}>
                            Description {isOtherShelf ? '(required for Other shelves)' : '(optional)'}
                        </Text>
                        <TextInput
                            style={[styles.input, styles.textArea]}
                            value={description}
                            onChangeText={setDescription}
                            placeholder={isOtherShelf ? 'Describe what this Other shelf contains' : 'Optional description'}
                            placeholderTextColor={colors.textMuted}
                            editable={!saving && !deleting && !shelfPhotoBusy}
                            multiline
                            numberOfLines={3}
                            textAlignVertical="top"
                        />
                    </View>

                    {/* Visibility */}
                    <View style={styles.inputGroup}>
                        <Text style={styles.label}>Visibility</Text>
                        <View style={styles.visibilityRow}>
                            {VISIBILITY_OPTIONS.map(opt => (
                                <TouchableOpacity
                                    key={opt.value}
                                    style={[styles.visibilityOption, visibility === opt.value && styles.visibilityActive]}
                                    onPress={() => setVisibility(opt.value)}
                                    disabled={saving || deleting || shelfPhotoBusy}
                                >
                                    <Ionicons
                                        name={opt.icon}
                                        size={20}
                                        color={visibility === opt.value ? colors.primary : colors.textMuted}
                                    />
                                    <Text style={[styles.visibilityText, visibility === opt.value && styles.visibilityTextActive]}>
                                        {opt.label}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </View>
                    </View>

                    {isGamesShelf ? (
                        <View style={styles.defaultsCard}>
                            <Text style={styles.label}>Games Defaults</Text>
                            <Text style={styles.helperText}>Used to fill your collection automatically.</Text>

                            <View style={styles.defaultsSection}>
                                <Text style={styles.subLabel}>Platform Type (optional)</Text>
                                <View style={styles.optionRow}>
                                    {GAME_PLATFORM_OPTIONS.map((option) => {
                                        const selected = gamePlatformType === option.value;
                                        return (
                                            <TouchableOpacity
                                                key={option.value || 'none'}
                                                style={[styles.optionChip, selected && styles.optionChipActive]}
                                                onPress={() => setGamePlatformType(option.value)}
                                                disabled={saving || deleting || shelfPhotoBusy}
                                            >
                                                <Text style={[styles.optionChipText, selected && styles.optionChipTextActive]}>
                                                    {option.label}
                                                </Text>
                                            </TouchableOpacity>
                                        );
                                    })}
                                </View>
                                {gamePlatformType === 'custom' ? (
                                    <TextInput
                                        style={[styles.input, styles.inlineInput]}
                                        value={customPlatformText}
                                        onChangeText={setCustomPlatformText}
                                        placeholder="Enter custom platform"
                                        placeholderTextColor={colors.textMuted}
                                        editable={!saving && !deleting && !shelfPhotoBusy}
                                    />
                                ) : null}
                            </View>

                            <View style={styles.defaultsSection}>
                                <Text style={styles.subLabel}>Format Type (optional)</Text>
                                <View style={styles.optionRow}>
                                    {GAME_FORMAT_OPTIONS.map((option) => {
                                        const selected = gameFormat === option.value;
                                        return (
                                            <TouchableOpacity
                                                key={option.value || 'none'}
                                                style={[styles.optionChip, selected && styles.optionChipActive]}
                                                onPress={() => setGameFormat(option.value)}
                                                disabled={saving || deleting || shelfPhotoBusy}
                                            >
                                                <Text style={[styles.optionChipText, selected && styles.optionChipTextActive]}>
                                                    {option.label}
                                                </Text>
                                            </TouchableOpacity>
                                        );
                                    })}
                                </View>
                            </View>
                        </View>
                    ) : null}

                    {/* Shelf Info */}
                    <View style={styles.infoCard}>
                        <View style={styles.infoRow}>
                            <Text style={styles.infoLabel}>Type</Text>
                            <Text style={styles.infoValue}>{shelf?.type || 'Collection'}</Text>
                        </View>
                        <View style={styles.infoRow}>
                            <Text style={styles.infoLabel}>Items</Text>
                            <Text style={styles.infoValue}>{shelf?.itemCount ?? shelf?.items?.length ?? 0}</Text>
                        </View>
                        <View style={[styles.infoRow, { borderBottomWidth: 0 }]}>
                            <Text style={styles.infoLabel}>Created</Text>
                            <Text style={styles.infoValue}>
                                {shelf?.createdAt ? new Date(shelf.createdAt).toLocaleDateString() : '—'}
                            </Text>
                        </View>
                    </View>

                    {/* Delete */}
                    <TouchableOpacity
                        style={styles.deleteButton}
                        onPress={handleDelete}
                        disabled={deleting || saving || shelfPhotoBusy}
                    >
                        <Ionicons name="trash-outline" size={18} color={colors.error} />
                        <Text style={styles.deleteText}>{deleting ? 'Deleting...' : 'Delete Shelf'}</Text>
                    </TouchableOpacity>
                </ScrollView>

                {/* Save Button */}
                <View style={styles.footer}>
                    <TouchableOpacity
                        style={[styles.saveButton, (saving || deleting || shelfPhotoBusy) && styles.saveButtonDisabled]}
                        onPress={handleSave}
                        disabled={saving || deleting || shelfPhotoBusy}
                    >
                        <Text style={styles.saveButtonText}>{saving ? 'Saving...' : 'Save Changes'}</Text>
                    </TouchableOpacity>
                </View>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const createStyles = ({ colors, spacing, typography, shadows, radius }) => StyleSheet.create({
    screen: {
        flex: 1,
        backgroundColor: colors.background,
    },
    centerContainer: {
        justifyContent: 'center',
        alignItems: 'center',
    },
    container: {
        flex: 1,
    },
    scrollContainer: {
        flex: 1,
    },
    content: {
        padding: spacing.md,
        paddingBottom: 100,
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
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: colors.text,
    },
    shelfPhotoCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.surface,
        marginBottom: spacing.lg,
        borderRadius: radius.lg,
        padding: spacing.md,
        gap: spacing.md,
        ...shadows.sm,
    },
    shelfPhotoMedia: {
        width: 84,
        height: 84,
        borderRadius: radius.md,
        overflow: 'hidden',
        backgroundColor: colors.surfaceElevated,
    },
    shelfPhotoImage: {
        width: '100%',
        height: '100%',
    },
    shelfPhotoFallback: {
        width: '100%',
        height: '100%',
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: colors.primary + '12',
    },
    shelfPhotoContent: {
        flex: 1,
    },
    shelfPhotoTitle: {
        fontSize: 15,
        fontWeight: '600',
        color: colors.text,
    },
    shelfPhotoSubtitle: {
        fontSize: 13,
        color: colors.textMuted,
        marginTop: 2,
    },
    shelfPhotoActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        marginTop: spacing.sm,
    },
    shelfPhotoButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        borderWidth: 1,
        borderColor: colors.primary + '55',
        backgroundColor: colors.primary + '10',
        borderRadius: radius.full,
        paddingHorizontal: spacing.sm,
        paddingVertical: 6,
    },
    shelfPhotoButtonText: {
        fontSize: 12,
        color: colors.primary,
        fontWeight: '600',
    },
    shelfPhotoRemoveButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        borderWidth: 1,
        borderColor: colors.error + '55',
        backgroundColor: colors.error + '10',
        borderRadius: radius.full,
        paddingHorizontal: spacing.sm,
        paddingVertical: 6,
    },
    shelfPhotoRemoveText: {
        fontSize: 12,
        color: colors.error,
        fontWeight: '600',
    },
    shelfPhotoButtonDisabled: {
        opacity: 0.55,
    },
    inputGroup: {
        marginBottom: spacing.lg,
    },
    label: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.text,
        marginBottom: spacing.sm,
    },
    helperText: {
        fontSize: 13,
        color: colors.textMuted,
        marginBottom: spacing.sm,
    },
    input: {
        backgroundColor: colors.surface,
        borderRadius: radius.lg,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.md,
        fontSize: 16,
        color: colors.text,
        ...shadows.sm,
    },
    textArea: {
        minHeight: 80,
        paddingTop: spacing.md,
    },
    visibilityRow: {
        flexDirection: 'row',
        gap: spacing.sm,
    },
    visibilityOption: {
        flex: 1,
        alignItems: 'center',
        paddingVertical: spacing.md,
        backgroundColor: colors.surface,
        borderRadius: radius.lg,
        borderWidth: 2,
        borderColor: 'transparent',
        ...shadows.sm,
    },
    visibilityActive: {
        borderColor: colors.primary,
        backgroundColor: colors.primary + '10',
    },
    visibilityText: {
        fontSize: 13,
        color: colors.textMuted,
        marginTop: 4,
    },
    visibilityTextActive: {
        color: colors.primary,
        fontWeight: '500',
    },
    defaultsCard: {
        marginBottom: spacing.lg,
        backgroundColor: colors.surface,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: colors.border,
        padding: spacing.md,
        ...shadows.sm,
    },
    defaultsSection: {
        marginTop: spacing.sm,
    },
    subLabel: {
        fontSize: 13,
        color: colors.textSecondary,
        marginBottom: spacing.xs,
    },
    optionRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: spacing.xs,
    },
    optionChip: {
        paddingHorizontal: spacing.sm,
        paddingVertical: 6,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.background,
    },
    optionChipActive: {
        backgroundColor: colors.primary + '18',
        borderColor: colors.primary,
    },
    optionChipText: {
        fontSize: 12,
        color: colors.textSecondary,
    },
    optionChipTextActive: {
        color: colors.primary,
        fontWeight: '600',
    },
    inlineInput: {
        marginTop: spacing.sm,
    },
    infoCard: {
        backgroundColor: colors.surface,
        borderRadius: radius.lg,
        padding: spacing.md,
        marginBottom: spacing.lg,
        ...shadows.sm,
    },
    infoRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingVertical: spacing.sm,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    infoLabel: {
        fontSize: 14,
        color: colors.textMuted,
    },
    infoValue: {
        fontSize: 14,
        fontWeight: '500',
        color: colors.text,
    },
    deleteButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.sm,
        paddingVertical: spacing.md,
    },
    deleteText: {
        fontSize: 15,
        color: colors.error,
        fontWeight: '500',
    },
    footer: {
        padding: spacing.md,
        backgroundColor: colors.background,
        borderTopWidth: 1,
        borderTopColor: colors.border,
    },
    saveButton: {
        backgroundColor: colors.primary,
        paddingVertical: spacing.md,
        borderRadius: radius.lg,
        alignItems: 'center',
        ...shadows.md,
    },
    saveButtonDisabled: {
        opacity: 0.6,
    },
    saveButtonText: {
        color: colors.textInverted,
        fontSize: 16,
        fontWeight: '600',
    },
});
