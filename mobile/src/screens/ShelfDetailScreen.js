import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Image,
    Modal,
    RefreshControl,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
    StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { AuthContext } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { apiRequest } from '../services/api';
import { extractTextFromImage, parseTextToItems } from '../services/ocr';

const CAMERA_QUALITY = 0.6;
const SUPPORTED_VISION_MIME_TYPES = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/bmp',
    'image/tiff',
]);

const SORT_OPTIONS = [
    { key: 'title_asc', label: 'Title A-Z' },
    { key: 'title_desc', label: 'Title Z-A' },
    { key: 'creator_asc', label: 'Author/Creator A-Z' },
    { key: 'creator_desc', label: 'Author/Creator Z-A' },
    { key: 'year_desc', label: 'Year' },
    { key: 'date_desc', label: 'Date Added to Collection' },
];

function normalizeImageMime(mimeType) {
    if (!mimeType) return null;
    const normalized = String(mimeType).toLowerCase();
    return normalized === 'image/jpg' ? 'image/jpeg' : normalized;
}

function extractInlineBase64(input) {
    if (!input || typeof input !== 'string') return null;
    const match = input.match(/^data:(image\/[a-z0-9.+-]+);base64,(.*)$/i);
    if (!match) return null;
    return { mime: normalizeImageMime(match[1]), base64: match[2] };
}

async function getBase64Payload(asset) {
    if (!asset?.uri) return null;
    const inline = extractInlineBase64(asset.base64);
    const rawBase64 = inline?.base64 || asset.base64 || null;
    const rawMime = inline?.mime || normalizeImageMime(asset.mimeType);
    const hasSupportedMime = rawMime && SUPPORTED_VISION_MIME_TYPES.has(rawMime);

    if (rawBase64 && hasSupportedMime) {
        return { base64: rawBase64.replace(/\s+/g, ''), mime: rawMime };
    }
    try {
        const processed = await ImageManipulator.manipulateAsync(
            asset.uri,
            [],
            { compress: CAMERA_QUALITY, format: ImageManipulator.SaveFormat.JPEG, base64: true }
        );
        if (!processed?.base64) return null;
        return { base64: processed.base64, mime: 'image/jpeg' };
    } catch (e) {
        console.warn('Failed to prepare image payload', e);
        if (rawBase64) {
            return { base64: rawBase64.replace(/\s+/g, ''), mime: rawMime || 'image/jpeg' };
        }
        return null;
    }
}

