import React, { useCallback, useContext, useEffect, useMemo, useState, useRef } from 'react';
import {
    FlatList,
    RefreshControl,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
    StatusBar,
    Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { CategoryIcon, AccountSlideMenu, useGlobalSearch, GlobalSearchInput, GlobalSearchOverlay } from '../components/ui';
import { ENABLE_PROFILE_IN_TAB_BAR } from '../config/featureFlags';
import { AuthContext } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { apiRequest } from '../services/api';

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
    const [viewMode, setViewMode] = useState('grid');
    const [unmatchedCount, setUnmatchedCount] = useState(0);
    const [unreadCount, setUnreadCount] = useState(0);
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const search = useGlobalSearch(navigation);

    const loadShelves = useCallback(async () => {
        try {
            if (!refreshing) setLoading(true);
            const [data, unmatchedData] = await Promise.all([
                apiRequest({ apiBase, path: '/api/shelves', token }),
                apiRequest({ apiBase, path: '/api/unmatched/count', token }).catch(() => ({ count: 0 })),
            ]);
            setShelves(Array.isArray(data.shelves) ? data.shelves : []);
            setUnmatchedCount(unmatchedData.count || 0);
        } catch (e) {
            console.warn('Failed to load shelves:', e);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [apiBase, token, refreshing]);

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
        loadShelves();
        loadUnreadCount();
    }, [loadShelves, loadUnreadCount]);

    useEffect(() => {
        const unsubscribe = navigation.addListener('focus', () => {
            loadShelves();
            loadUnreadCount();
        });
        return unsubscribe;
    }, [navigation, loadShelves, loadUnreadCount]);

    const onRefresh = useCallback(() => {
        setRefreshing(true);
        loadShelves();
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

    const listData = useMemo(() => {
        if (!debouncedSearchQuery.trim() || debouncedSearchQuery.trim().length < 2) {
            return [...shelves, { id: 'create-shelf', type: 'special-create', name: 'New Shelf' }];
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
    }, [debouncedSearchQuery, shelves, searchResults, isSearchingItems]);

    const showTopCreateShelfButton = useMemo(
        () => shelves.length > 6 && !searchQuery.trim(),
        [shelves.length, searchQuery]
    );


    const styles = useMemo(() => createStyles({ colors, spacing, typography, shadows, radius }), [colors, spacing, typography, shadows, radius]);

    const handleOpenShelf = (shelf) => {
        if (shelf.type === 'special-create') {
            navigation.navigate('ShelfCreateScreen');
        } else {
            const shelfId = shelf.isGlobalResult ? (shelf.shelfId || shelf.originalId) : shelf.id;
            navigation.navigate('ShelfDetail', { id: shelfId, title: shelf.name || shelf.title });
        }
    };

    const handleOpenItem = (item) => {
        // Restore the original database ID into the item payload for the detail screen
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

    const renderGridItem = ({ item }) => {
        if (item.type === 'special-create') {
            return (
                <TouchableOpacity
                    style={[styles.gridCard, styles.createCard]}
                    onPress={() => handleOpenShelf(item)}
                    activeOpacity={0.8}
                >
                    <View style={styles.createIconBox}>
                        <Ionicons name="add" size={32} color={colors.primary} />
                    </View>
                    <Text style={styles.createTitle}>New Shelf</Text>
                    <Text style={styles.createMeta}>Create collection</Text>
                </TouchableOpacity>
            );
        }

        return (
            <TouchableOpacity
                style={styles.gridCard}
                onPress={() => handleOpenShelf(item)}
                activeOpacity={0.8}
            >
                <View style={styles.gridIconBox}>
                    <CategoryIcon type={item.type || item.kind} size={28} />
                </View>
                <Text style={styles.gridTitle} numberOfLines={2}>{item.name || item.title}</Text>
                <Text style={styles.gridMeta}>{item.isGlobalResult ? 'Shelf' : `${item.itemCount || 0} items`}</Text>
            </TouchableOpacity>
        );
    };

    const renderListItem = ({ item }) => {
        if (item.isHeader) {
            return (
                <View style={styles.sectionHeader}>
                    <Text style={styles.sectionHeaderText}>{item.title}</Text>
                </View>
            );
        }
        if (item.isEmpty) {
            return renderEmpty();
        }
        if (item.type === 'special-create') {
            return (
                <TouchableOpacity
                    style={[styles.listCard, styles.createCard]}
                    onPress={() => handleOpenShelf(item)}
                    activeOpacity={0.8}
                >
                    <View style={styles.createIconBoxList}>
                        <Ionicons name="add" size={24} color={colors.primary} />
                    </View>
                    <View style={styles.listContent}>
                        <Text style={styles.createTitleList}>New Shelf</Text>
                        <Text style={styles.createMetaList}>Create a new collection</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </TouchableOpacity>
            );
        }

        const getResultItemImageUri = (item) => {
            if (item.ownerPhotoThumbStorageKey) {
                return `${apiBase}/api/shelves/${item.shelfId}/items/${item.id}/owner-photo/thumbnail`;
            }
            if (item.coverUrl && typeof item.coverUrl === 'string' && item.coverUrl !== 'null') {
                const url = item.coverUrl.trim();
                // Replace invalid URI characters
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
                    <CategoryIcon type={item.kind || item.type} size={22} />
                </View>
                <View style={styles.listContent}>
                    <Text style={styles.listTitle} numberOfLines={1}>{item.title || item.name}</Text>
                    {item.isGlobalResult ? (
                        <Text style={styles.listMeta}>Shelf</Text>
                    ) : (
                        <Text style={styles.listMeta}>{item.itemCount || 0} items • {item.type || 'Collection'}</Text>
                    )}
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>
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
                <View key={i} style={[styles.skeleton, viewMode === 'grid' ? styles.skeletonGrid : styles.skeletonList]} />
            ))}
        </View>
    );

    const renderTopCreateShelf = () => (
        <TouchableOpacity
            style={styles.topCreateButton}
            onPress={() => navigation.navigate('ShelfCreateScreen')}
            activeOpacity={0.8}
        >
            <View style={styles.topCreateIcon}>
                <Ionicons name="add" size={22} color={colors.primary} />
            </View>
            <View style={styles.topCreateContent}>
                <Text style={styles.topCreateTitle}>New Shelf</Text>
                <Text style={styles.topCreateMeta}>Create a new collection</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </TouchableOpacity>
    );

    return (
        <SafeAreaView style={styles.screen} edges={['top']}>
            <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />

            {/* Header with global search */}
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

            {/* Body: sub-header, shelf search, content — wrapped so overlay covers this area */}
            <View style={styles.body}>
                {/* Sub-header: title + view toggle */}
                <View style={styles.subHeader}>
                    <View>
                        <Text style={styles.headerTitle}>My Shelves</Text>
                        <Text style={styles.headerSubtitle}>{shelves.length} collection{shelves.length !== 1 ? 's' : ''}</Text>
                    </View>
                    <TouchableOpacity
                        style={styles.viewToggle}
                        onPress={() => setViewMode(v => v === 'grid' ? 'list' : 'grid')}
                    >
                        <Ionicons name={viewMode === 'grid' ? 'list' : 'grid'} size={22} color={colors.text} />
                    </TouchableOpacity>
                </View>

                {/* Shelf filter search */}
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

                {/* Unmatched Entry (shown when count > 0) */}
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

                {/* Content */}
                {loading && !refreshing ? renderLoading() : (
                    <FlatList
                        data={listData}
                        keyExtractor={(item) => String(item.id)}
                        renderItem={(!isSearchingItems && debouncedSearchQuery.trim().length < 2 && viewMode === 'grid') ? renderGridItem : renderListItem}
                        numColumns={(!isSearchingItems && debouncedSearchQuery.trim().length < 2 && viewMode === 'grid') ? 2 : 1}
                        key={(!isSearchingItems && debouncedSearchQuery.trim().length < 2 && viewMode === 'grid') ? 'grid' : 'list'}
                        contentContainerStyle={styles.listContainer}
                        ListHeaderComponent={showTopCreateShelfButton ? renderTopCreateShelf : null}
                        columnWrapperStyle={(!isSearchingItems && debouncedSearchQuery.trim().length < 2 && viewMode === 'grid') ? styles.gridRow : undefined}
                        refreshControl={
                            <RefreshControl
                                refreshing={refreshing}
                                onRefresh={onRefresh}
                                tintColor={colors.primary}
                                colors={[colors.primary]}
                            />
                        }
                        onEndReached={handleLoadMoreSearch}
                        onEndReachedThreshold={0.5}
                        showsVerticalScrollIndicator={false}
                        ListEmptyComponent={renderEmpty}
                    />
                )}

                {/* Search overlay — absolutely positioned over body */}
                <GlobalSearchOverlay search={search} />
            </View>

            {/* Account Slide Menu */}
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
    viewToggle: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: colors.surface,
        justifyContent: 'center',
        alignItems: 'center',
        ...shadows.sm,
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
        paddingBottom: 100,
    },
    topCreateButton: {
        width: '100%',
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.surface,
        borderRadius: radius.lg,
        padding: spacing.md,
        marginBottom: spacing.md,
        borderStyle: 'dashed',
        borderWidth: 1,
        borderColor: colors.border,
        ...shadows.sm,
    },
    topCreateIcon: {
        width: 44,
        height: 44,
        borderRadius: radius.md,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: spacing.md,
    },
    topCreateContent: {
        flex: 1,
    },
    topCreateTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.primary,
    },
    topCreateMeta: {
        fontSize: 13,
        color: colors.textMuted,
        marginTop: 2,
    },
    gridRow: {
        justifyContent: 'space-between',
    },
    // Grid View
    gridCard: {
        width: '48%',
        backgroundColor: colors.surface,
        borderRadius: radius.lg,
        padding: spacing.md,
        marginBottom: spacing.md,
        ...shadows.sm,
    },
    createCard: {
        borderStyle: 'dashed',
        borderWidth: 2,
        borderColor: colors.border,
        backgroundColor: 'transparent',
        shadowOpacity: 0,
        elevation: 0,
    },
    gridIconBox: {
        width: 48,
        height: 48,
        borderRadius: radius.md,
        backgroundColor: colors.primary + '15',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: spacing.sm,
    },
    createIconBox: {
        width: 48,
        height: 48,
        borderRadius: radius.md,
        backgroundColor: colors.surface,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: spacing.sm,
        borderWidth: 1,
        borderColor: colors.border,
    },
    createIconBoxList: {
        width: 44,
        height: 44,
        borderRadius: radius.md,
        backgroundColor: colors.surface,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: spacing.md,
        borderWidth: 1,
        borderColor: colors.border,
    },
    gridTitle: {
        fontSize: 15,
        fontWeight: '600',
        color: colors.text,
        marginBottom: 4,
    },
    createTitle: {
        fontSize: 15,
        fontWeight: '600',
        color: colors.primary,
        marginBottom: 4,
    },
    createTitleList: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.primary,
    },
    gridMeta: {
        fontSize: 12,
        color: colors.textMuted,
    },
    createMeta: {
        fontSize: 12,
        color: colors.textMuted,
    },
    createMetaList: {
        fontSize: 13,
        color: colors.textMuted,
        marginTop: 2,
    },
    // List View
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
    // Empty State
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
    emptyButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginTop: spacing.lg,
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.sm + 2,
        backgroundColor: colors.primary,
        borderRadius: 24,
    },
    emptyButtonText: {
        color: colors.textInverted,
        fontWeight: '600',
        fontSize: 15,
    },
    // Loading
    loadingContainer: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        padding: spacing.md,
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
});
