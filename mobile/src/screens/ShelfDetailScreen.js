import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Image,
    InteractionManager,
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
import { useFocusEffect } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { AuthContext } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { apiRequest, getValidToken } from '../services/api';
import { shareEntityLink } from '../services/shareLinks';
import { resolveCollectableCoverUrl, resolveManualCoverUrl } from '../utils/coverUrl';
import { extractTextFromImage, parseTextToItems } from '../services/ocr';
import { CachedImage, StarRating, CategoryIcon } from '../components/ui';
import VisionProcessingModal from '../components/VisionProcessingModal';
import { useVisionProcessing } from '../hooks/useVisionProcessing';
import { normalizeSearchText } from '../utils/searchNormalization';

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
const PERSISTENT_TAB_FOOTER_SPACER = 88;

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

function formatItemCount(count) {
    return `${count} item${count === 1 ? '' : 's'}`;
}

function buildStandardVisionSummaryMessage({
    addedCount = 0,
    existingCount = 0,
    needsReviewCount = 0,
    extractedCount = 0,
} = {}) {
    if (needsReviewCount > 0) {
        if (addedCount > 0 && existingCount > 0) {
            return `${formatItemCount(addedCount)} added. ${formatItemCount(existingCount)} already on your shelf. ${formatItemCount(needsReviewCount)} need review.`;
        }
        if (addedCount > 0) {
            return `${formatItemCount(addedCount)} added. ${formatItemCount(needsReviewCount)} need review.`;
        }
        if (existingCount > 0) {
            return `No new items added. ${formatItemCount(existingCount)} already on your shelf. ${formatItemCount(needsReviewCount)} need review.`;
        }
        return `${formatItemCount(needsReviewCount)} need review.`;
    }

    if (addedCount > 0) {
        if (existingCount > 0) {
            return `${formatItemCount(addedCount)} added. ${formatItemCount(existingCount)} already on your shelf.`;
        }
        return `${formatItemCount(addedCount)} added to your shelf.`;
    }

    if (existingCount > 0) {
        return `No new items added. ${formatItemCount(existingCount)} already on your shelf.`;
    }

    if (extractedCount > 0) {
        return `${formatItemCount(extractedCount)} detected, but no new items were added.`;
    }

    return 'No items were detected.';
}

function buildVisionSummaryMessage({
    addedCount = 0,
    existingCount = 0,
    needsReviewCount = 0,
    extractedCount = 0,
    cached = false,
} = {}) {
    const standard = buildStandardVisionSummaryMessage({
        addedCount,
        existingCount,
        needsReviewCount,
        extractedCount,
    });

    if (!cached) return standard;
    return `Same photo detected. This image was already scanned recently. Previous result: ${standard}`;
}

