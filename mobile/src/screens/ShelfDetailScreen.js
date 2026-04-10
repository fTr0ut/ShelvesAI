import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    AppState,
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
    Dimensions,
    ImageBackground,
    Pressable
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { LinearGradient } from 'expo-linear-gradient';
import { Accelerometer } from 'expo-sensors';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import Constants, { ExecutionEnvironment } from 'expo-constants';

const EXPERIMENTAL_PROTOTYPES = true;
const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
import { AuthContext } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { apiRequest, getValidToken } from '../services/api';
import { shareEntityLink } from '../services/shareLinks';
import { resolveCollectableCoverUrl, resolveManualCoverUrl } from '../utils/coverUrl';
import { extractTextFromImage, parseTextToItems } from '../services/ocr';
import { CachedImage, StarRating, CategoryIcon } from '../components/ui';
import VisionProcessingModal from '../components/VisionProcessingModal';
import useBottomFooterLayout from '../navigation/useBottomFooterLayout';
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

function normalizeOwnedPlatforms(value) {
    if (value == null) return [];
    const source = Array.isArray(value) ? value : [value];
    const seen = new Set();
    const out = [];
    for (const entry of source) {
        const normalized = String(entry || '').trim();
        if (!normalized) continue;
        const key = normalized.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(normalized);
}
    return out;
}

const MuseumItem = ({ item, styles, colors, info, coverSource, isDark, onNavigate, spacing, windowWidth }) => {
    const pitch = useSharedValue(0);
    const roll = useSharedValue(0);

    useEffect(() => {
        let subscription;
        if (EXPERIMENTAL_PROTOTYPES) {
            Accelerometer.setUpdateInterval(50);
            subscription = Accelerometer.addListener(({ x, y }) => {
                pitch.value = withSpring(y * -150, { damping: 20 });
                roll.value = withSpring(x * -150, { damping: 20 });
            });
        }
        return () => subscription?.remove();
    }, []);

    const scale = useSharedValue(1);

    const sheenStyle = useAnimatedStyle(() => ({
        transform: [
            { translateX: roll.value },
            { translateY: pitch.value }
        ]
    }));

    const animatedContainerStyle = useAnimatedStyle(() => ({
        transform: [{ scale: withSpring(scale.value, { damping: 12, stiffness: 200 }) }]
    }));

    const handlePressIn = () => { scale.value = 1.08; };
    const handlePressOut = () => { scale.value = 1; };

    return (
        <View style={styles.museumContainer}>
            <Pressable onPressIn={handlePressIn} onPressOut={handlePressOut} onPress={onNavigate}>
                <Animated.View style={[styles.museumArtifact, { width: windowWidth * 0.70, height: windowWidth * 1.05 }, animatedContainerStyle]}>
                    <View style={styles.museumFrame}>
                        {coverSource ? (
                            <View style={{ width: '100%', height: '100%' }}>
                                <CachedImage source={coverSource} style={StyleSheet.absoluteFill} contentFit="cover" />
                                <Animated.View style={[StyleSheet.absoluteFill, sheenStyle, { opacity: 0.85, width: '200%', height: '200%', top: '-50%', left: '-50%' }]}>
                                    <LinearGradient
                                        colors={['transparent', 'rgba(255,255,255,0.7)', 'transparent']}
                                        start={{ x: 0, y: 0 }}
                                        end={{ x: 1, y: 1 }}
                                        style={StyleSheet.absoluteFill}
                                    />
                                </Animated.View>
                            </View>
                        ) : (
                            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.surfaceTop }}>
                                <CategoryIcon type={info.type} size={64} />
                            </View>
                        )}
                    </View>
                </Animated.View>
            </Pressable>
            <View style={[styles.museumPlaque, { width: windowWidth * 0.65 }]}>
                <Text style={styles.museumPlaqueTitle} numberOfLines={2}>{info.title}</Text>
                {info.subtitle || info.type ? (
                    <Text style={styles.museumPlaqueMeta}>{info.subtitle || info.type}</Text>
                ) : null}
            </View>
        </View>
    );
};

const getSpineColor = (title, isDark) => {
    let hash = 0;
    const str = title || 'Unknown';
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const colorPalette = isDark 
        ? ['#1f2937', '#111827', '#312e81', '#1e3a8a', '#14532d', '#7f1d1d', '#581c87', '#064e3b', '#451a03']
        : ['#475569', '#3b82f6', '#10b981', '#ef4444', '#f59e0b', '#8b5cf6', '#ec4899', '#6366f1', '#14b8a6'];
    const idx = Math.abs(hash) % colorPalette.length;
    return colorPalette[idx];
};

const SPINE_COLOR_FALLBACK = '#2c2c2c';