export default function ShelfDetailScreen({ route, navigation }) {
    const { id, title } = route.params || {};
    const { token, apiBase, premiumEnabled } = useContext(AuthContext);
    const { colors, spacing, typography, shadows, radius, isDark } = useTheme();

    const [shelf, setShelf] = useState(null);
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [visionLoading, setVisionLoading] = useState(false);
    const [sortKey, setSortKey] = useState('date_desc');
    const [sortOpen, setSortOpen] = useState(false);

    // Pagination state
    const [hasMore, setHasMore] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [totalItems, setTotalItems] = useState(0);

    const styles = useMemo(() => createStyles({ colors, spacing, typography, shadows, radius }), [colors, spacing, typography, shadows, radius]);
    const shelfType = shelf?.type || route?.params?.type || '';

    const loadShelf = useCallback(async () => {
        try {
            if (!refreshing) setLoading(true);
            const [shelfData, itemsData] = await Promise.all([
                apiRequest({ apiBase, path: `/api/shelves/${id}`, token }),
                apiRequest({ apiBase, path: `/api/shelves/${id}/items?limit=25&skip=0`, token }),
            ]);
            setShelf(shelfData.shelf);
            const loadedItems = Array.isArray(itemsData.items) ? itemsData.items : [];
            setItems(loadedItems);
            // Track pagination state from response
            if (itemsData.pagination) {
                setHasMore(itemsData.pagination.hasMore || false);
                setTotalItems(itemsData.pagination.total || loadedItems.length);
            } else {
                setHasMore(false);
                setTotalItems(loadedItems.length);
            }
        } catch (e) {
            console.warn('Failed to load shelf:', e);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [apiBase, id, token, refreshing]);

    const loadMore = useCallback(async () => {
        if (loadingMore || !hasMore) return;
        setLoadingMore(true);
        try {
            const skip = items.length;
            const itemsData = await apiRequest({
                apiBase,
                path: `/api/shelves/${id}/items?limit=25&skip=${skip}`,
                token,
            });
            const newItems = Array.isArray(itemsData.items) ? itemsData.items : [];
            setItems(prev => [...prev, ...newItems]);
            if (itemsData.pagination) {
                setHasMore(itemsData.pagination.hasMore || false);
            } else {
                setHasMore(false);
            }
        } catch (e) {
            console.warn('Failed to load more items:', e);
        } finally {
            setLoadingMore(false);
        }
    }, [apiBase, id, token, items.length, loadingMore, hasMore]);

    useEffect(() => { loadShelf(); }, [loadShelf]);

    useEffect(() => {
        const unsubscribe = navigation.addListener('focus', loadShelf);
        return unsubscribe;
    }, [navigation, loadShelf]);

    const onRefresh = () => {
        setRefreshing(true);
        loadShelf();
    };

    const handleDeleteItem = useCallback(async (itemId) => {
        Alert.alert('Remove Item', 'Remove this item from the shelf?', [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Remove',
                style: 'destructive',
                onPress: async () => {
                    try {
                        await apiRequest({ apiBase, path: `/api/shelves/${id}/items/${itemId}`, method: 'DELETE', token });
                        setItems(prev => prev.filter(i => i.id !== itemId));
                    } catch (e) {
                        Alert.alert('Error', e.message);
                    }
                },
            },
        ]);
    }, [apiBase, id, token]);

    const visibleItems = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();
        const base = query
            ? items.filter(item => {
                const title = item.collectable?.title || item.manual?.title || item.title || '';
                return title.toLowerCase().includes(query);
            })
            : [...items];

        const normalizeText = (value) => String(value || '').trim();
        const compareText = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
        const parseYear = (value) => {
            if (!value) return null;
            const match = String(value).match(/\b(\d{4})\b/);
            return match ? parseInt(match[1], 10) : null;
        };

        const getTitle = (item) => normalizeText(item.collectable?.title || item.manual?.title || item.title);
        const getCreator = (item) => normalizeText(item.collectable?.author || item.collectable?.primaryCreator || item.manual?.author);
        const getYear = (item) => parseYear(item.collectable?.year || item.manual?.year || item.collectable?.publishYear || item.collectable?.releaseYear);
        const getCreatedAt = (item) => {
            const raw = item.createdAt || item.created_at;
            const value = raw ? new Date(raw).getTime() : 0;
            return Number.isFinite(value) ? value : 0;
        };

        const compareNullableText = (a, b, direction = 1) => {
            if (!a && !b) return 0;
            if (!a) return 1;
            if (!b) return -1;
            return compareText(a, b) * direction;
        };

        const compareWithFallback = (primary, secondary, direction = 1) => {
            const first = compareNullableText(primary, secondary, direction);
            if (first !== 0) return first;
            return 0;
        };

        base.sort((a, b) => {
            const titleA = getTitle(a);
            const titleB = getTitle(b);
            const creatorA = getCreator(a);
            const creatorB = getCreator(b);

            switch (sortKey) {
                case 'title_asc':
                    return compareWithFallback(titleA, titleB, 1);
                case 'title_desc':
                    return compareWithFallback(titleA, titleB, -1);
                case 'creator_asc': {
                    const primary = compareNullableText(creatorA, creatorB, 1);
                    return primary !== 0 ? primary : compareNullableText(titleA, titleB, 1);
                }
                case 'creator_desc': {
                    const primary = compareNullableText(creatorA, creatorB, -1);
                    return primary !== 0 ? primary : compareNullableText(titleA, titleB, -1);
                }
                case 'year_desc': {
                    const yearA = getYear(a);
                    const yearB = getYear(b);
                    if (yearA == null && yearB == null) {
                        return compareNullableText(titleA, titleB, 1);
                    }
                    if (yearA == null) return 1;
                    if (yearB == null) return -1;
                    return yearB - yearA;
                }
                case 'date_desc': {
                    const dateA = getCreatedAt(a);
                    const dateB = getCreatedAt(b);
                    if (dateA === dateB) {
                        return compareNullableText(titleA, titleB, 1);
                    }
                    return dateB - dateA;
                }
                default:
                    return compareNullableText(titleA, titleB, 1);
            }
        });

        return base;
    }, [items, searchQuery, sortKey]);

    const getItemInfo = (item) => {
        const collectable = item.collectable || item.collectableSnapshot;
        const manual = item.manual || item.manualSnapshot;
        return {
            title: collectable?.title || manual?.title || item.title || 'Untitled',
            subtitle: collectable?.author || collectable?.primaryCreator || manual?.author || collectable?.publisher || '',
            type: collectable?.type || collectable?.kind || manual?.type || 'item',
        };
    };

    const getIconForType = (type) => {
        switch (type?.toLowerCase()) {
            case 'book': return 'book';
            case 'movie': return 'film';
            case 'game': return 'game-controller';
            case 'music': case 'album': return 'musical-notes';
            default: return 'cube';
        }
    };

    const resolveCoverPath = (item) => {
        const collectable = item.collectable || item.collectableSnapshot;
        if (!collectable) return null;

        // Prefer locally cached media path
        if (collectable.coverMediaPath) {
            return collectable.coverMediaPath;
        }

        // Check images array for cached paths
        const images = Array.isArray(collectable.images) ? collectable.images : [];
        for (const image of images) {
            const cached = image?.cachedSmallPath || image?.cachedPath;
            if (typeof cached === 'string' && cached.trim()) {
                return cached.trim();
            }
        }

        // Fall back to cover URL
        if (collectable.coverUrl) {
            return collectable.coverUrl;
        }

        // Check images array for URLs
        for (const image of images) {
            const url = image?.urlSmall || image?.urlMedium || image?.urlLarge;
            if (typeof url === 'string' && url.trim()) {
                return url.trim();
            }
        }

        return null;
    };

    const buildCoverUri = (pathOrUrl) => {
        if (!pathOrUrl) return null;
        // If it's already an http URL, use it directly
        if (/^https?:/i.test(pathOrUrl)) {
            return pathOrUrl;
        }
        // Build URI from local path via media endpoint
        const trimmed = pathOrUrl.replace(/^\/+/, '');
        const resource = trimmed.startsWith('media/') ? trimmed : `media/${trimmed}`;
        if (!apiBase) {
            return `/${resource}`;
        }
        const normalizedBase = apiBase.replace(/\/+$/, '');
        return `${normalizedBase}/${resource}`;
    };

    const renderItem = ({ item }) => {
        const info = getItemInfo(item);
        const coverPath = resolveCoverPath(item);
        const coverUri = buildCoverUri(coverPath);

        return (
            <TouchableOpacity
                style={styles.itemCard}
                onPress={() => navigation.navigate('CollectableDetail', { item, shelfId: id })}
                activeOpacity={0.7}
            >
                <View style={styles.itemCover}>
                    {coverUri ? (
                        <Image
                            source={{ uri: coverUri }}
                            style={styles.itemCoverImage}
                            resizeMode="cover"
                        />
                    ) : (
                        <View style={styles.itemCoverFallback}>
                            <Ionicons name={getIconForType(info.type)} size={22} color={colors.primary} />
                        </View>
                    )}
                </View>
                <View style={styles.itemContent}>
                    <Text style={styles.itemTitle} numberOfLines={1}>{info.title}</Text>
                    {info.subtitle ? <Text style={styles.itemSubtitle} numberOfLines={1}>{info.subtitle}</Text> : null}
                </View>
                <TouchableOpacity onPress={() => handleDeleteItem(item.id)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                    <Ionicons name="close" size={18} color={colors.textMuted} />
                </TouchableOpacity>
            </TouchableOpacity>
        );
    };

    const renderEmpty = () => (
        <View style={styles.emptyState}>
            <Ionicons name="cube-outline" size={56} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>No items yet</Text>
            <Text style={styles.emptyText}>Add items to this shelf using the camera or search</Text>
        </View>
    );

    const handleCameraScan = useCallback(async () => {
        if (!id || visionLoading) return;

        const cameraPermission = await ImagePicker.requestCameraPermissionsAsync();
        const libraryPermission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!cameraPermission.granted && !libraryPermission.granted) {
            Alert.alert('Permission required', 'Camera or photo library permission is required to scan items.');
            return;
        }

        let selectedSource = null;
        if (cameraPermission.granted && libraryPermission.granted) {
            selectedSource = await new Promise((resolve) => {
                Alert.alert('Add Photo', 'Choose how you want to add a photo', [
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
            base64: true,
            quality: CAMERA_QUALITY,
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
            Alert.alert('Error', 'No photo captured.');
            return;
        }

        setVisionLoading(true);
        try {
            if (premiumEnabled) {
                const payload = await getBase64Payload(asset);
                if (!payload?.base64) {
                    Alert.alert('Error', 'Unable to read the captured photo.');
                    return;
                }

                const data = await apiRequest({
                    apiBase,
                    path: `/api/shelves/${id}/vision`,
                    method: 'POST',
                    token,
                    body: {
                        imageBase64: `data:${payload.mime};base64,${payload.base64}`,
                    },
                });

                if (Array.isArray(data?.items)) {
                    setItems(data.items);
                }
                const detected = data?.analysis?.items?.length || 0;
                Alert.alert('Scan complete', detected ? `Detected ${detected} items.` : 'No items detected.');
                return;
            }

            const { text } = await extractTextFromImage(asset.uri);
            if (!text || text.trim().length < 5) {
                Alert.alert('No text found', 'Try a clearer photo or enable premium scanning.');
                return;
            }

            const parsedItems = parseTextToItems(text, shelfType);
            if (!parsedItems.length) {
                Alert.alert('No items detected', 'Try a clearer photo.');
                return;
            }

            const data = await apiRequest({
                apiBase,
                path: `/api/shelves/${id}/catalog-lookup`,
                method: 'POST',
                token,
                body: { items: parsedItems, autoApply: true },
            });

            if (Array.isArray(data?.items)) {
                setItems(data.items);
            }
            const detected = data?.analysis?.items?.length || parsedItems.length;
            Alert.alert('Scan complete', `Detected ${detected} items.`);
        } catch (e) {
            const requiresPremium = e?.data?.requiresPremium;
            const message = requiresPremium
                ? 'Premium is required for cloud vision scanning.'
                : (e.message || 'Scan failed');
            Alert.alert('Error', message);
        } finally {
            setVisionLoading(false);
        }
    }, [apiBase, id, premiumEnabled, shelfType, token, visionLoading]);

    const handleOpenSearch = useCallback(() => {
        navigation.navigate('ItemSearch', { shelfId: id, shelfType });
    }, [navigation, id, shelfType]);

    const handleAddItem = useCallback(() => {
        Alert.alert('Add Item', 'Scan with camera or search catalog', [
            { text: 'Camera', onPress: handleCameraScan },
            { text: 'Search', onPress: handleOpenSearch },
            { text: 'Cancel', style: 'cancel' },
        ]);
    }, [handleCameraScan, handleOpenSearch]);

    const sortLabel = useMemo(() => {
        const match = SORT_OPTIONS.find(option => option.key === sortKey);
        return match ? match.label : 'Sort';
    }, [sortKey]);

    if (loading && !refreshing) {
        return (
            <View style={[styles.screen, styles.centerContainer]}>
                <ActivityIndicator size="large" color={colors.primary} />
            </View>
        );
    }

    return (
        <SafeAreaView style={styles.screen} edges={['top']}>
            <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />

            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
                    <Ionicons name="arrow-back" size={22} color={colors.text} />
                </TouchableOpacity>
                <View style={styles.headerCenter}>
                    <Text style={styles.headerTitle} numberOfLines={1}>{shelf?.name || title || 'Shelf'}</Text>
                    <Text style={styles.headerSubtitle}>{totalItems} item{totalItems !== 1 ? 's' : ''}{hasMore ? ` (${items.length} loaded)` : ''}</Text>
                </View>
                <TouchableOpacity onPress={() => navigation.navigate('ShelfEdit', { shelf })} style={styles.editButton}>
                    <Ionicons name="settings-outline" size={22} color={colors.text} />
                </TouchableOpacity>
            </View>

            {/* Search + Sort */}
            <View style={[styles.controlsRow, items.length > 5 ? null : styles.controlsRowRight]}>
                {items.length > 5 && (
                    <View style={styles.searchBox}>
                        <Ionicons name="search" size={18} color={colors.textMuted} />
                        <TextInput
                            style={styles.searchInput}
                            placeholder="Search items..."
                            placeholderTextColor={colors.textMuted}
                            value={searchQuery}
                            onChangeText={setSearchQuery}
                        />
                    </View>
                )}
                <TouchableOpacity
                    style={styles.sortButton}
                    onPress={() => setSortOpen(true)}
                    accessibilityLabel="Sort items"
                >
                    <Ionicons name="swap-vertical" size={16} color={colors.textMuted} />
                    <Text style={styles.sortButtonText} numberOfLines={1}>{sortLabel}</Text>
                </TouchableOpacity>
            </View>

            {/* Items List */}
            <FlatList
                data={visibleItems}
                keyExtractor={(item) => String(item.id)}
                renderItem={renderItem}
                contentContainerStyle={styles.listContent}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={onRefresh}
                        tintColor={colors.primary}
                        colors={[colors.primary]}
                    />
                }
                ListEmptyComponent={renderEmpty}
                showsVerticalScrollIndicator={false}
                onEndReached={loadMore}
                onEndReachedThreshold={0.3}
                ListFooterComponent={
                    loadingMore ? (
                        <View style={styles.loadingMore}>
                            <ActivityIndicator size="small" color={colors.primary} />
                            <Text style={styles.loadingMoreText}>Loading more items...</Text>
                        </View>
                    ) : null
                }
            />

            {/* FAB for adding items */}
            <TouchableOpacity
                style={[styles.fab, visionLoading && styles.fabDisabled]}
                onPress={handleAddItem}
                disabled={visionLoading}
            >
                {visionLoading ? (
                    <ActivityIndicator size="small" color={colors.textInverted} />
                ) : (
                    <Ionicons name="add" size={28} color={colors.textInverted} />
                )}
            </TouchableOpacity>

            <Modal
                visible={sortOpen}
                transparent
                animationType="fade"
                onRequestClose={() => setSortOpen(false)}
            >
                <TouchableOpacity
                    style={styles.modalOverlay}
                    activeOpacity={1}
                    onPress={() => setSortOpen(false)}
                >
                    <TouchableOpacity activeOpacity={1} style={styles.sortModal}>
                        <Text style={styles.sortModalTitle}>Sort by</Text>
                        {SORT_OPTIONS.map(option => {
                            const isSelected = option.key === sortKey;
                            return (
                                <TouchableOpacity
                                    key={option.key}
                                    style={[styles.sortOption, isSelected && styles.sortOptionSelected]}
                                    onPress={() => {
                                        setSortKey(option.key);
                                        setSortOpen(false);
                                    }}
                                >
                                    <Text style={[styles.sortOptionText, isSelected && styles.sortOptionTextSelected]}>
                                        {option.label}
                                    </Text>
                                    {isSelected ? <Ionicons name="checkmark" size={18} color={colors.primary} /> : null}
                                </TouchableOpacity>
                            );
                        })}
                        <TouchableOpacity
                            style={styles.sortCancel}
                            onPress={() => setSortOpen(false)}
                        >
                            <Text style={styles.sortCancelText}>Cancel</Text>
                        </TouchableOpacity>
                    </TouchableOpacity>
                </TouchableOpacity>
            </Modal>
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
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: spacing.md,
        paddingTop: spacing.lg,
        paddingBottom: spacing.md,
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
    headerCenter: {
        flex: 1,
        alignItems: 'center',
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: colors.text,
    },
    headerSubtitle: {
        fontSize: 13,
        color: colors.textMuted,
        marginTop: 2,
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
    controlsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        paddingHorizontal: spacing.md,
        paddingBottom: spacing.sm,
    },
    controlsRowRight: {
        justifyContent: 'flex-end',
    },
    searchBox: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.surface,
        borderRadius: radius.lg,
        paddingHorizontal: spacing.md,
        height: 40,
        gap: spacing.sm,
        ...shadows.sm,
        flex: 1,
    },
    searchInput: {
        flex: 1,
        fontSize: 14,
        color: colors.text,
    },
    sortButton: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.surface,
        borderRadius: radius.lg,
        paddingHorizontal: spacing.md,
        height: 40,
        gap: spacing.xs,
        ...shadows.sm,
        maxWidth: 220,
    },
    sortButtonText: {
        fontSize: 12,
        color: colors.textMuted,
    },
    listContent: {
        padding: spacing.md,
        paddingBottom: 100,
    },
    itemCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.surface,
        borderRadius: radius.lg,
        padding: spacing.md,
        marginBottom: spacing.sm,
        ...shadows.sm,
    },
    itemCover: {
        width: 48,
        height: 64,
        borderRadius: radius.md,
        overflow: 'hidden',
        marginRight: spacing.md,
        backgroundColor: colors.surface,
    },
    itemCoverImage: {
        width: '100%',
        height: '100%',
    },
    itemCoverFallback: {
        width: '100%',
        height: '100%',
        backgroundColor: colors.primary + '15',
        justifyContent: 'center',
        alignItems: 'center',
    },
    itemContent: {
        flex: 1,
    },
    itemTitle: {
        fontSize: 15,
        fontWeight: '500',
        color: colors.text,
    },
    itemSubtitle: {
        fontSize: 13,
        color: colors.textMuted,
        marginTop: 2,
    },
    emptyState: {
        alignItems: 'center',
        paddingTop: spacing['2xl'],
        paddingHorizontal: spacing.xl,
    },
    emptyTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: colors.text,
        marginTop: spacing.md,
    },
    emptyText: {
        fontSize: 14,
        color: colors.textMuted,
        textAlign: 'center',
        marginTop: spacing.xs,
    },
    loadingMore: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: spacing.md,
        gap: spacing.sm,
    },
    loadingMoreText: {
        fontSize: 13,
        color: colors.textMuted,
    },
    fab: {
        position: 'absolute',
        right: spacing.md,
        bottom: spacing.xl,
        width: 56,
        height: 56,
        borderRadius: 28,
        backgroundColor: colors.primary,
        justifyContent: 'center',
        alignItems: 'center',
        ...shadows.lg,
    },
    fabDisabled: {
        opacity: 0.6,
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.4)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: spacing.md,
    },
    sortModal: {
        width: '100%',
        maxWidth: 360,
        backgroundColor: colors.surface,
        borderRadius: radius.lg,
        padding: spacing.md,
        ...shadows.lg,
    },
    sortModalTitle: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.textMuted,
        marginBottom: spacing.sm,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    sortOption: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.sm,
        borderRadius: radius.md,
    },
    sortOptionSelected: {
        backgroundColor: colors.primary + '15',
    },
    sortOptionText: {
        fontSize: 15,
        color: colors.text,
    },
    sortOptionTextSelected: {
        color: colors.primary,
        fontWeight: '600',
    },
    sortCancel: {
        marginTop: spacing.sm,
        paddingVertical: spacing.sm,
        alignItems: 'center',
        borderTopWidth: 1,
        borderTopColor: colors.border,
    },
    sortCancelText: {
        fontSize: 14,
        color: colors.textMuted,
    },
});