export default function ShelfDetailScreen({ route, navigation }) {
    const { id, title, readOnly: readOnlyParam, autoAddItem } = route.params || {};
    const { token, apiBase, premiumEnabled, user } = useContext(AuthContext);
    const { colors, spacing, typography, shadows, radius, isDark } = useTheme();

    const [shelf, setShelf] = useState(null);
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [visionLoading, setVisionLoading] = useState(false);
    const [visionModalVisible, setVisionModalVisible] = useState(false);
    const [sortKey, setSortKey] = useState('date_desc');
    const [sortOpen, setSortOpen] = useState(false);
    const [shareBusy, setShareBusy] = useState(false);
    const autoAddHandledRef = useRef(false);
    const isMountedRef = useRef(true);
    const loadingMoreRef = useRef(false);
    const hasLoadedShelfRef = useRef(false);
    const shelfLoadInFlightRef = useRef(false);

    // Pagination state
    const [hasMore, setHasMore] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [totalItems, setTotalItems] = useState(0);
    const [imageAuthToken, setImageAuthToken] = useState(null);
    const [ownerPhotoSourceFailures, setOwnerPhotoSourceFailures] = useState({});

    // Favorites state
    const [favorites, setFavorites] = useState({}); // Map of collectableId -> isFavorite

    const styles = useMemo(() => createStyles({ colors, spacing, typography, shadows, radius }), [colors, spacing, typography, shadows, radius]);
    const shelfType = shelf?.type || route?.params?.type || '';
    const isReadOnly = !!(readOnlyParam || (shelf?.ownerId && user?.id && shelf.ownerId !== user.id));
    const isInsideBottomTab = useMemo(() => {
        let parent = navigation?.getParent?.();
        while (parent) {
            const parentState = parent.getState?.();
            if (parentState?.type === 'tab') return true;
            parent = parent.getParent?.();
        }
        return false;
    }, [navigation]);
    const bottomFooterSpacer = isInsideBottomTab ? PERSISTENT_TAB_FOOTER_SPACER : 0;

    useEffect(() => {
        return () => {
            isMountedRef.current = false;
        };
    }, []);

    useEffect(() => {
        hasLoadedShelfRef.current = false;
        shelfLoadInFlightRef.current = false;
        setShelf(null);
        setItems([]);
        setFavorites({});
        setHasMore(false);
        setTotalItems(0);
        setOwnerPhotoSourceFailures({});
        setLoading(true);
        setRefreshing(false);
    }, [id]);

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

    const loadShelf = useCallback(async (options = {}) => {
        const { showBlockingLoader = false } = options;
        if (shelfLoadInFlightRef.current) return;
        shelfLoadInFlightRef.current = true;
        try {
            if (showBlockingLoader && isMountedRef.current) setLoading(true);
            const resolvedImageToken = token ? await getValidToken(token) : null;
            if (isMountedRef.current) {
                setImageAuthToken(resolvedImageToken || token || null);
            }
            const [shelfData, itemsData] = await Promise.all([
                apiRequest({ apiBase, path: `/api/shelves/${id}`, token }),
                apiRequest({ apiBase, path: `/api/shelves/${id}/items?limit=25&skip=0`, token }),
            ]);
            if (!isMountedRef.current) return;
            setShelf(shelfData.shelf);
            const loadedItems = Array.isArray(itemsData.items) ? itemsData.items : [];
            setItems(loadedItems);
            setOwnerPhotoSourceFailures({});
            // Track pagination state from response
            if (itemsData.pagination) {
                setHasMore(itemsData.pagination.hasMore || false);
                setTotalItems(itemsData.pagination.total || loadedItems.length);
            } else {
                setHasMore(false);
                setTotalItems(loadedItems.length);
            }

            // Load favorites status for collectables
            const collectableIds = loadedItems
                .filter(item => item.collectable?.id)
                .map(item => item.collectable.id);
            if (collectableIds.length > 0) {
                try {
                    const favData = await apiRequest({
                        apiBase,
                        path: '/api/favorites/check-batch',
                        method: 'POST',
                        token,
                        body: { collectableIds },
                    });
                    if (isMountedRef.current) {
                        setFavorites(favData.status || {});
                    }
                } catch (e) {
                    console.warn('Failed to load favorites:', e);
                }
            }
            hasLoadedShelfRef.current = true;
        } catch (e) {
            console.warn('Failed to load shelf:', e);
        } finally {
            shelfLoadInFlightRef.current = false;
            if (isMountedRef.current) {
                setLoading(false);
                setRefreshing(false);
            }
        }
    }, [apiBase, id, token]);

    const loadMore = useCallback(async () => {
        if (loadingMoreRef.current || !hasMore) return;
        loadingMoreRef.current = true;
        setLoadingMore(true);
        try {
            const skip = items.length;
            const itemsData = await apiRequest({
                apiBase,
                path: `/api/shelves/${id}/items?limit=25&skip=${skip}`,
                token,
            });
            if (!isMountedRef.current) return;
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
            loadingMoreRef.current = false;
            if (isMountedRef.current) {
                setLoadingMore(false);
            }
        }
    }, [apiBase, id, token, items.length, hasMore]);

    useEffect(() => {
        loadShelf({ showBlockingLoader: true });
    }, [loadShelf]);

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

    const onRefresh = () => {
        setRefreshing(true);
        loadShelf({ showBlockingLoader: false });
    };

    const isWithinHoursWindow = useCallback((value, hours) => {
        if (!value || !Number.isFinite(hours) || hours <= 0) return false;
        const timestamp = Date.parse(String(value));
        if (!Number.isFinite(timestamp)) return false;
        return (Date.now() - timestamp) <= (hours * 60 * 60 * 1000);
    }, []);

    const performDeleteItem = useCallback(async (itemId) => {
        try {
            await apiRequest({ apiBase, path: `/api/shelves/${id}/items/${itemId}`, method: 'DELETE', token });
            setItems(prev => prev.filter(i => i.id !== itemId));
        } catch (e) {
            Alert.alert('Error', e.message);
        }
    }, [apiBase, id, token]);

    const confirmDeleteItem = useCallback((shelfItem) => {
        if (!shelfItem?.id) return;
        Alert.alert('Remove Item', 'Remove this item from the shelf?', [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Remove',
                style: 'destructive',
                onPress: () => performDeleteItem(shelfItem.id),
            },
        ]);
    }, [performDeleteItem]);

    const openReplacementSearch = useCallback(async (shelfItem, triggerSource) => {
        try {
            const response = await apiRequest({
                apiBase,
                path: `/api/shelves/${id}/items/${shelfItem.id}/replacement-intent`,
                method: 'POST',
                token,
                body: { triggerSource },
            });

            const traceId = response?.traceId || response?.trace?.id;
            if (!traceId) {
                throw new Error('Replacement intent was not created.');
            }

            const collectable = shelfItem?.collectable || {};
            const manual = shelfItem?.manual || {};
            const prefillTitle = collectable?.title || manual?.title || manual?.name || '';
            const prefillAuthor = collectable?.primaryCreator || manual?.author || '';
            const prefillType = manual?.type || collectable?.kind || shelfType || '';
            const prefillPlatform = shelfItem?.format || manual?.format || '';
            const prefillDescription = collectable?.description || manual?.description || '';

            navigation.navigate('ItemSearch', {
                shelfId: id,
                shelfType,
                replaceContext: {
                    traceId,
                    sourceItemId: shelfItem.id,
                    triggerSource,
                    sourceCollectableId: collectable?.id || shelfItem?.collectableId || null,
                    sourceManualId: manual?.id || shelfItem?.manualId || null,
                    prefillTitle,
                    prefillAuthor,
                    prefillType,
                    prefillPlatform,
                    prefillDescription,
                },
            });
        } catch (e) {
            Alert.alert('Error', e.message || 'Failed to start replacement');
        }
    }, [apiBase, id, navigation, shelfType, token]);

    const handleDeleteItem = useCallback((shelfItem) => {
        if (isReadOnly) return;
        if (!shelfItem?.id) return;

        const showReplacePrompt = isWithinHoursWindow(shelfItem.createdAt, 24);
        if (showReplacePrompt) {
            Alert.alert(
                'Replace or Delete',
                'Do you want to replace this item with the correct match, or delete it?',
                [
                    { text: 'Replace', onPress: () => openReplacementSearch(shelfItem, 'shelf_delete_modal') },
                    { text: 'Delete', style: 'destructive', onPress: () => confirmDeleteItem(shelfItem) },
                    { text: 'Cancel', style: 'cancel' },
                ],
            );
            return;
        }

        confirmDeleteItem(shelfItem);
    }, [confirmDeleteItem, isReadOnly, isWithinHoursWindow, openReplacementSearch]);

    const handleRateItem = useCallback(async (itemId, collectableId, manualId, rating) => {
        if (isReadOnly) return;
        // Need either collectableId or manualId
        if (!collectableId && !manualId) return;

        // Optimistic update
        setItems(prev => prev.map(item =>
            item.id === itemId ? { ...item, rating } : item
        ));

        try {
            const isManual = !!manualId;
            const targetId = isManual ? manualId : collectableId;
            const queryParam = isManual ? '?type=manual' : '';

            await apiRequest({
                apiBase,
                path: `/api/ratings/${targetId}${queryParam}`,
                method: 'PUT',
                token,
                body: { rating },
            });
        } catch (e) {
            // Revert on error
            console.warn('Failed to update rating:', e);
            Alert.alert('Error', 'Failed to update rating');
            loadShelf(); // Reload to get current state
        }
    }, [apiBase, token, isReadOnly, loadShelf]);

    const handleToggleFavorite = useCallback(async (collectableId) => {
        if (!collectableId) return;

        const currentlyFavorited = favorites[collectableId];

        // Optimistic update
        setFavorites(prev => ({
            ...prev,
            [collectableId]: !currentlyFavorited,
        }));

        try {
            if (currentlyFavorited) {
                await apiRequest({
                    apiBase,
                    path: `/api/favorites/${collectableId}`,
                    method: 'DELETE',
                    token,
                });
            } else {
                await apiRequest({
                    apiBase,
                    path: '/api/favorites',
                    method: 'POST',
                    token,
                    body: { collectableId },
                });
            }
        } catch (e) {
            // Revert on error
            console.warn('Failed to toggle favorite:', e);
            setFavorites(prev => ({
                ...prev,
                [collectableId]: currentlyFavorited,
            }));
            Alert.alert('Error', 'Failed to update favorite');
        }
    }, [apiBase, token, favorites]);


    const visibleItems = useMemo(() => {
        const query = normalizeSearchText(searchQuery);
        const base = query
            ? items.filter(item => {
                const title = item.collectable?.title || item.manual?.title || item.title || '';
                return normalizeSearchText(title).includes(query);
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
        const config = require('../utils/iconConfig').getIconConfig(type);
        return config.icon;
    };

    const resolveApiUri = (value) => {
        if (!value) return null;
        if (/^https?:/i.test(value)) return value;
        if (!apiBase) return value.startsWith('/') ? value : `/${value}`;
        return `${apiBase.replace(/\/+$/, '')}${value.startsWith('/') ? '' : '/'}${value}`;
    };

    const withVersion = (uri, rawVersion) => {
        if (!uri) return null;
        const versionTs = rawVersion ? new Date(rawVersion).getTime() : NaN;
        if (!Number.isFinite(versionTs)) return uri;
        return `${uri}${uri.includes('?') ? '&' : '?'}v=${versionTs}`;
    };

    const ownerPhotoHeaders = imageAuthToken
        ? {
            Authorization: `Bearer ${imageAuthToken}`,
            'ngrok-skip-browser-warning': 'true',
        }
        : null;

    // Provider-agnostic cover resolution using shared utilities
    const resolveCoverSource = (item) => {
        const collectable = item.collectable || item.collectableSnapshot;
        const manual = item.manual || item.manualSnapshot;
        const ownerPhoto = item.ownerPhoto || null;
        const manualType = String(manual?.type || '').toLowerCase();
        const ownerFailureState = ownerPhotoSourceFailures[item.id] || null;
        const coverUri = (
            resolveCollectableCoverUrl(collectable, apiBase) ||
            resolveManualCoverUrl(manual, apiBase) ||
            null
        );
        const fallback = coverUri ? { source: { uri: coverUri }, kind: 'fallback' } : null;

        // For manual "other" items, prefer persisted owner-photo thumbnail in list cards.
        // Cache-bust with thumbnail update timestamp so edits appear immediately after save.
        if (manualType === 'other' && ownerPhotoHeaders) {
            if (ownerFailureState !== 'thumb_failed' && ownerFailureState !== 'image_failed' && ownerPhoto?.thumbnailImageUrl) {
                const thumbUri = resolveApiUri(ownerPhoto.thumbnailImageUrl);
                const thumbVersion = ownerPhoto.thumbnailUpdatedAt || ownerPhoto.updatedAt || null;
                const versionedThumb = withVersion(thumbUri, thumbVersion);
                if (versionedThumb) {
                    return {
                        source: {
                            uri: versionedThumb,
                            headers: ownerPhotoHeaders,
                        },
                        kind: 'owner_thumb',
                    };
                }
            }
            if (ownerFailureState !== 'image_failed' && ownerPhoto?.imageUrl) {
                const ownerUri = resolveApiUri(ownerPhoto.imageUrl);
                const ownerVersion = ownerPhoto.updatedAt || null;
                const versionedOwner = withVersion(ownerUri, ownerVersion);
                if (versionedOwner) {
                    return {
                        source: {
                            uri: versionedOwner,
                            headers: ownerPhotoHeaders,
                        },
                        kind: 'owner_image',
                    };
                }
            }
        }

        return fallback;
    };

    const renderItem = ({ item }) => {
        const info = getItemInfo(item);
        const coverEntry = resolveCoverSource(item);
        const coverSource = coverEntry?.source || null;
        const collectableId = item.collectable?.id || item.collectableId;
        const manualId = item.manual?.id || item.manualId;
        const isFavorited = collectableId ? favorites[collectableId] : false;

        return (
            <TouchableOpacity
                style={styles.itemCard}
                onPress={() => navigation.navigate('CollectableDetail', {
                    item,
                    shelfId: id,
                    readOnly: isReadOnly,
                    ownerId: shelf?.ownerId,
                    ownerUsername: shelf?.ownerUsername || null,
                })}
                activeOpacity={0.7}
            >
                <View style={styles.itemCover}>
                    {coverSource ? (
                        <CachedImage
                            source={coverSource}
                            style={styles.itemCoverImage}
                            contentFit="cover"
                            onError={() => {
                                if (coverEntry?.kind === 'owner_thumb') {
                                    setOwnerPhotoSourceFailures((prev) => ({ ...prev, [item.id]: 'thumb_failed' }));
                                    return;
                                }
                                if (coverEntry?.kind === 'owner_image') {
                                    setOwnerPhotoSourceFailures((prev) => ({ ...prev, [item.id]: 'image_failed' }));
                                }
                            }}
                        />
                    ) : (
                        <View style={styles.itemCoverFallback}>
                            <CategoryIcon type={info.type} size={22} />
                        </View>
                    )}
                </View>
                <View style={styles.itemContent}>
                    <Text style={styles.itemTitle} numberOfLines={1}>{info.title}</Text>
                    {info.subtitle ? <Text style={styles.itemSubtitle} numberOfLines={1}>{info.subtitle}</Text> : null}
                    <View style={styles.itemRatingRow}>
                        <StarRating
                            rating={item.rating || 0}
                            size={16}
                            onRatingChange={!isReadOnly ? (newRating) => handleRateItem(item.id, collectableId, manualId, newRating) : undefined}
                            disabled={isReadOnly}
                        />
                    </View>
                </View>
                <View style={styles.itemActions}>
                    {collectableId && !isReadOnly ? (
                        <TouchableOpacity
                            onPress={() => handleToggleFavorite(collectableId)}
                            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                            style={styles.favoriteButton}
                        >
                            <Ionicons
                                name={isFavorited ? 'heart' : 'heart-outline'}
                                size={20}
                                color={isFavorited ? colors.error : colors.textMuted}
                            />
                        </TouchableOpacity>
                    ) : null}
                    {!isReadOnly ? (
                        <TouchableOpacity onPress={() => handleDeleteItem(item)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                            <Ionicons name="close" size={18} color={colors.textMuted} />
                        </TouchableOpacity>
                    ) : null}
                </View>
            </TouchableOpacity>
        );
    };

    const renderEmpty = () => (
        <View style={styles.emptyState}>
            <Ionicons name="cube-outline" size={56} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>No items yet</Text>
            <Text style={styles.emptyText}>{isReadOnly ? 'No items are visible yet.' : 'Add items to this shelf using the camera or search'}</Text>
        </View>
    );

    // Vision processing state
    const [visionProgress, setVisionProgress] = useState(0);
    const [visionMessage, setVisionMessage] = useState('');
    const [visionStatus, setVisionStatus] = useState(null);
    const [currentJobId, setCurrentJobId] = useState(null);
    const pollIntervalRef = React.useRef(null);

    // Poll for vision job status
    const pollVisionStatus = useCallback(async (jobId) => {
        setCurrentJobId(jobId);

        const poll = async () => {
            try {
                const response = await apiRequest({
                    apiBase,
                    path: `/api/shelves/${id}/vision/${jobId}/status`,
                    token,
                });

                setVisionProgress(response.progress || 0);
                setVisionMessage(response.message || '');
                setVisionStatus(response.status);

                if (response.status === 'completed') {
                    clearInterval(pollIntervalRef.current);
                    pollIntervalRef.current = null;
                    setVisionLoading(false);

                    // Reload items
                    if (response.items) {
                        setItems(response.items);
                    } else {
                        loadShelf();
                    }

                    const addedCount = response.result?.addedCount || 0;
                    const needsReviewCount = response.result?.needsReviewCount || 0;
                    const existingCount = response.result?.existingCount || response.result?.results?.existing || 0;
                    const extractedCount = response.result?.extractedCount || response.result?.results?.extracted || 0;
                    const isCachedResult = !!(response?.cached || response.result?.cached);
                    const summaryMessage =
                        response.result?.summaryMessage ||
                        buildVisionSummaryMessage({
                            addedCount,
                            existingCount,
                            needsReviewCount,
                            extractedCount,
                            cached: isCachedResult,
                        });

                    if (needsReviewCount > 0) {
                        setTimeout(() => setVisionModalVisible(false), 1000);
                        setTimeout(() => {
                            Alert.alert(
                                'Scan Complete',
                                summaryMessage,
                                [
                                    { text: 'Later', style: 'cancel' },
                                    { text: 'Review Now', onPress: () => navigation.navigate('Unmatched') },
                                ]
                            );
                        }, 1200);
                    } else {
                        setTimeout(() => setVisionModalVisible(false), 1000);
                        Alert.alert('Scan Complete', summaryMessage);
                    }
                } else if (response.status === 'failed' || response.status === 'aborted') {
                    clearInterval(pollIntervalRef.current);
                    pollIntervalRef.current = null;
                    setVisionLoading(false);
                    setVisionModalVisible(false);

                    if (response.status !== 'aborted') {
                        Alert.alert('Error', response.message || 'Vision processing failed');
                    }
                }
            } catch (err) {
                console.warn('Polling error:', err);
            }
        };

        // Start polling
        poll();
        pollIntervalRef.current = setInterval(poll, 2000);
    }, [apiBase, id, token, navigation, loadShelf]);

    // Cancel vision processing
    const handleCancelVision = useCallback(async () => {
        if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
        }

        if (currentJobId) {
            try {
                await apiRequest({
                    apiBase,
                    path: `/api/shelves/${id}/vision/${currentJobId}`,
                    method: 'DELETE',
                    token,
                });
            } catch (err) {
                console.warn('Failed to abort job:', err);
            }
        }

        setVisionLoading(false);
        setVisionModalVisible(false);
        setCurrentJobId(null);
    }, [apiBase, id, token, currentJobId]);

    // Hide modal but continue processing
    const handleHideToBackground = useCallback(() => {
        setVisionModalVisible(false);
    }, []);

    // Cleanup on unmount
    React.useEffect(() => {
        return () => {
            if (pollIntervalRef.current) {
                clearInterval(pollIntervalRef.current);
            }
        };
    }, []);

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
                        async: true,
                    },
                });

                // If async mode, show modal and poll for status
                if (data.jobId) {
                    setVisionModalVisible(true);
                    pollVisionStatus(data.jobId);
                    return;
                }

                // Synchronous fallback
                if (Array.isArray(data?.items)) {
                    setItems(data.items);
                }
                const summaryMessage =
                    data?.summaryMessage ||
                    buildVisionSummaryMessage({
                        addedCount: data?.addedCount || 0,
                        existingCount: data?.existingCount || 0,
                        needsReviewCount: data?.needsReviewCount || 0,
                        extractedCount: data?.extractedCount || data?.analysis?.items?.length || 0,
                        cached: !!data?.cached,
                    });
                Alert.alert('Scan Complete', summaryMessage);
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
            } else {
                loadShelf();
            }
            const addedCount = data?.addedCount || 0;
            const needsReviewCount = data?.needsReviewCount || 0;
            const existingCount = data?.existingCount || 0;
            const extractedCount = data?.extractedCount || 0;
            const summaryMessage = data?.summaryMessage || buildVisionSummaryMessage({
                addedCount,
                existingCount,
                needsReviewCount,
                extractedCount,
            });

            if (needsReviewCount > 0) {
                Alert.alert(
                    'Scan Complete',
                    summaryMessage,
                    [
                        { text: 'Later', style: 'cancel' },
                        { text: 'Review Now', onPress: () => navigation.navigate('Unmatched') },
                    ]
                );
            } else if (addedCount > 0) {
                Alert.alert('Scan Complete', summaryMessage);
            } else {
                Alert.alert('Scan Complete', summaryMessage);
            }
        } catch (e) {
            const requiresPremium = e?.data?.requiresPremium;
            const quotaExceeded = e?.data?.quotaExceeded;

            if (quotaExceeded) {
                // Show alert and auto-fallback to MLKit
                Alert.alert(
                    'Quota Exceeded',
                    'Monthly Vision scan quota exceeded. Using on-device scanning instead.',
                    [{ text: 'OK' }]
                );

                // Perform MLKit fallback scan
                try {
                    const { text } = await extractTextFromImage(asset.uri);
                    if (!text || text.trim().length < 5) {
                        Alert.alert('No text found', 'Try a clearer photo.');
                        return;
                    }

                    const parsedItems = parseTextToItems(text, shelfType);
                    if (!parsedItems.length) {
                        Alert.alert('No items detected', 'Try a clearer photo.');
                        return;
                    }

                    const fallbackData = await apiRequest({
                        apiBase,
                        path: `/api/shelves/${id}/catalog-lookup`,
                        method: 'POST',
                        token,
                        body: { items: parsedItems, autoApply: true },
                    });

                    if (Array.isArray(fallbackData?.items)) {
                        setItems(fallbackData.items);
                    } else {
                        loadShelf();
                    }
                    const addedCount = fallbackData?.addedCount || 0;
                    const needsReviewCount = fallbackData?.needsReviewCount || 0;
                    const existingCount = fallbackData?.existingCount || 0;
                    const extractedCount = fallbackData?.extractedCount || 0;
                    const summaryMessage = fallbackData?.summaryMessage || buildVisionSummaryMessage({
                        addedCount,
                        existingCount,
                        needsReviewCount,
                        extractedCount,
                    });

                    if (needsReviewCount > 0) {
                        Alert.alert(
                            'Scan Complete',
                            summaryMessage,
                            [
                                { text: 'Later', style: 'cancel' },
                                { text: 'Review Now', onPress: () => navigation.navigate('Unmatched') },
                            ]
                        );
                    } else if (addedCount > 0) {
                        Alert.alert('Scan Complete', summaryMessage);
                    } else {
                        Alert.alert('Scan Complete', summaryMessage);
                    }
                } catch (fallbackErr) {
                    Alert.alert('Error', fallbackErr.message || 'On-device scan failed');
                }
                return;
            }

            const message = requiresPremium
                ? 'Premium is required for cloud vision scanning.'
                : (e.message || 'Scan failed');
            Alert.alert('Error', message);
        } finally {
            setVisionLoading(false);
        }
    }, [apiBase, id, loadShelf, navigation, premiumEnabled, shelfType, token, visionLoading]);

    const handleOpenSearch = useCallback(() => {
        if (isReadOnly) return;
        navigation.navigate('ItemSearch', { shelfId: id, shelfType });
    }, [navigation, id, shelfType, isReadOnly]);

    const handleAddItem = useCallback(() => {
        if (isReadOnly) return;
        Alert.alert('Add Item', 'Scan with camera or search catalog', [
            { text: 'Camera', onPress: handleCameraScan },
            { text: 'Search', onPress: handleOpenSearch },
            { text: 'Cancel', style: 'cancel' },
        ]);
    }, [handleCameraScan, handleOpenSearch, isReadOnly]);

    const handleShareShelf = useCallback(async () => {
        const shelfId = shelf?.id || id;
        if (!shelfId || shareBusy) return;
        setShareBusy(true);
        try {
            await shareEntityLink({
                apiBase,
                kind: 'shelves',
                id: shelfId,
                title: shelf?.name || title || 'Shelf',
                slugSource: shelf?.name || title || `shelf-${shelfId}`,
            });
        } catch (_err) {
            Alert.alert('Unable to share', 'Please try again.');
        } finally {
            setShareBusy(false);
        }
    }, [apiBase, id, shareBusy, shelf?.id, shelf?.name, title]);

    useEffect(() => {
        if (!autoAddItem || autoAddHandledRef.current) return;
        autoAddHandledRef.current = true;
        handleAddItem();
        navigation.setParams({ autoAddItem: false });
    }, [autoAddItem, handleAddItem, navigation]);

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
                <View style={styles.headerActions}>
                    <TouchableOpacity
                        onPress={handleShareShelf}
                        style={styles.editButton}
                        disabled={shareBusy || !(shelf?.id || id)}
                    >
                        {shareBusy ? (
                            <ActivityIndicator size="small" color={colors.text} />
                        ) : (
                            <Ionicons name="share-social-outline" size={20} color={colors.text} />
                        )}
                    </TouchableOpacity>
                    {!isReadOnly ? (
                        <TouchableOpacity onPress={() => navigation.navigate('ShelfEdit', { shelf })} style={styles.editButton}>
                            <Ionicons name="settings-outline" size={22} color={colors.text} />
                        </TouchableOpacity>
                    ) : null}
                </View>
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
                contentContainerStyle={[
                    styles.listContent,
                    bottomFooterSpacer > 0 ? { paddingBottom: 100 + bottomFooterSpacer } : null,
                ]}
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
            {!isReadOnly ? (
                <TouchableOpacity
                    style={[
                        styles.fab,
                        bottomFooterSpacer > 0 ? { bottom: spacing.xs + bottomFooterSpacer / 2 } : null,
                        visionLoading && styles.fabDisabled,
                    ]}
                    onPress={handleAddItem}
                    disabled={visionLoading}
                >
                    {visionLoading ? (
                        <ActivityIndicator size="small" color={colors.textInverted} />
                    ) : (
                        <Text style={styles.fabText}>Add</Text>
                    )}
                </TouchableOpacity>
            ) : null}

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

            {/* Vision Processing Modal */}
            <VisionProcessingModal
                visible={visionModalVisible}
                progress={visionProgress}
                message={visionMessage}
                status={visionStatus}
                onCancel={handleCancelVision}
                onHideBackground={handleHideToBackground}
            />
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
    headerActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
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
    itemRatingRow: {
        marginTop: 4,
    },
    itemActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    favoriteButton: {
        padding: 2,
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
        bottom: spacing.md,
        paddingHorizontal: 24,
        paddingVertical: 12,
        borderRadius: radius.full,
        backgroundColor: colors.success,
        justifyContent: 'center',
        alignItems: 'center',
        ...shadows.lg,
    },
    fabText: {
        color: colors.textInverted,
        fontSize: 16,
        fontWeight: '600',
        fontFamily: typography.semibold,
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