function resolveImageColorSource(coverSource) {
    if (typeof coverSource === 'string' && coverSource.trim()) {
        return { uri: coverSource.trim(), headers: null };
    }
    if (coverSource && typeof coverSource === 'object' && typeof coverSource.uri === 'string' && coverSource.uri.trim()) {
        return {
            uri: coverSource.uri.trim(),
            headers: coverSource.headers && typeof coverSource.headers === 'object'
                ? coverSource.headers
                : null,
        };
    }
    return null;
}

function isValidExtractedColor(value) {
    return typeof value === 'string' && /^#(?:[0-9a-f]{3,8})$/i.test(value.trim());
}

const SpineItem = ({ item, styles, colors, isDark, coverSource, info, onNavigate }) => {
    const rawFormat = item.format || item.collectable?.format || '';
    const fmt = String(rawFormat).toLowerCase();
    const isPS = fmt.includes('playstation') || fmt.includes('ps4') || fmt.includes('ps5');
    const isXbox = fmt.includes('xbox');
    const isNintendo = fmt.includes('nintendo') || fmt.includes('switch');
    const imageColorSource = useMemo(() => resolveImageColorSource(coverSource), [coverSource]);
    const [dominantColor, setDominantColor] = useState(null);

    useEffect(() => {
        let isMounted = true;
        setDominantColor(null);
        // Bypass native extraction completely if running inside Expo Go to avoid [runtime not ready] crashes
        if (!imageColorSource?.uri || !EXPERIMENTAL_PROTOTYPES || isExpoGo) return () => { isMounted = false; };

        try {
            const ImageColors = require('react-native-image-colors').default;
            ImageColors.getColors(imageColorSource.uri, {
                fallback: SPINE_COLOR_FALLBACK,
                cache: true,
                key: imageColorSource.uri,
                ...(imageColorSource.headers ? { headers: imageColorSource.headers } : {}),
            }).then(res => {
                if (!isMounted) return;
                let extractedColor = null;
                if (res.platform === 'android') {
                    extractedColor = res.dominant;
                } else if (res.platform === 'ios') {
                    extractedColor = res.primary;
                } else if (res.platform === 'web') {
                    extractedColor = res.dominant;
                }
                if (isValidExtractedColor(extractedColor)) {
                    setDominantColor(extractedColor.trim());
                }
            }).catch(() => {
                // ignore
            });
        } catch (err) {
            // Silently fail if native module dynamic import crashes
        }

        return () => { isMounted = false; };
    }, [imageColorSource]);

    let baseColor = getSpineColor(info.title, isDark);
    if (isPS) baseColor = '#00439C';
    else if (isXbox) baseColor = '#107C10';
    else if (isNintendo) baseColor = '#E60012';
    
    if (dominantColor && !isPS && !isXbox && !isNintendo) {
        baseColor = dominantColor;
    }

    return (
        <TouchableOpacity activeOpacity={0.8} style={[styles.spineContainer, { backgroundColor: baseColor }]} onPress={onNavigate}>
            <View style={styles.spineInnerShadow}>
                <View style={styles.spineTextWrapper}>
                    <Text style={styles.spineText} numberOfLines={1}>{info.title}</Text>
                </View>
            </View>
        </TouchableOpacity>
    );
};


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
    const [viewMode, setViewMode] = useState('list');
    const [displayModeOpen, setDisplayModeOpen] = useState(false);
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
    const { contentBottomPadding, floatingBottomOffset } = useBottomFooterLayout();
    const detailContentBottomPadding = contentBottomPadding(spacing.xl + spacing.lg);
    const detailFabBottomOffset = floatingBottomOffset(spacing.md);

    useEffect(() => {
        return () => {
            isMountedRef.current = false;
        };
    }, []);

    useEffect(() => {
        const loadViewMode = async () => {
            try {
                const storedMode = await AsyncStorage.getItem('@ShelfDetailScreen:viewMode');
                if (storedMode) setViewMode(storedMode);
            } catch (e) {
                console.warn('Failed to load view mode', e);
            }
        };
        loadViewMode();
    }, []);

    const handleChangeViewMode = async (mode) => {
        setViewMode(mode);
        setDisplayModeOpen(false);
        try {
            await AsyncStorage.setItem('@ShelfDetailScreen:viewMode', mode);
        } catch (e) {
            console.warn('Failed to save view mode', e);
        }
    };

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
                mode: 'shelf_add_or_replace',
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

    const layoutData = useMemo(() => {
        if (searchQuery.trim().length > 0) return visibleItems;
        if (viewMode === 'banner') {
            const out = [];
            const groups = new Map();
            
            visibleItems.forEach(item => {
                const collectable = item.collectable || item.collectableSnapshot;
                const manual = item.manual || item.manualSnapshot;
                
                const ownedPlatforms = normalizeOwnedPlatforms(item.ownedPlatforms);
                let rawFormat = item.format || collectable?.format || manual?.format;
                if (!rawFormat && ownedPlatforms.length > 0) {
                    rawFormat = ownedPlatforms[0];
                }
                rawFormat = rawFormat || 'Unknown';
                
                let format = String(rawFormat).trim();
                format = format.charAt(0).toUpperCase() + format.slice(1);

                const yearMatch = (collectable?.year || manual?.year || collectable?.publishYear || collectable?.releaseYear || '');
                const year = yearMatch ? String(yearMatch).match(/\b(\d{4})\b/)?.[1] || 'Unknown' : 'Unknown';
                
                let sectionTitle = format;
                if (sortKey === 'year_desc') {
                    if (format === 'Unknown' && year === 'Unknown') {
                        sectionTitle = 'Unknown';
                    } else if (format === 'Unknown') {
                        sectionTitle = year;
                    } else if (year === 'Unknown') {
                        sectionTitle = format;
                    } else {
                        sectionTitle = `${format} - ${year}`;
                    }
                }
                
                if (!groups.has(sectionTitle)) {
                    groups.set(sectionTitle, {
                        sectionTitle,
                        format,
                        year,
                        items: []
                    });
                }
                groups.get(sectionTitle).items.push(item);
            });

            const groupValues = Array.from(groups.values());
            groupValues.sort((a, b) => {
                if (a.sectionTitle === 'Unknown') return 1;
                if (b.sectionTitle === 'Unknown') return -1;
                
                const formatCmp = a.format.localeCompare(b.format);
                if (formatCmp !== 0) return formatCmp;

                if (sortKey === 'year_desc') {
                    const yearA = parseInt(a.year, 10);
                    const yearB = parseInt(b.year, 10);
                    const validA = !isNaN(yearA);
                    const validB = !isNaN(yearB);
                    if (validA && validB) return yearB - yearA;
                    if (validA) return -1;
                    if (validB) return 1;
                }
                return 0;
            });

            groupValues.forEach(g => {
                out.push({ isSectionHeader: true, title: g.sectionTitle, id: `header-${g.sectionTitle}` });
                out.push(...g.items);
            });
            return out;
        }
        return visibleItems;
    }, [visibleItems, viewMode, sortKey, searchQuery]);

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

        // Helper: try resolving owner-photo thumbnail or full image as cover source.
        const resolveOwnerPhotoCover = () => {
            if (!ownerPhotoHeaders) return null;
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
            return null;
        };

        // For manual "other" items, prefer persisted owner-photo thumbnail in list cards
        // (even if an API cover exists).
        if (manualType === 'other') {
            const ownerCover = resolveOwnerPhotoCover();
            if (ownerCover) return ownerCover;
        }

        // For any item type: when no standard cover exists, fall back to owner crop photo.
        if (!fallback && ownerPhoto) {
            const ownerCover = resolveOwnerPhotoCover();
            if (ownerCover) return ownerCover;
        }

        return fallback;
    };

    const { width: windowWidth } = Dimensions.get('window');

    const renderItem = ({ item }) => {
        if (item.isSectionHeader) {
            return (
                <View style={styles.bannerHeader}>
                    <Text style={[styles.bannerHeaderText, { color: colors.primary }]}>
                        {item.title.toUpperCase()}
                    </Text>
                </View>
            );
        }

        const info = getItemInfo(item);
        const coverEntry = resolveCoverSource(item);
        const coverSource = coverEntry?.source || null;
        const collectableId = item.collectable?.id || item.collectableId;
        const manualId = item.manual?.id || item.manualId;
        const isFavorited = collectableId ? favorites[collectableId] : false;
        const ownedPlatforms = normalizeOwnedPlatforms(item.ownedPlatforms);

        const handlePress = () => navigation.navigate('CollectableDetail', {
            item,
            shelfId: id,
            readOnly: isReadOnly,
            ownerId: shelf?.ownerId,
            ownerUsername: shelf?.ownerUsername || null,
        });

        if (!searchQuery && viewMode === 'tile') {
            return (
                <TouchableOpacity
                    style={styles.gridCard}
                    onPress={handlePress}
                    activeOpacity={0.8}
                >
                    <View style={styles.gridCoverWrapper}>
                        {coverSource ? (
                            <CachedImage
                                source={coverSource}
                                style={styles.gridCoverImage}
                                contentFit="cover"
                                onError={() => {
                                    if (coverEntry?.kind === 'owner_thumb') setOwnerPhotoSourceFailures((prev) => ({ ...prev, [item.id]: 'thumb_failed' }));
                                    if (coverEntry?.kind === 'owner_image') setOwnerPhotoSourceFailures((prev) => ({ ...prev, [item.id]: 'image_failed' }));
                                }}
                            />
                        ) : (
                            <View style={styles.gridCoverFallback}>
                                <CategoryIcon type={info.type} size={24} />
                            </View>
                        )}
                    </View>
                    <Text style={styles.gridTitle} numberOfLines={2}>{info.title}</Text>
                    {info.subtitle ? <Text style={styles.gridSubtitle} numberOfLines={1}>{info.subtitle}</Text> : null}
                </TouchableOpacity>
            );
        }

        return (
            <TouchableOpacity
                style={styles.itemCard}
                onPress={handlePress}
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
                    {item.platformMissing ? (
                        <View style={styles.platformMissingBadge}>
                            <Text style={styles.platformMissingBadgeText}>Platform missing</Text>
                        </View>
                    ) : null}
                    {ownedPlatforms.length > 0 && (
                        <View style={styles.platformChipRow}>
                            {ownedPlatforms.slice(0, 3).map((platformName) => (
                                <View key={`${item.id}-${platformName.toLowerCase()}`} style={styles.platformChip}>
                                    <Text style={styles.platformChipText} numberOfLines={1}>{platformName}</Text>
                                </View>
                            ))}
                            {ownedPlatforms.length > 3 && (
                                <Text style={styles.platformMoreText}>+{ownedPlatforms.length - 3}</Text>
                            )}
                        </View>
                    )}
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

    const renderSwipeItem = ({ item }) => {
        if (item.isSectionHeader) return null;
        const info = getItemInfo(item);
        const coverEntry = resolveCoverSource(item);
        const coverSource = coverEntry?.source || null;
        
        return (
            <View style={{ width: windowWidth, padding: spacing.md }}>
                <TouchableOpacity
                    style={styles.swipeCardItem}
                    onPress={() => navigation.navigate('CollectableDetail', {
                        item,
                        shelfId: id,
                        readOnly: isReadOnly,
                        ownerId: shelf?.ownerId,
                        ownerUsername: shelf?.ownerUsername || null,
                    })}
                    activeOpacity={0.8}
                >
                    {coverSource ? (
                        <ImageBackground
                            source={coverSource}
                            style={styles.swipeBackground}
                            imageStyle={styles.swipeBackgroundImage}
                            blurRadius={10}
                        >
                            <View style={[styles.swipeOverlay, { backgroundColor: isDark ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.4)' }]} />
                            <View style={styles.swipeContent}>
                                <CachedImage source={coverSource} style={styles.swipeCoverImage} contentFit="cover" />
                                <Text style={styles.swipeTitle} numberOfLines={2}>{info.title}</Text>
                                <Text style={styles.swipeMeta}>{info.subtitle || info.type}</Text>
                            </View>
                        </ImageBackground>
                    ) : (
                        <View style={[styles.swipeBackground, { backgroundColor: colors.surfaceTop }]}>
                            <View style={styles.swipeContent}>
                                <View style={styles.swipeIconBox}>
                                    <CategoryIcon type={info.type} size={40} />
                                </View>
                                <Text style={[styles.swipeTitle, { color: colors.text }]} numberOfLines={2}>{info.title}</Text>
                                <Text style={[styles.swipeMeta, { color: colors.textSecondary }]}>{info.subtitle || info.type}</Text>
                            </View>
                        </View>
                    )}
                </TouchableOpacity>
                <View style={styles.swipeHintContainer}>
                    <Ionicons name="swap-horizontal" size={16} color={colors.textMuted} style={{ marginRight: 6 }} />
                    <Text style={styles.swipeHint}>Swipe left or right to browse items</Text>
                </View>
            </View>
        );
    };

    const renderMuseumItem = ({ item }) => {
        if (item.isSectionHeader) return null;
        const info = getItemInfo(item);
        const coverSource = resolveCoverSource(item)?.source || null;
        return (
            <MuseumItem
                item={item}
                styles={styles}
                colors={colors}
                info={info}
                coverSource={coverSource}
                isDark={isDark}
                spacing={spacing}
                windowWidth={windowWidth}
                onNavigate={() => navigation.navigate('CollectableDetail', {
                    item, shelfId: id, readOnly: isReadOnly, ownerId: shelf?.ownerId, ownerUsername: shelf?.ownerUsername || null
                })}
            />
        );
    };

    const renderSpineItem = ({ item }) => {
        if (item.isSectionHeader) return null;
        const info = getItemInfo(item);
        const coverSource = resolveCoverSource(item)?.source || null;
        return (
            <SpineItem
                item={item}
                styles={styles}
                colors={colors}
                info={info}
                isDark={isDark}
                coverSource={coverSource}
                onNavigate={() => navigation.navigate('CollectableDetail', {
                    item, shelfId: id, readOnly: isReadOnly, ownerId: shelf?.ownerId, ownerUsername: shelf?.ownerUsername || null
                })}
            />
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
    const handledVisionTerminalJobsRef = React.useRef(new Set());
    const activeVisionJobIdRef = React.useRef(null);
    const appStateRef = React.useRef(AppState.currentState || 'active');
    const conditionalInAppNoticeJobsRef = React.useRef(new Set());
    const suppressForegroundCompletionAlertJobsRef = React.useRef(new Set());

    // Poll for vision job status
    const pollVisionStatus = useCallback(async (jobId, options = {}) => {
        if (!jobId) return;

        if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
        }
        setCurrentJobId(jobId);
        activeVisionJobIdRef.current = jobId;
        handledVisionTerminalJobsRef.current.delete(jobId);
        if (options.notifyInAppOnComplete === true) {
            conditionalInAppNoticeJobsRef.current.add(jobId);
            if (appStateRef.current !== 'active') {
                suppressForegroundCompletionAlertJobsRef.current.add(jobId);
            }
        }

        let intervalId = null;
        let stopped = false;
        const stopPolling = () => {
            if (stopped) return;
            stopped = true;
            if (intervalId) {
                clearInterval(intervalId);
            }
            if (pollIntervalRef.current === intervalId) {
                pollIntervalRef.current = null;
            }
        };

        const poll = async () => {
            try {
                const response = await apiRequest({
                    apiBase,
                    path: `/api/shelves/${id}/vision/${jobId}/status`,
                    token,
                });
                const notifyInAppOnComplete = response?.notifyInAppOnComplete === true;
                if (notifyInAppOnComplete) {
                    conditionalInAppNoticeJobsRef.current.add(jobId);
                    if (appStateRef.current !== 'active') {
                        suppressForegroundCompletionAlertJobsRef.current.add(jobId);
                    }
                }

                setVisionProgress(response.progress || 0);
                setVisionMessage(response.message || '');
                setVisionStatus(response.status);

                if (activeVisionJobIdRef.current !== jobId) {
                    stopPolling();
                    return;
                }

                if (response.status === 'completed') {
                    if (handledVisionTerminalJobsRef.current.has(jobId)) {
                        stopPolling();
                        return;
                    }
                    handledVisionTerminalJobsRef.current.add(jobId);
                    stopPolling();
                    activeVisionJobIdRef.current = null;
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
                    const requiresConditionalDelivery =
                        conditionalInAppNoticeJobsRef.current.has(jobId) || notifyInAppOnComplete;
                    const shouldSuppressForegroundAlert =
                        suppressForegroundCompletionAlertJobsRef.current.has(jobId)
                        || appStateRef.current !== 'active';

                    if (requiresConditionalDelivery && shouldSuppressForegroundAlert) {
                        setVisionModalVisible(false);
                        conditionalInAppNoticeJobsRef.current.delete(jobId);
                        suppressForegroundCompletionAlertJobsRef.current.delete(jobId);
                        return;
                    }

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
                    conditionalInAppNoticeJobsRef.current.delete(jobId);
                    suppressForegroundCompletionAlertJobsRef.current.delete(jobId);
                } else if (response.status === 'failed' || response.status === 'aborted') {
                    if (handledVisionTerminalJobsRef.current.has(jobId)) {
                        stopPolling();
                        return;
                    }
                    handledVisionTerminalJobsRef.current.add(jobId);
                    stopPolling();
                    activeVisionJobIdRef.current = null;
                    setVisionLoading(false);
                    setVisionModalVisible(false);
                    conditionalInAppNoticeJobsRef.current.delete(jobId);
                    suppressForegroundCompletionAlertJobsRef.current.delete(jobId);

                    if (response.status !== 'aborted') {
                        Alert.alert('Error', response.message || 'Vision processing failed');
                    }
                }
            } catch (err) {
                console.warn('Polling error:', err);
            }
        };

        // Start polling
        await poll();
        if (!stopped) {
            intervalId = setInterval(poll, 2000);
            pollIntervalRef.current = intervalId;
        }
    }, [apiBase, id, token, navigation, loadShelf]);

    // Cancel vision processing
    const handleCancelVision = useCallback(async () => {
        if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
        }

        const targetJobId = activeVisionJobIdRef.current || currentJobId;
        if (targetJobId) {
            try {
                await apiRequest({
                    apiBase,
                    path: `/api/shelves/${id}/vision/${targetJobId}`,
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
        activeVisionJobIdRef.current = null;
        conditionalInAppNoticeJobsRef.current.delete(targetJobId);
        suppressForegroundCompletionAlertJobsRef.current.delete(targetJobId);
    }, [apiBase, id, token, currentJobId]);

    // Hide modal but continue processing
    const handleHideToBackground = useCallback(async () => {
        setVisionModalVisible(false);
        const targetJobId = activeVisionJobIdRef.current || currentJobId;
        if (!targetJobId) return;
        conditionalInAppNoticeJobsRef.current.add(targetJobId);
        try {
            const response = await apiRequest({
                apiBase,
                path: `/api/shelves/${id}/vision/${targetJobId}/background`,
                method: 'POST',
                token,
            });
            if (response?.notifyInAppOnComplete === true) {
                conditionalInAppNoticeJobsRef.current.add(targetJobId);
            }
        } catch (err) {
            console.warn('Failed to set in-app completion notice:', err);
        }
    }, [apiBase, id, token, currentJobId]);

    // Cleanup on unmount
    React.useEffect(() => {
        return () => {
            if (pollIntervalRef.current) {
                clearInterval(pollIntervalRef.current);
            }
            activeVisionJobIdRef.current = null;
            conditionalInAppNoticeJobsRef.current.clear();
            suppressForegroundCompletionAlertJobsRef.current.clear();
        };
    }, []);

    React.useEffect(() => {
        const subscription = AppState.addEventListener('change', (nextState) => {
            appStateRef.current = nextState;
            if (nextState !== 'active') {
                const activeJobId = activeVisionJobIdRef.current;
                if (
                    activeJobId &&
                    conditionalInAppNoticeJobsRef.current.has(activeJobId)
                ) {
                    suppressForegroundCompletionAlertJobsRef.current.add(activeJobId);
                }
            }
        });

        return () => {
            subscription.remove();
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
                    if (data.notifyInAppOnComplete === true) {
                        conditionalInAppNoticeJobsRef.current.add(data.jobId);
                    }
                    pollVisionStatus(data.jobId, {
                        notifyInAppOnComplete: data.notifyInAppOnComplete === true,
                    });
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
        navigation.navigate('ItemSearch', { mode: 'shelf_add_or_replace', shelfId: id, shelfType });
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

    const viewLabel = useMemo(() => {
        const modes = {
            tile: 'Tile View',
            banner: 'Banner List',
            list: 'Detailed List',
            swipe: 'Swipe Cards',
            ...(EXPERIMENTAL_PROTOTYPES ? {
                museum: 'Museum (Interactive)',
                spines: 'Bookshelf Spines'
            } : {})
        };
        return modes[viewMode] || 'View';
    }, [viewMode]);

    if (loading && !refreshing) {
        return (
            <View style={[styles.screen, styles.centerContainer]}>
                <ActivityIndicator size="large" color={colors.primary} />
            </View>
        );
    }

    const renderDisplayModeModal = () => (
        <Modal visible={displayModeOpen} transparent animationType="fade">
            <View style={styles.modalOverlay}>
                <TouchableOpacity style={styles.modalBg} activeOpacity={1} onPress={() => setDisplayModeOpen(false)} />
                <View style={styles.modalContent}>
                    <View style={styles.modalHeader}>
                        <Text style={styles.modalTitle}>Display Mode</Text>
                        <TouchableOpacity onPress={() => setDisplayModeOpen(false)}>
                            <Ionicons name="close" size={24} color={colors.textMuted} />
                        </TouchableOpacity>
                    </View>
                    <View style={styles.sortOptions}>
                        {[
                            { id: 'tile', label: 'Tile View', icon: 'grid' },
                            { id: 'banner', label: 'Banner List', icon: 'list-circle' },
                            { id: 'list', label: 'Detailed List', icon: 'list' },
                            { id: 'swipe', label: 'Swipe Cards', icon: 'albums' },
                            ...(EXPERIMENTAL_PROTOTYPES ? [
                                { id: 'museum', label: 'Museum (Interactive)', icon: 'camera-outline' },
                                { id: 'spines', label: 'Bookshelf Spines', icon: 'library-outline' },
                            ] : [])
                        ].map(mode => (
                            <TouchableOpacity
                                key={mode.id}
                                style={[styles.sortOption, viewMode === mode.id && styles.sortOptionActive]}
                                onPress={() => handleChangeViewMode(mode.id)}
                            >
                                <Ionicons
                                    name={mode.icon}
                                    size={20}
                                    color={viewMode === mode.id ? colors.primary : colors.text}
                                    style={{ marginRight: spacing.md }}
                                />
                                <Text style={[styles.sortOptionText, viewMode === mode.id && styles.sortOptionTextActive]}>
                                    {mode.label}
                                </Text>
                                {viewMode === mode.id && (
                                    <Ionicons name="checkmark" size={20} color={colors.primary} />
                                )}
                            </TouchableOpacity>
                        ))}
                    </View>
                </View>
            </View>
        </Modal>
    );

    return (
        <SafeAreaView style={styles.screen} edges={['top']}>
            {renderDisplayModeModal()}
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

            {/* Search */}
            {items.length > 5 && (
                <View style={styles.searchRow}>
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
                </View>
            )}

            {/* Sort & View */}
            <View style={[styles.controlsRow, { justifyContent: 'space-between' }]}>
                <TouchableOpacity
                    style={[styles.sortButton, { flex: 1, maxWidth: undefined, justifyContent: 'center' }]}
                    onPress={() => setSortOpen(true)}
                    accessibilityLabel="Sort items"
                >
                    <Ionicons name="swap-vertical" size={16} color={colors.textMuted} />
                    <Text style={styles.sortButtonText} numberOfLines={1}>Sort: {sortLabel}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[styles.sortButton, { flex: 1, maxWidth: undefined, justifyContent: 'center' }]}
                    onPress={() => setDisplayModeOpen(true)}
                    accessibilityLabel="Change view mode"
                >
                    <Ionicons name="grid-outline" size={16} color={colors.textMuted} />
                    <Text style={styles.sortButtonText} numberOfLines={1}>View: {viewLabel}</Text>
                </TouchableOpacity>
            </View>

            {/* Items List */}
            <FlatList
                key={searchQuery ? 'list' : viewMode}
                data={searchQuery ? visibleItems : layoutData}
                keyExtractor={(item) => String(item.id)}
                numColumns={!searchQuery && viewMode === 'tile' ? 2 : (!searchQuery && viewMode === 'spines' ? 8 : 1)}
                pagingEnabled={!searchQuery && viewMode === 'swipe'}
                snapToAlignment={(!searchQuery && viewMode === 'swipe') ? 'start' : undefined}
                decelerationRate={(!searchQuery && viewMode === 'swipe') ? 'fast' : 'normal'}
                horizontal={!searchQuery && viewMode === 'swipe'}
                renderItem={
                    !searchQuery 
                        ? (viewMode === 'swipe' ? renderSwipeItem 
                           : viewMode === 'museum' ? renderMuseumItem 
                           : viewMode === 'spines' ? renderSpineItem 
                           : renderItem) 
                        : renderItem
                }
                columnWrapperStyle={
                    (!searchQuery && viewMode === 'tile') 
                        ? { justifyContent: 'space-between', paddingHorizontal: spacing.md } 
                        : (!searchQuery && viewMode === 'spines') 
                        ? { justifyContent: 'center', paddingHorizontal: spacing.sm, marginVertical: 4 } 
                        : undefined
                }
                contentContainerStyle={[
                    (!searchQuery && viewMode === 'swipe') ? { paddingTop: 0 } : styles.listContent,
                    { paddingBottom: detailContentBottomPadding },
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
                showsHorizontalScrollIndicator={false}
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
                        { bottom: detailFabBottomOffset },
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
    museumContainer: {
        width: '100%',
        paddingVertical: spacing.xl,
        alignItems: 'center',
        backgroundColor: colors.background,
    },
    museumArtifact: {
        backgroundColor: '#000',
        borderRadius: 4,
        padding: 12,
        ...shadows.xl,
        elevation: 15,
        shadowOpacity: 0.5,
        shadowRadius: 20,
    },
    museumFrame: {
        flex: 1,
        borderRadius: 2,
        ...shadows.inner,
        overflow: 'hidden',
        backgroundColor: colors.surfaceTop,
    },
    museumPlaque: {
        marginTop: spacing.xl,
        padding: spacing.md,
        backgroundColor: colors.surface,
        borderRadius: 4,
        alignItems: 'center',
        borderLeftWidth: 2,
        borderLeftColor: colors.primary,
        ...shadows.md,
    },
    museumPlaqueTitle: {
        fontSize: 14,
        fontWeight: '700',
        color: colors.text,
        textAlign: 'center',
        textTransform: 'uppercase',
        letterSpacing: 2,
    },
    museumPlaqueMeta: {
        fontSize: 12,
        color: colors.textMuted,
        marginTop: 4,
        fontStyle: 'italic',
    },
    spineContainer: {
        width: 42,
        height: 180,
        marginHorizontal: 1,
        marginBottom: 8,
        borderRadius: 3,
        overflow: 'hidden',
        ...shadows.sm,
    },
    spineInnerShadow: {
        ...StyleSheet.absoluteFillObject,
        borderLeftWidth: 2,
        borderLeftColor: 'rgba(255,255,255,0.2)',
        borderRightWidth: 2,
        borderRightColor: 'rgba(0,0,0,0.3)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    spineTextWrapper: {
        width: 170,
        height: 42,
        transform: [{ rotate: '90deg' }],
        justifyContent: 'center',
        alignItems: 'center',
    },
    spineText: {
        fontSize: 10,
        fontWeight: 'bold',
        color: '#fff',
        textShadowColor: 'rgba(0,0,0,0.5)',
        textShadowOffset: { width: 0, height: 1 },
        textShadowRadius: 2,
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
    searchRow: {
        flexDirection: 'row',
        paddingHorizontal: spacing.md,
        paddingBottom: spacing.sm,
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
    platformChipRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: spacing.xs,
        marginTop: spacing.xs,
    },
    platformMissingBadge: {
        marginTop: spacing.xs,
        alignSelf: 'flex-start',
        paddingHorizontal: spacing.xs,
        paddingVertical: 2,
        borderRadius: radius.full,
        backgroundColor: colors.error + '20',
        borderWidth: 1,
        borderColor: colors.error + '55',
    },
    platformMissingBadgeText: {
        fontSize: 11,
        color: colors.error,
        fontWeight: '700',
    },
    platformChip: {
        backgroundColor: colors.surfaceElevated,
        borderRadius: radius.full,
        paddingHorizontal: spacing.xs,
        paddingVertical: 2,
    },
    platformChipText: {
        fontSize: 11,
        color: colors.textSecondary,
    },
    platformMoreText: {
        fontSize: 11,
        color: colors.textMuted,
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
    // Display Mode Modal & Layouts
    modalBg: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0,0,0,0.5)',
    },
    modalContent: {
        width: '85%',
        maxWidth: 340,
        backgroundColor: colors.surface,
        borderRadius: radius.xl,
        padding: spacing.lg,
        ...shadows.xl,
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: spacing.md,
    },
    modalTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: colors.text,
    },
    sortOptions: {
        paddingTop: spacing.sm,
    },
    sortOptionActive: {
        backgroundColor: colors.primary + '15',
    },
    sortOptionTextActive: {
        color: colors.primary,
        fontWeight: '600',
    },
    bannerHeader: {
        marginTop: spacing.lg,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        paddingBottom: spacing.sm,
        marginBottom: spacing.sm,
    },
    bannerHeaderText: {
        fontSize: 14,
        letterSpacing: 1.5,
        fontWeight: '700',
    },
    swipeCardItem: {
        flex: 1,
        height: Dimensions.get('window').height * 0.70,
        borderRadius: radius.xl,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
        ...shadows.lg,
    },
    swipeBackground: {
        width: '100%',
        height: '100%',
        justifyContent: 'flex-end',
    },
    swipeBackgroundImage: {
        resizeMode: 'cover',
    },
    swipeOverlay: {
        ...StyleSheet.absoluteFillObject,
    },
    swipeContent: {
        padding: spacing.xl,
        alignItems: 'center',
        justifyContent: 'center',
        flex: 1,
    },
    swipeCoverImage: {
        width: 140,
        height: 200,
        borderRadius: radius.md,
        marginBottom: spacing.md,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.2)',
    },
    swipeTitle: {
        fontSize: 26,
        fontWeight: 'bold',
        color: '#fff',
        textAlign: 'center',
        marginTop: spacing.md,
        marginBottom: spacing.xs,
        textShadowColor: 'rgba(0,0,0,0.5)',
        textShadowOffset: { width: 0, height: 2 },
        textShadowRadius: 4,
    },
    swipeMeta: {
        fontSize: 15,
        color: 'rgba(255,255,255,0.9)',
        textAlign: 'center',
    },
    swipeIconBox: {
        width: 80,
        height: 80,
        borderRadius: radius.full,
        backgroundColor: 'rgba(255,255,255,0.2)',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: spacing.md,
    },
    swipeHintContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: spacing.lg,
    },
    swipeHint: {
        fontSize: 14,
        color: colors.textMuted,
        fontWeight: '500',
    },
    gridCard: {
        width: '48%',
        backgroundColor: colors.surface,
        borderRadius: radius.lg,
        padding: spacing.sm,
        marginBottom: spacing.md,
        ...shadows.sm,
    },
    gridCoverWrapper: {
        width: '100%',
        aspectRatio: 0.75,
        borderRadius: radius.md,
        overflow: 'hidden',
        backgroundColor: colors.surfaceElevated,
        marginBottom: spacing.sm,
        justifyContent: 'center',
        alignItems: 'center',
    },
    gridCoverImage: {
        width: '100%',
        height: '100%',
    },
    gridCoverFallback: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    gridTitle: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.text,
        marginBottom: 2,
    },
    gridSubtitle: {
        fontSize: 12,
        color: colors.textSecondary,
    },
});
