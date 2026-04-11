import React, { useCallback, useContext, useEffect, useMemo, useState, useRef } from 'react';
import {
    ActivityIndicator,
    FlatList,
    Modal,
    RefreshControl,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
    StatusBar,
    Image,
    Dimensions,
    ImageBackground,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { CachedImage, CategoryIcon, AccountSlideMenu, useGlobalSearch, GlobalSearchInput, GlobalSearchOverlay } from '../components/ui';
import { ENABLE_PROFILE_IN_TAB_BAR } from '../config/featureFlags';
import { AuthContext } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { apiRequest, getValidToken } from '../services/api';
import { clearShelvesListCache } from '../services/shelvesListCache';
import { fetchShelvesPage } from '../services/shelvesListService';
import useBottomFooterLayout from '../navigation/useBottomFooterLayout';

const SHELVES_PAGE_LIMIT = 50;
const SHELF_SORT_OPTIONS = [
    { key: 'type', label: 'Shelf Type' },
    { key: 'name', label: 'Alphabetical' },
    { key: 'createdAt', label: 'Date Created' },
    { key: 'updatedAt', label: 'Last Updated' },
];
const SHELF_SORT_DIRECTIONS = [
    { key: 'desc', label: 'Descending' },
    { key: 'asc', label: 'Ascending' },
];

export default function ShelvesScreen({ navigation }) {
    const { token, apiBase, user } = useContext(AuthContext);
    const { colors, spacing, typography, shadows, radius, isDark } = useTheme();

    const [shelves, setShelves] = useState([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [isSearchingItems, setIsSearchingItems] = useState(false);
    const [searchPage, setSearchPage] = useState(0);
    const [hasMoreSearch, setHasMoreSearch] = useState(true);
    const searchCache = useRef({});
    const [viewMode, setViewMode] = useState('tile');
    const [displayModeOpen, setDisplayModeOpen] = useState(false);
    const [unmatchedCount, setUnmatchedCount] = useState(0);
    const [imageAuthToken, setImageAuthToken] = useState(null);
    const [shelfPhotoFailures, setShelfPhotoFailures] = useState({});

    useEffect(() => {
        const loadViewMode = async () => {
            try {
                const storedMode = await AsyncStorage.getItem('@ShelvesScreen:viewMode');
                if (storedMode) setViewMode(storedMode);
            } catch (e) {
                console.warn('Failed to load view mode', e);
            }
        };
        loadViewMode();
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

    const handleChangeViewMode = async (mode) => {
        setViewMode(mode);
        setDisplayModeOpen(false);
        try {
            await AsyncStorage.setItem('@ShelvesScreen:viewMode', mode);
        } catch (e) {
            console.warn('Failed to save view mode', e);
        }
    };
    const [totalShelves, setTotalShelves] = useState(0);
    const [hasMoreShelves, setHasMoreShelves] = useState(false);
    const [loadingMoreShelves, setLoadingMoreShelves] = useState(false);
    const [sortBy, setSortBy] = useState('createdAt');
    const [sortDir, setSortDir] = useState('desc');
    const [sortOpen, setSortOpen] = useState(false);
    const [unreadCount, setUnreadCount] = useState(0);
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const search = useGlobalSearch(navigation);

    const loadShelves = useCallback(async ({ forceRefresh = false, showBlockingLoader = true } = {}) => {
        try {
            if (showBlockingLoader) setLoading(true);
            const [data, unmatchedData] = await Promise.all([
                fetchShelvesPage({
                    apiBase,
                    token,
                    limit: SHELVES_PAGE_LIMIT,
                    skip: 0,
                    sortBy,
                    sortDir,
                    forceRefresh,
                }),
                apiRequest({ apiBase, path: '/api/unmatched/count', token }).catch(() => ({ count: 0 })),
            ]);
            const fetchedShelves = Array.isArray(data.shelves) ? data.shelves : [];
            const pagination = data?.pagination || {};
            setShelves(fetchedShelves);
            setShelfPhotoFailures({});
            setTotalShelves(Number.isFinite(Number(pagination.total)) ? Number(pagination.total) : fetchedShelves.length);
            setHasMoreShelves(Boolean(pagination.hasMore));
            setUnmatchedCount(unmatchedData.count || 0);
        } catch (e) {
            console.warn('Failed to load shelves:', e);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [apiBase, token, sortBy, sortDir]);

    const loadMoreShelves = useCallback(async () => {
        if (loadingMoreShelves || !hasMoreShelves) return;
        try {
            setLoadingMoreShelves(true);
            const skip = shelves.length;
            const data = await fetchShelvesPage({
                apiBase,
                token,
                limit: SHELVES_PAGE_LIMIT,
                skip,
                sortBy,
                sortDir,
            });
            const incoming = Array.isArray(data?.shelves) ? data.shelves : [];
            const pagination = data?.pagination || {};
            setShelves((prev) => {
                const merged = [...prev];
                const seen = new Set(prev.map((entry) => String(entry?.id)));
                for (const shelf of incoming) {
                    const key = String(shelf?.id ?? '');
                    if (seen.has(key)) continue;
                    seen.add(key);
                    merged.push(shelf);
                }
                return merged;
            });
            setTotalShelves(Number.isFinite(Number(pagination.total)) ? Number(pagination.total) : (skip + incoming.length));
            setHasMoreShelves(Boolean(pagination.hasMore));
        } catch (e) {
            console.warn('Failed to load more shelves:', e);
        } finally {
            setLoadingMoreShelves(false);
        }
    }, [apiBase, token, sortBy, sortDir, shelves, hasMoreShelves, loadingMoreShelves]);

    const loadUnreadCount = useCallback(async () => {
        if (!token) {
            setUnreadCount(0);
            return;
        }
        try {
            const result = await apiRequest({ apiBase, path: '/api/notifications/unread-count', token });
            const count = result?.unreadCount ?? result?.count ?? 0;
            setUnreadCount(Number(count) || 0);
        } catch (err) {
            setUnreadCount(0);
        }
    }, [apiBase, token]);

    useEffect(() => {
        loadShelves({ forceRefresh: false, showBlockingLoader: true });
        loadUnreadCount();
    }, [loadShelves, loadUnreadCount]);

    useEffect(() => {
        const unsubscribe = navigation.addListener('focus', () => {
            loadShelves({ forceRefresh: false, showBlockingLoader: false });
            loadUnreadCount();
        });
        return unsubscribe;
    }, [navigation, loadShelves, loadUnreadCount]);

    const onRefresh = useCallback(() => {
        setRefreshing(true);
        clearShelvesListCache();
        loadShelves({ forceRefresh: true, showBlockingLoader: false });
        loadUnreadCount();
    }, [loadShelves, loadUnreadCount]);

    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearchQuery(searchQuery);
            setSearchPage(0);
        }, 400);
        return () => clearTimeout(timer);
    }, [searchQuery]);

    const runSearch = useCallback(async (q, page = 0) => {
        if (!q || q.trim().length < 2) {
            setSearchResults([]);
            return;
        }

        const limit = 50;
        const skip = page * limit;
        const cacheKey = `${q}:${page}`;

        if (searchCache.current[cacheKey]) {
            if (page === 0) setSearchResults(searchCache.current[cacheKey].results);
            else setSearchResults(prev => [...prev, ...searchCache.current[cacheKey].results]);
            setHasMoreSearch(searchCache.current[cacheKey].hasMore);
            return;
        }

        try {
            if (page === 0) setIsSearchingItems(true);
            const data = await apiRequest({ apiBase, path: `/api/shelves/search?q=${encodeURIComponent(q)}&skip=${skip}&limit=${limit}`, token });
            const results = data.results || [];
            const hasMore = results.length === limit;

            searchCache.current[cacheKey] = { results, hasMore };

            if (page === 0) {
                setSearchResults(results);
            } else {
                setSearchResults(prev => [...prev, ...results]);
            }
            setHasMoreSearch(hasMore);
        } catch (e) {
            console.warn('Search failed', e);
        } finally {
            setIsSearchingItems(false);
        }
    }, [apiBase, token]);

    useEffect(() => {
        if (debouncedSearchQuery.trim().length >= 2) {
            runSearch(debouncedSearchQuery, searchPage);
        } else {
            setSearchResults([]);
        }
    }, [debouncedSearchQuery, searchPage, runSearch]);

    const handleLoadMoreSearch = () => {
        if (!isSearchingItems && hasMoreSearch && debouncedSearchQuery.trim().length >= 2) {
            setSearchPage(prev => prev + 1);
        }
    };

    const isSearchActive = debouncedSearchQuery.trim().length >= 2;

    const listData = useMemo(() => {
        if (!debouncedSearchQuery.trim() || debouncedSearchQuery.trim().length < 2) {
            if (viewMode === 'banner') {
                const grouped = shelves.reduce((acc, shelf) => {
                    const type = shelf.type || 'other';
                    if (!acc[type]) acc[type] = [];
                    acc[type].push(shelf);
                    return acc;
                }, {});

                const types = Object.keys(grouped).sort();
                const bannerData = [];
                types.forEach(type => {
                    bannerData.push({ id: `header-banner-${type}`, isHeader: true, layout: 'banner', title: type.toUpperCase() });
                    grouped[type].forEach(shelf => bannerData.push({ ...shelf, layout: 'banner' }));
                });

                return bannerData;
            }
            return shelves;
        }

        const matchingShelves = searchResults.filter(r => r.resultType === 'shelf');
        const matchingItems = searchResults.filter(r => r.resultType !== 'shelf');

        const finalData = [];

        if (matchingShelves.length > 0) {
            finalData.push({ id: 'header-shelves', isHeader: true, title: 'Shelves' });
            finalData.push(...matchingShelves.map(s => ({ ...s, isGlobalResult: true, originalId: s.id, id: `shelf-${s.id}` })));
        }

        if (matchingItems.length > 0) {
            finalData.push({ id: 'header-items', isHeader: true, title: 'Collection Items' });
            finalData.push(...matchingItems.map(i => ({ ...i, isGlobalResult: true, originalId: i.id, id: `${i.resultType}-${i.id}` })));
        }

        if (finalData.length === 0 && !isSearchingItems) {
            finalData.push({ id: 'empty-search', isEmpty: true });
        }

        return finalData;
    }, [debouncedSearchQuery, shelves, searchResults, isSearchingItems, viewMode]);

    const sortSelectionLabel = useMemo(() => {
        const field = SHELF_SORT_OPTIONS.find((option) => option.key === sortBy)?.label || 'Date Created';
        const dir = SHELF_SORT_DIRECTIONS.find((option) => option.key === sortDir)?.label || 'Descending';
        return `${field} (${dir})`;
    }, [sortBy, sortDir]);


    const styles = useMemo(() => createStyles({ colors, spacing, typography, shadows, radius }), [colors, spacing, typography, shadows, radius]);
    const { contentBottomPadding, floatingBottomOffset } = useBottomFooterLayout();
    const shelvesListBottomPadding = contentBottomPadding(spacing.xl + spacing.lg);
    const shelvesFabBottomOffset = floatingBottomOffset(spacing.md - 40);

    const handleOpenShelf = (shelf) => {
        const shelfId = shelf.isGlobalResult ? (shelf.shelfId || shelf.originalId) : shelf.id;
        navigation.navigate('ShelfDetail', { id: shelfId, title: shelf.name || shelf.title });
    };

    const handleOpenItem = (item) => {
        const contextItem = {
            ...item,
            id: item.originalId || item.id
        };

        navigation.navigate('CollectableDetail', {
            item: contextItem,
            id: contextItem.id,
            collectableId: item.collectableId,
            manualId: item.manualId,
            shelfId: item.shelfId,
            title: item.title,
            manualMode: item.resultType === 'manual'
        });
    };

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

    const buildShelfPhotoSource = useCallback((shelf) => {
        if (!shelfPhotoHeaders) return null;
        if (shelf?.isGlobalResult) return null;
        const shelfPhoto = shelf?.shelfPhoto;
        if (!shelfPhoto?.hasPhoto || !shelfPhoto?.imageUrl) return null;
        const shelfId = String(shelf?.id ?? shelf?.shelfId ?? shelf?.originalId ?? '');
        if (!shelfId) return null;
        if (shelfPhotoFailures[shelfId]) return null;
        const resolvedUri = resolveApiUri(shelfPhoto.imageUrl);
        const versioned = withVersion(resolvedUri, shelfPhoto.updatedAt || null);
        if (!versioned) return null;
        return {
            uri: versioned,
            headers: shelfPhotoHeaders,
        };
    }, [resolveApiUri, shelfPhotoFailures, shelfPhotoHeaders, withVersion]);

    const renderShelfPhotoPreview = useCallback((item, size = 44) => {
        const source = buildShelfPhotoSource(item);
        if (!source) {
            return (
                <View style={[styles.shelfPhotoFallback, { width: size, height: size }]}>
                    <CategoryIcon type={item.type || item.kind} size={size >= 48 ? 28 : 22} />
                </View>
            );
        }
        return (
            <CachedImage
                source={source}
                style={[styles.shelfPhotoImage, { width: size, height: size }]}
                contentFit="cover"
                onError={() => {
                    const shelfId = String(item?.id ?? item?.shelfId ?? item?.originalId ?? '');
                    if (!shelfId) return;
                    setShelfPhotoFailures((prev) => ({ ...prev, [shelfId]: true }));
                }}
            />
        );
    }, [buildShelfPhotoSource, styles]);

    const renderGridItem = ({ item }) => {
        return (
            <TouchableOpacity
                style={styles.gridCard}
                onPress={() => handleOpenShelf(item)}
                activeOpacity={0.8}
            >
                <View style={styles.gridIconBox}>
                    {renderShelfPhotoPreview(item, 48)}
                </View>
                <Text style={styles.gridTitle} numberOfLines={2}>{item.name || item.title}</Text>
                <Text style={styles.gridMeta}>{item.isGlobalResult ? 'Shelf' : `${item.itemCount || 0} items`}</Text>
            </TouchableOpacity>
        );
    };

    const renderListItem = ({ item }) => {
        if (item.isHeader) {
            return (
                <View style={[styles.sectionHeader, item.layout === 'banner' && styles.bannerHeader]}>
                    <Text style={[styles.sectionHeaderText, item.layout === 'banner' && styles.bannerHeaderText]}>{item.title}</Text>
                </View>
            );
        }
        if (item.isEmpty) {
            return renderEmpty();
        }

        const getResultItemImageUri = (item) => {
            if (item.ownerPhotoThumbStorageKey) {
                return `${apiBase}/api/shelves/${item.shelfId}/items/${item.id}/owner-photo/thumbnail`;
            }
            if (item.coverUrl && typeof item.coverUrl === 'string' && item.coverUrl !== 'null') {
                const url = item.coverUrl.trim();
                return (url.startsWith('http') ? url : `${apiBase}${url.startsWith('/') ? '' : '/'}${url}`).replace(/ /g, '%20');
            }
            if (item.coverMediaPath && typeof item.coverMediaPath === 'string' && item.coverMediaPath !== 'null') {
                const path = item.coverMediaPath.trim();
                return `${apiBase}${path.startsWith('/') ? '' : '/'}${path}`.replace(/ /g, '%20');
            }
            return null;
        };

        if (item.isGlobalResult && item.resultType !== 'shelf') {
            const itemUri = getResultItemImageUri(item);

            const searchedSegments = searchQuery.toLowerCase().trim().split(/\s+/).filter(Boolean);
            const castNames = Array.isArray(item.castMembers)
                ? item.castMembers.map(c => c.name).filter(Boolean)
                : [];
            const itemTags = [...(item.genre || []), ...(item.tags || []), ...castNames];
            let displayTags = [];
            
            if (searchedSegments.length > 0 && itemTags.length > 0) {
                displayTags = itemTags.filter(t => {
                    const tLower = t.toLowerCase();
                    return searchedSegments.some(seg => tLower.includes(seg));
                });
            }
            
            if (displayTags.length === 0 && itemTags.length > 0) {
                displayTags = itemTags.slice(0, 2); 
            } else if (displayTags.length > 3) {
                displayTags = displayTags.slice(0, 3);
            }

            return (
                <TouchableOpacity
                    style={styles.itemResultCard}
                    onPress={() => handleOpenItem(item)}
                    activeOpacity={0.8}
                >
                    <View style={styles.itemThumbnailContainer}>
                        {itemUri ? (
                            <Image
                                source={{ uri: itemUri }}
                                style={styles.itemThumbnail}
                            />
                        ) : (
                            <View style={[styles.itemThumbnail, styles.itemThumbnailPlaceholder]}>
                                <CategoryIcon type={item.kind || 'item'} size={24} />
                            </View>
                        )}
                    </View>
                    <View style={styles.itemResultContent}>
                        <Text style={styles.itemResultTitle} numberOfLines={1}>{item.title}</Text>
                        {!!item.subtitle && <Text style={styles.itemResultSubtitle} numberOfLines={1}>{item.subtitle}</Text>}
                        <View style={styles.itemResultBadges}>
                            <View style={styles.badgeContainer}>
                                <Text style={styles.badgeLabel}>{item.kind || item.resultType}</Text>
                            </View>
                            {!!item.format && (
                                <View style={[styles.badgeContainer, styles.badgeContainerAlt]}>
                                    <Text style={styles.badgeLabelAlt}>{item.format}</Text>
                                </View>
                            )}
                            {!!item.year && (
                                <View style={[styles.badgeContainer, styles.badgeContainerAlt]}>
                                    <Text style={styles.badgeLabelAlt}>{item.year}</Text>
                                </View>
                            )}
                        </View>
                        {displayTags.length > 0 && (
                            <View style={styles.tagsContainer}>
                                {displayTags.map((tag, idx) => (
                                    <View key={`tag-${idx}`} style={styles.tagBadge}>
                                        <Text style={styles.tagText} numberOfLines={1}>{tag}</Text>
                                    </View>
                                ))}
                            </View>
                        )}
                        <Text style={styles.itemShelfInfo} numberOfLines={1}>In shelf: {item.shelfName}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </TouchableOpacity>
            );
        }

        return (
            <TouchableOpacity
                style={styles.listCard}
                onPress={() => handleOpenShelf(item)}
                activeOpacity={0.8}
            >
                <View style={styles.listIcon}>
                    {renderShelfPhotoPreview(item, 44)}
                </View>
                <View style={styles.listContent}>
                    <Text style={styles.listTitle} numberOfLines={1}>{item.title || item.name}</Text>
                    {item.isGlobalResult ? (
                        <Text style={styles.listMeta}>Shelf</Text>
                    ) : (
                        <Text style={styles.listMeta}>
                            {item.itemCount || 0} items • {item.type || 'Collection'}
                            {item.updatedAt ? ` • Updated ${new Date(item.updatedAt).toLocaleDateString()}` : ''}
                        </Text>
                    )}
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>
        );
    };

    const { width: windowWidth } = Dimensions.get('window');

    const renderSwipeItem = ({ item }) => {
        const shelfPhotoSource = buildShelfPhotoSource(item);

        return (
            <View style={{ width: windowWidth, padding: spacing.md }}>
                <TouchableOpacity
                    style={styles.swipeCardItem}
                    onPress={() => handleOpenShelf(item)}
                    activeOpacity={0.8}
                >
                    {shelfPhotoSource ? (
                        <ImageBackground
                            source={shelfPhotoSource}
                            style={styles.swipeBackground}
                            imageStyle={styles.swipeBackgroundImage}
                            blurRadius={10}
                        >
                            <View style={[styles.swipeOverlay, { backgroundColor: isDark ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.4)' }]} />
                            <View style={styles.swipeContent}>
                                <View style={styles.swipeIconBox}>
                                    <CategoryIcon type={item.type} size={40} />
                                </View>
                                <Text style={styles.swipeTitle} numberOfLines={2}>{item.name}</Text>
                                <Text style={styles.swipeMeta}>
                                    {item.itemCount || 0} items • {item.type}
                                    {item.updatedAt ? `\nUpdated ${new Date(item.updatedAt).toLocaleDateString()}` : ''}
                                </Text>
                            </View>
                        </ImageBackground>
                    ) : (
                        <View style={[styles.swipeBackground, { backgroundColor: colors.surfaceTop }]}>
                            <View style={styles.swipeContent}>
                                <View style={styles.swipeIconBox}>
                                    <CategoryIcon type={item.type} size={40} />
                                </View>
                                <Text style={[styles.swipeTitle, { color: colors.text }]} numberOfLines={2}>{item.name}</Text>
                                <Text style={[styles.swipeMeta, { color: colors.textSecondary }]}>
                                    {item.itemCount || 0} items • {item.type}
                                    {item.updatedAt ? `\nUpdated ${new Date(item.updatedAt).toLocaleDateString()}` : ''}
                                </Text>
                            </View>
                        </View>
                    )}
                </TouchableOpacity>
                <View style={styles.swipeHintContainer}>
                    <Ionicons name="swap-horizontal" size={16} color={colors.textMuted} style={{ marginRight: 6 }} />
                    <Text style={styles.swipeHint}>Swipe left or right to browse shelves</Text>
                </View>
            </View>
        );
    };

    const renderEmpty = () => (
        <View style={styles.emptyState}>
            <Ionicons name="library-outline" size={56} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>No shelves found</Text>
            <Text style={styles.emptyText}>Try adjusting your search criteria</Text>
        </View>
    );

    const renderLoading = () => (
        <View style={styles.loadingContainer}>
            {[1, 2, 3, 4, 5, 6].map(i => (
                <View key={i} style={[styles.skeleton, viewMode === 'tile' ? styles.skeletonGrid : styles.skeletonList]} />
            ))}
        </View>
    );

    const handleEndReached = () => {
        if (isSearchActive) {
            handleLoadMoreSearch();
            return;
        }
        loadMoreShelves();
    };

    return (
        <SafeAreaView style={styles.screen} edges={['top']}>
            <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />

            <View style={styles.header}>
                <GlobalSearchInput search={search} />
                <View style={styles.headerRight}>
                    <TouchableOpacity
                        style={styles.headerIconButton}
                        onPress={() => navigation.navigate('Notifications')}
                    >
                        <Ionicons name="notifications-outline" size={22} color={colors.text} />
                        {unreadCount > 0 && (
                            <View style={styles.badge}>
                                <Text style={styles.badgeText}>
                                    {unreadCount > 99 ? '99+' : unreadCount}
                                </Text>
                            </View>
                        )}
                    </TouchableOpacity>
                    {!ENABLE_PROFILE_IN_TAB_BAR && (
                        <TouchableOpacity onPress={() => setIsMenuOpen(true)}>
                            <Ionicons name="person-circle-outline" size={28} color={colors.text} />
                        </TouchableOpacity>
                    )}
                </View>
            </View>

            <View style={styles.body}>
                <View style={styles.subHeader}>
                    <View>
                        <Text style={styles.headerTitle}>My Shelves</Text>
                        <Text style={styles.headerSubtitle}>
                            {totalShelves} collection{totalShelves !== 1 ? 's' : ''}{(!isSearchActive && hasMoreShelves) ? ` (${shelves.length} loaded)` : ''}
                        </Text>
                    </View>
                    <View style={styles.subHeaderActions}>
                        {!isSearchActive && (
                            <TouchableOpacity
                                style={styles.sortTrigger}
                                onPress={() => setSortOpen(true)}
                                accessibilityLabel="Sort shelves"
                            >
                                <Ionicons name="swap-vertical" size={16} color={colors.textMuted} />
                                <Text numberOfLines={1} style={styles.sortTriggerText}>Sort</Text>
                            </TouchableOpacity>
                        )}
                        <TouchableOpacity
                            style={styles.sortTrigger}
                            onPress={() => setDisplayModeOpen(true)}
                            accessibilityLabel="Change view mode"
                        >
                            <Ionicons name={viewMode === 'tile' ? 'grid' : viewMode === 'swipe' ? 'albums' : 'list'} size={16} color={colors.textMuted} />
                            <Text numberOfLines={1} style={styles.sortTriggerText}>View</Text>
                        </TouchableOpacity>
                    </View>
                </View>

                <View style={styles.shelfSearchContainer}>
                    <View style={styles.searchBox}>
                        <Ionicons name="search" size={18} color={colors.textMuted} />
                        <TextInput
                            style={styles.searchInput}
                            placeholder="Search across your collection..."
                            placeholderTextColor={colors.textMuted}
                            value={searchQuery}
                            onChangeText={setSearchQuery}
                        />
                        {searchQuery.length > 0 && (
                            <TouchableOpacity onPress={() => setSearchQuery('')}>
                                <Ionicons name="close-circle" size={18} color={colors.textMuted} />
                            </TouchableOpacity>
                        )}
                    </View>
                </View>

                {unmatchedCount > 0 && (
                    <TouchableOpacity
                        style={styles.unmatchedEntry}
                        onPress={() => navigation.navigate('Unmatched')}
                        activeOpacity={0.8}
                    >
                        <View style={styles.unmatchedIcon}>
                            <Ionicons name="alert-circle" size={24} color="#fff" />
                        </View>
                        <View style={styles.unmatchedContent}>
                            <Text style={styles.unmatchedTitle}>Unmatched Items</Text>
                            <Text style={styles.unmatchedMeta}>{unmatchedCount} item{unmatchedCount !== 1 ? 's' : ''} need review</Text>
                        </View>
                        <Ionicons name="chevron-forward" size={18} color="#fff" />
                    </TouchableOpacity>
                )}

                {loading && !refreshing ? renderLoading() : (
                    <FlatList
                        data={listData}
                        keyExtractor={(item) => String(item.id)}
                        renderItem={
                            (!isSearchingItems && debouncedSearchQuery.trim().length < 2)
                                ? (viewMode === 'tile' ? renderGridItem : viewMode === 'swipe' ? renderSwipeItem : renderListItem)
                                : renderListItem
                        }
                        numColumns={(!isSearchingItems && debouncedSearchQuery.trim().length < 2 && viewMode === 'tile') ? 2 : 1}
                        key={(!isSearchingItems && debouncedSearchQuery.trim().length < 2) ? viewMode : 'list'}
                        contentContainerStyle={
                            (!isSearchingItems && debouncedSearchQuery.trim().length < 2 && viewMode === 'swipe')
                                ? [styles.swipeListContainer, { paddingBottom: shelvesListBottomPadding }]
                                : [styles.listContainer, { paddingBottom: shelvesListBottomPadding }]
                        }
                        columnWrapperStyle={(!isSearchingItems && debouncedSearchQuery.trim().length < 2 && viewMode === 'tile') ? styles.gridRow : undefined}
                        horizontal={!isSearchingItems && debouncedSearchQuery.trim().length < 2 && viewMode === 'swipe'}
                        pagingEnabled={!isSearchingItems && debouncedSearchQuery.trim().length < 2 && viewMode === 'swipe'}
                        showsHorizontalScrollIndicator={false}
                        refreshControl={
                            <RefreshControl
                                refreshing={refreshing}
                                onRefresh={onRefresh}
                                tintColor={colors.primary}
                                colors={[colors.primary]}
                            />
                        }
                        onEndReached={handleEndReached}
                        onEndReachedThreshold={0.5}
                        showsVerticalScrollIndicator={false}
                        ListFooterComponent={loadingMoreShelves && !isSearchActive ? (
                            <View style={styles.listFooterLoading}>
                                <ActivityIndicator size="small" color={colors.primary} />
                            </View>
                        ) : null}
                        ListEmptyComponent={renderEmpty}
                    />
                )}

                <TouchableOpacity
                    style={[styles.fab, { bottom: shelvesFabBottomOffset }]}
                    onPress={() => navigation.navigate('ShelfCreateScreen')}
                    activeOpacity={0.9}
                >
                    <Text style={styles.fabText}>Add</Text>
                </TouchableOpacity>

                <GlobalSearchOverlay search={search} />
            </View>

            <Modal
                visible={sortOpen}
                transparent
                animationType="fade"
                onRequestClose={() => setSortOpen(false)}
            >
                <TouchableOpacity
                    style={styles.sortModalBackdrop}
                    activeOpacity={1}
                    onPress={() => setSortOpen(false)}
                >
                    <TouchableOpacity activeOpacity={1} style={styles.sortModalCard} onPress={() => { }}>
                        <Text style={styles.sortModalTitle}>Sort Shelves</Text>
                        <Text style={styles.sortModalSubtitle} numberOfLines={2}>{sortSelectionLabel}</Text>
                        <View style={styles.sortSection}>
                            <Text style={styles.sortSectionTitle}>Field</Text>
                            {SHELF_SORT_OPTIONS.map((option) => {
                                const selected = option.key === sortBy;
                                return (
                                    <TouchableOpacity
                                        key={option.key}
                                        style={[styles.sortOptionRow, selected && styles.sortOptionSelected]}
                                        onPress={() => setSortBy(option.key)}
                                    >
                                        <Text style={[styles.sortOptionText, selected && styles.sortOptionTextSelected]}>{option.label}</Text>
                                        {selected ? <Ionicons name="checkmark" size={16} color={colors.primary} /> : null}
                                    </TouchableOpacity>
                                );
                            })}
                        </View>
                        <View style={styles.sortSection}>
                            <Text style={styles.sortSectionTitle}>Direction</Text>
                            <View style={styles.sortDirectionRow}>
                                {SHELF_SORT_DIRECTIONS.map((option) => {
                                    const selected = option.key === sortDir;
                                    return (
                                        <TouchableOpacity
                                            key={option.key}
                                            style={[styles.sortDirectionChip, selected && styles.sortDirectionChipSelected]}
                                            onPress={() => setSortDir(option.key)}
                                        >
                                            <Text style={[styles.sortDirectionText, selected && styles.sortDirectionTextSelected]}>
                                                {option.label}
                                            </Text>
                                        </TouchableOpacity>
                                    );
                                })}
                            </View>
                        </View>
                        <TouchableOpacity style={styles.sortDoneButton} onPress={() => setSortOpen(false)}>
                            <Text style={styles.sortDoneButtonText}>Done</Text>
                        </TouchableOpacity>
                    </TouchableOpacity>
                </TouchableOpacity>
            </Modal>

            <Modal
                visible={displayModeOpen}
                transparent
                animationType="fade"
                onRequestClose={() => setDisplayModeOpen(false)}
            >
                <TouchableOpacity
                    style={styles.sortModalBackdrop}
                    activeOpacity={1}
                    onPress={() => setDisplayModeOpen(false)}
                >
                    <TouchableOpacity activeOpacity={1} style={styles.sortModalCard} onPress={() => { }}>
                        <Text style={styles.sortModalTitle}>Display View</Text>
                        <Text style={styles.sortModalSubtitle} numberOfLines={2}>Select how shelves are displayed</Text>
                        <View style={styles.sortSection}>
                            {[
                                { key: 'tile', label: 'Tile', icon: 'grid' },
                                { key: 'banner', label: 'Banner List', icon: 'list' },
                                { key: 'list', label: 'List', icon: 'menu' },
                                { key: 'swipe', label: 'Swipe', icon: 'albums' },
                            ].map((option) => {
                                const selected = option.key === viewMode;
                                return (
                                    <TouchableOpacity
                                        key={option.key}
                                        style={[styles.sortOptionRow, selected && styles.sortOptionSelected]}
                                        onPress={() => handleChangeViewMode(option.key)}
                                    >
                                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                                            <Ionicons name={option.icon} size={20} color={selected ? colors.primary : colors.textMuted} />
                                            <Text style={[styles.sortOptionText, selected && styles.sortOptionTextSelected]}>
                                                {option.label}
                                            </Text>
                                        </View>
                                        {selected ? <Ionicons name="checkmark" size={16} color={colors.primary} /> : null}
                                    </TouchableOpacity>
                                );
                            })}
                        </View>
                        <TouchableOpacity style={styles.sortDoneButton} onPress={() => setDisplayModeOpen(false)}>
                            <Text style={styles.sortDoneButtonText}>Close</Text>
                        </TouchableOpacity>
                    </TouchableOpacity>
                </TouchableOpacity>
            </Modal>

            {!ENABLE_PROFILE_IN_TAB_BAR && (
                <AccountSlideMenu
                    isVisible={isMenuOpen}
                    onClose={() => setIsMenuOpen(false)}
                    navigation={navigation}
                    user={user}
                />
            )}
        </SafeAreaView>
    );
}

const createStyles = ({ colors, spacing, typography, shadows, radius }) => StyleSheet.create({
    screen: {
        flex: 1,
        backgroundColor: colors.background,
    },
    body: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: spacing.md,
        paddingTop: spacing.lg,
        paddingBottom: spacing.sm,
    },
    headerTitle: {
        fontSize: 28,
        fontWeight: '700',
        color: colors.text,
    },
    headerSubtitle: {
        fontSize: 14,
        color: colors.textMuted,
        marginTop: 2,
    },
    headerRight: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
    },
    headerIconButton: {
        padding: spacing.xs,
        position: 'relative',
    },
    subHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: spacing.md,
        paddingTop: spacing.sm,
        paddingBottom: spacing.md,
    },
    subHeaderActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        maxWidth: '58%',
    },
    sortTrigger: {
        height: 40,
        borderRadius: 20,
        paddingHorizontal: spacing.md,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
    },
    sortTriggerText: {
        fontSize: 13,
        color: colors.text,
        fontWeight: '600',
    },
    badge: {
        position: 'absolute',
        top: -2,
        right: -2,
        minWidth: 16,
        height: 16,
        borderRadius: 8,
        backgroundColor: colors.error,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 3,
    },
    badgeText: {
        color: colors.textInverted,
        fontSize: 10,
        fontWeight: '700',
    },
    shelfSearchContainer: {
        paddingHorizontal: spacing.md,
        paddingBottom: spacing.md,
    },
    searchBox: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.surface,
        borderRadius: radius.lg,
        paddingHorizontal: spacing.md,
        height: 44,
        gap: spacing.sm,
        ...shadows.sm,
    },
    searchInput: {
        flex: 1,
        fontSize: 15,
        color: colors.text,
        paddingVertical: 0,
    },
    listContainer: {
        padding: spacing.md,
        paddingTop: 0,
    },
    gridRow: {
        justifyContent: 'space-between',
    },
    gridCard: {
        width: '48%',
        backgroundColor: colors.surface,
        borderRadius: radius.lg,
        padding: spacing.md,
        marginBottom: spacing.md,
        ...shadows.sm,
    },
    gridIconBox: {
        width: 48,
        height: 48,
        borderRadius: radius.md,
        backgroundColor: colors.primary + '15',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: spacing.sm,
        overflow: 'hidden',
    },
    gridTitle: {
        fontSize: 15,
        fontWeight: '600',
        color: colors.text,
        marginBottom: 4,
    },
    gridMeta: {
        fontSize: 12,
        color: colors.textMuted,
    },
    listCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.surface,
        borderRadius: radius.lg,
        padding: spacing.md,
        marginBottom: spacing.sm,
        ...shadows.sm,
    },
    listIcon: {
        width: 44,
        height: 44,
        borderRadius: radius.md,
        backgroundColor: colors.primary + '15',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: spacing.md,
        overflow: 'hidden',
    },
    shelfPhotoImage: {
        borderRadius: radius.md,
    },
    shelfPhotoFallback: {
        borderRadius: radius.md,
        backgroundColor: colors.primary + '15',
        justifyContent: 'center',
        alignItems: 'center',
    },
    listContent: {
        flex: 1,
    },
    listTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.text,
    },
    listMeta: {
        fontSize: 13,
        color: colors.textMuted,
        marginTop: 2,
    },
    emptyState: {
        alignItems: 'center',
        paddingTop: spacing['3xl'],
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
        lineHeight: 20,
    },
    loadingContainer: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        padding: spacing.md,
    },
    listFooterLoading: {
        paddingVertical: spacing.md,
    },
    skeleton: {
        backgroundColor: colors.surface,
        borderRadius: radius.lg,
        marginBottom: spacing.md,
    },
    skeletonGrid: {
        width: '48%',
        height: 120,
    },
    skeletonList: {
        width: '100%',
        height: 72,
    },
    bannerHeader: {
        marginTop: spacing.lg,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        paddingBottom: spacing.sm,
        marginBottom: spacing.sm,
    },
    bannerHeaderText: {
        fontSize: 16,
        letterSpacing: 2,
        color: colors.primary,
        fontWeight: '700',
    },
    swipeListContainer: {
        paddingTop: 0,
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
    swipeTitle: {
        fontSize: 32,
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
        lineHeight: 22,
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
    fab: {
        position: 'absolute',
        right: spacing.md,
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
    // Unmatched Entry
    unmatchedEntry: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#ef4444',
        marginHorizontal: spacing.md,
        marginBottom: spacing.md,
        borderRadius: radius.lg,
        padding: spacing.md,
        ...shadows.md,
    },
    unmatchedIcon: {
        width: 44,
        height: 44,
        borderRadius: radius.md,
        backgroundColor: 'rgba(255,255,255,0.2)',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: spacing.md,
    },
    unmatchedContent: {
        flex: 1,
    },
    unmatchedTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: '#fff',
    },
    unmatchedMeta: {
        fontSize: 13,
        color: 'rgba(255,255,255,0.8)',
        marginTop: 2,
    },
    // Search Sections & Items
    sectionHeader: {
        marginTop: spacing.md,
        marginBottom: spacing.sm,
        paddingHorizontal: spacing.md,
    },
    sectionHeaderText: {
        fontSize: 18,
        fontWeight: 'bold',
        color: colors.text,
    },
    itemResultCard: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.md,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: colors.border,
    },
    itemThumbnailContainer: {
        width: 50,
        height: 70,
        borderRadius: radius.md,
        overflow: 'hidden',
        marginRight: spacing.md,
        backgroundColor: colors.surface,
    },
    itemThumbnail: {
        width: '100%',
        height: '100%',
        resizeMode: 'cover',
    },
    itemThumbnailPlaceholder: {
        justifyContent: 'center',
        alignItems: 'center',
    },
    itemResultContent: {
        flex: 1,
        justifyContent: 'center',
    },
    itemResultTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.text,
        marginBottom: 2,
    },
    itemResultSubtitle: {
        fontSize: 14,
        color: colors.textMuted,
        marginBottom: 4,
    },
    itemResultBadges: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: spacing.xs,
        marginBottom: 4,
    },
    badgeContainer: {
        backgroundColor: colors.primary + '20',
        paddingHorizontal: spacing.sm,
        paddingVertical: 2,
        borderRadius: radius.full,
    },
    badgeLabel: {
        fontSize: 11,
        fontWeight: '600',
        color: colors.primary,
        textTransform: 'capitalize',
    },
    badgeContainerAlt: {
        backgroundColor: colors.surfaceTop,
        borderWidth: 1,
        borderColor: colors.border,
    },
    badgeLabelAlt: {
        fontSize: 11,
        fontWeight: '500',
        color: colors.textSecondary,
    },
    tagsContainer: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 6,
        marginTop: 4,
        marginBottom: 4,
    },
    tagBadge: {
        backgroundColor: colors.surfaceTop,
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: radius.sm,
        borderWidth: 1,
        borderColor: colors.border,
    },
    tagText: {
        fontSize: 10,
        color: colors.textMuted,
        fontFamily: typography.medium,
        textTransform: 'uppercase',
    },
    itemShelfInfo: {
        fontSize: 12,
        color: colors.textMuted,
        fontStyle: 'italic',
    },
    sortModalBackdrop: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.4)',
        justifyContent: 'center',
        paddingHorizontal: spacing.lg,
    },
    sortModalCard: {
        backgroundColor: colors.background,
        borderRadius: radius.xl,
        padding: spacing.lg,
        borderWidth: 1,
        borderColor: colors.border,
        ...shadows.md,
    },
    sortModalTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: colors.text,
    },
    sortModalSubtitle: {
        marginTop: spacing.xs,
        fontSize: 12,
        color: colors.textMuted,
    },
    sortSection: {
        marginTop: spacing.md,
    },
    sortSectionTitle: {
        fontSize: 12,
        color: colors.textMuted,
        textTransform: 'uppercase',
        marginBottom: spacing.xs,
    },
    sortOptionRow: {
        borderRadius: radius.md,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        borderWidth: 1,
        borderColor: colors.border,
        marginBottom: spacing.xs,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    sortOptionSelected: {
        borderColor: colors.primary,
        backgroundColor: colors.primary + '14',
    },
    sortOptionText: {
        fontSize: 14,
        color: colors.text,
        fontWeight: '500',
    },
    sortOptionTextSelected: {
        color: colors.primary,
        fontWeight: '600',
    },
    sortDirectionRow: {
        flexDirection: 'row',
        gap: spacing.sm,
    },
    sortDirectionChip: {
        flex: 1,
        borderRadius: radius.full,
        borderWidth: 1,
        borderColor: colors.border,
        paddingVertical: spacing.sm,
        alignItems: 'center',
        justifyContent: 'center',
    },
    sortDirectionChipSelected: {
        borderColor: colors.primary,
        backgroundColor: colors.primary + '14',
    },
    sortDirectionText: {
        fontSize: 13,
        color: colors.text,
        fontWeight: '500',
    },
    sortDirectionTextSelected: {
        color: colors.primary,
        fontWeight: '600',
    },
    sortDoneButton: {
        marginTop: spacing.lg,
        borderRadius: radius.full,
        backgroundColor: colors.primary,
        paddingVertical: spacing.sm + 2,
        alignItems: 'center',
    },
    sortDoneButtonText: {
        color: colors.textInverted,
        fontSize: 14,
        fontWeight: '700',
    },
});
