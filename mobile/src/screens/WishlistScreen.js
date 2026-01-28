import React, { useContext, useEffect, useMemo, useState, useCallback, useRef } from 'react';
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Image,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
    StatusBar,
    Modal,
    Dimensions,
    TouchableWithoutFeedback,
    Keyboard,
    RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AuthContext } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { apiRequest } from '../services/api';
import { CachedImage, StarRating, CategoryIcon } from '../components/ui';

// Reuse usage of these if available, otherwise fallback to local impl
// Assuming CachedImage is available based on ShelfDetailScreen usage

const SORT_OPTIONS = [
    { key: 'title_asc', label: 'Title A-Z' },
    { key: 'title_desc', label: 'Title Z-A' },
    { key: 'date_desc', label: 'Date Added' },
    { key: 'creator_asc', label: 'Creator A-Z' },
];

export default function WishlistScreen({ navigation, route }) {
    const { wishlistId } = route.params;
    const { token, apiBase } = useContext(AuthContext);
    const { colors, spacing, typography, shadows, radius, isDark } = useTheme();

    const [wishlist, setWishlist] = useState(null);
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    // Local Search & Sort
    const [localSearchQuery, setLocalSearchQuery] = useState('');
    const [sortKey, setSortKey] = useState('date_desc');
    const [sortOpen, setSortOpen] = useState(false);

    // Global Search (FAB)
    const [showGlobalSearch, setShowGlobalSearch] = useState(false);
    const [globalSearchQuery, setGlobalSearchQuery] = useState('');
    const [globalSearchResults, setGlobalSearchResults] = useState([]);
    const [globalSearchLoading, setGlobalSearchLoading] = useState(false);
    const searchTimeoutRef = useRef(null);

    const styles = useMemo(
        () => createStyles({ colors, spacing, typography, shadows, radius }),
        [colors, spacing, typography, shadows, radius]
    );

    useEffect(() => {
        loadWishlist();
    }, [wishlistId]);

    const loadWishlist = async (isRefresh = false) => {
        try {
            if (isRefresh) setRefreshing(true);
            else setLoading(true);

            const data = await apiRequest({ apiBase, path: `/api/wishlists/${wishlistId}`, token });
            setWishlist(data.wishlist);
            setItems(data.items || []);
        } catch (e) {
            if (!isRefresh) Alert.alert('Error', 'Failed to load wishlist');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    const handleRefresh = () => loadWishlist(true);

    const handleDeleteItem = useCallback(async (itemId) => {
        Alert.alert('Remove Item', 'Remove this item from the wishlist?', [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Remove',
                style: 'destructive',
                onPress: async () => {
                    try {
                        await apiRequest({
                            apiBase,
                            path: `/api/wishlists/${wishlistId}/items/${itemId}`,
                            method: 'DELETE',
                            token,
                        });
                        setItems((prev) => prev.filter((i) => i.id !== itemId));
                    } catch (e) {
                        Alert.alert('Error', e.message);
                    }
                },
            },
        ]);
    }, [apiBase, token, wishlistId]);

    // --- Local List Logic ---

    const visibleItems = useMemo(() => {
        const query = localSearchQuery.trim().toLowerCase();
        let filtered = items;

        if (query) {
            filtered = items.filter(item => {
                const title = item.collectableTitle || item.manualText || '';
                return title.toLowerCase().includes(query);
            });
        }

        return [...filtered].sort((a, b) => {
            const titleA = (a.collectableTitle || a.manualText || '').toLowerCase();
            const titleB = (b.collectableTitle || b.manualText || '').toLowerCase();
            const dateA = new Date(a.createdAt || 0).getTime();
            const dateB = new Date(b.createdAt || 0).getTime();
            const creatorA = (a.collectableCreator || '').toLowerCase();
            const creatorB = (b.collectableCreator || '').toLowerCase();

            switch (sortKey) {
                case 'title_asc': return titleA.localeCompare(titleB);
                case 'title_desc': return titleB.localeCompare(titleA);
                case 'date_desc': return dateB - dateA;
                case 'creator_asc': return creatorA.localeCompare(creatorB);
                default: return 0;
            }
        });
    }, [items, localSearchQuery, sortKey]);

    const sortLabel = useMemo(() => {
        const option = SORT_OPTIONS.find(o => o.key === sortKey);
        return option ? option.label : 'Sort';
    }, [sortKey]);

    const renderItem = ({ item }) => {
        // Resolve cover image - mimic ShelfDetailScreen logic
        const imageUri = item.collectableCoverMediaPath
            ? `${apiBase}/media/${item.collectableCoverMediaPath}`
            : item.collectableCover;

        const hasCollectable = !!(item.collectableId || item.collectableTitle);
        const title = hasCollectable ? item.collectableTitle : item.manualText;
        const subtitle = hasCollectable && item.collectableCreator ? item.collectableCreator : '';

        return (
            <TouchableOpacity
                style={styles.itemCard}
                onPress={() => hasCollectable && item.collectableId
                    ? navigation.navigate('CollectableDetail', { item: { collectable: { id: item.collectableId } } })
                    : null
                }
                activeOpacity={0.7}
                disabled={!hasCollectable}
            >
                <View style={styles.itemCover}>
                    {imageUri ? (
                        <Image
                            source={{ uri: imageUri }}
                            style={styles.itemCoverImage}
                            resizeMode="cover"
                        />
                    ) : (
                        <View style={styles.itemCoverFallback}>
                            <Ionicons name="heart" size={24} color={colors.primary} />
                        </View>
                    )}
                </View>
                <View style={styles.itemContent}>
                    <Text style={styles.itemTitle} numberOfLines={2}>{title}</Text>
                    {subtitle ? <Text style={styles.itemSubtitle} numberOfLines={1}>{subtitle}</Text> : null}
                    {item.notes ? (
                        <Text style={styles.itemNotes} numberOfLines={1}>{item.notes}</Text>
                    ) : null}
                </View>
                <TouchableOpacity
                    style={styles.deleteButton}
                    onPress={() => handleDeleteItem(item.id)}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                    <Ionicons name="trash-outline" size={20} color={colors.textMuted} />
                </TouchableOpacity>
            </TouchableOpacity>
        );
    };

    // --- Global Search Logic (FAB) ---

    const handleGlobalSearchChange = (text) => {
        setGlobalSearchQuery(text);

        if (searchTimeoutRef.current) {
            clearTimeout(searchTimeoutRef.current);
        }

        if (!text.trim()) {
            setGlobalSearchResults([]);
            return;
        }

        searchTimeoutRef.current = setTimeout(async () => {
            setGlobalSearchLoading(true);
            try {
                // Only search collectables, explicitly excluding friends
                const collectablesRes = await apiRequest({
                    apiBase,
                    path: `/api/collectables?q=${encodeURIComponent(text)}&limit=10&wildcard=true`,
                    token
                });
                setGlobalSearchResults(collectablesRes?.results || []);
            } catch (err) {
                console.warn('Search error:', err);
            } finally {
                setGlobalSearchLoading(false);
            }
        }, 300);
    };

    const handleAddSearchResult = async (collectable) => {
        try {
            await apiRequest({
                apiBase,
                path: `/api/wishlists/${wishlistId}/items`,
                method: 'POST',
                token,
                body: { collectableId: collectable.id }
            });
            // Reset and reload
            setGlobalSearchQuery('');
            setGlobalSearchResults([]);
            setShowGlobalSearch(false);
            loadWishlist(true);
            Alert.alert('Success', 'Item added to wishlist');
        } catch (e) {
            Alert.alert('Error', e.message || 'Failed to add item');
        }
    };

    const openGlobalSearch = () => {
        setGlobalSearchQuery('');
        setGlobalSearchResults([]);
        setShowGlobalSearch(true);
    };

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
                    <Text style={styles.headerTitle} numberOfLines={1}>{wishlist?.name || 'Wishlist'}</Text>
                    <Text style={styles.headerSubtitle}>{items.length} item{items.length !== 1 ? 's' : ''}</Text>
                </View>
                <View style={{ width: 40 }} />
            </View>

            {/* Controls Row (Search + Sort) */}
            <View style={[styles.controlsRow, items.length > 5 ? null : styles.controlsRowRight]}>
                {items.length > 0 && (
                    <View style={styles.searchBox}>
                        <Ionicons name="search" size={18} color={colors.textMuted} />
                        <TextInput
                            style={styles.searchInput}
                            placeholder="Filter wishlist..."
                            placeholderTextColor={colors.textMuted}
                            value={localSearchQuery}
                            onChangeText={setLocalSearchQuery}
                        />
                    </View>
                )}
                <TouchableOpacity
                    style={styles.sortButton}
                    onPress={() => setSortOpen(true)}
                >
                    <Ionicons name="swap-vertical" size={16} color={colors.textMuted} />
                    <Text style={styles.sortButtonText} numberOfLines={1}>{sortLabel}</Text>
                </TouchableOpacity>
            </View>

            {/* Main List */}
            {items.length === 0 ? (
                <View style={styles.emptyState}>
                    <Ionicons name="heart-outline" size={48} color={colors.textMuted} />
                    <Text style={styles.emptyTitle}>No items yet</Text>
                    <Text style={styles.emptySubtitle}>Tap the + button to search and add items</Text>
                </View>
            ) : (
                <FlatList
                    data={visibleItems}
                    keyExtractor={(item) => item.id.toString()}
                    renderItem={renderItem}
                    contentContainerStyle={styles.listContent}
                    refreshing={refreshing}
                    onRefresh={handleRefresh}
                />
            )}

            {/* FAB */}
            <TouchableOpacity
                style={styles.fab}
                onPress={openGlobalSearch}
            >
                <Ionicons name="add" size={28} color={colors.textInverted} />
            </TouchableOpacity>

            {/* Sort Modal */}
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
                    </TouchableOpacity>
                </TouchableOpacity>
            </Modal>

            {/* Global Search Modal - Mimicking Social Feed Search */}
            <Modal
                visible={showGlobalSearch}
                animationType="slide"
                presentationStyle="pageSheet"
                onRequestClose={() => setShowGlobalSearch(false)}
            >
                <View style={styles.globalSearchContainer}>
                    <View style={styles.globalSearchHeader}>
                        <View style={styles.searchInputContainer}>
                            <Ionicons name="search" size={16} color={colors.textMuted} />
                            <TextInput
                                style={styles.globalSearchInput}
                                placeholder="Search catalog to add..."
                                placeholderTextColor={colors.textMuted}
                                value={globalSearchQuery}
                                onChangeText={handleGlobalSearchChange}
                                autoFocus
                            />
                            {globalSearchQuery.length > 0 && (
                                <TouchableOpacity onPress={() => setGlobalSearchQuery('')}>
                                    <Ionicons name="close-circle" size={16} color={colors.textMuted} />
                                </TouchableOpacity>
                            )}
                        </View>
                        <TouchableOpacity onPress={() => setShowGlobalSearch(false)}>
                            <Text style={styles.cancelButtonText}>Cancel</Text>
                        </TouchableOpacity>
                    </View>

                    {globalSearchLoading ? (
                        <View style={styles.loaderContainer}>
                            <ActivityIndicator size="small" color={colors.primary} />
                        </View>
                    ) : (
                        <FlatList
                            data={globalSearchResults}
                            keyExtractor={(item) => item.id.toString()}
                            contentContainerStyle={styles.listContent}
                            renderItem={({ item }) => {
                                // Resolving cover for search results
                                const coverUrl = item.coverMediaPath
                                    ? `${apiBase}/media/${item.coverMediaPath}`
                                    : item.coverUrl;

                                return (
                                    <TouchableOpacity
                                        style={styles.searchResultItem}
                                        onPress={() => handleAddSearchResult(item)}
                                    >
                                        {coverUrl ? (
                                            <Image source={{ uri: coverUrl }} style={styles.searchResultCover} />
                                        ) : (
                                            <View style={[styles.searchResultCover, styles.searchResultCoverFallback]}>
                                                <Ionicons name="book" size={20} color={colors.primary} />
                                            </View>
                                        )}
                                        <View style={styles.searchResultInfo}>
                                            <Text style={styles.searchResultTitle} numberOfLines={1}>{item.title}</Text>
                                            {item.primaryCreator && (
                                                <Text style={styles.searchResultSubtitle} numberOfLines={1}>{item.primaryCreator}</Text>
                                            )}
                                        </View>
                                        <Ionicons name="add-circle-outline" size={24} color={colors.primary} />
                                    </TouchableOpacity>
                                );
                            }}
                            ListEmptyComponent={
                                globalSearchQuery.trim().length > 0 ? (
                                    <View style={styles.emptyState}>
                                        <Text style={styles.emptyText}>No items found</Text>
                                    </View>
                                ) : null
                            }
                        />
                    )}
                </View>
            </Modal>
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
        // Controls Row
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
            maxWidth: 120, // Reduced max width since options are short
        },
        sortButtonText: {
            fontSize: 12,
            color: colors.textMuted,
        },
        // List Items
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
        itemNotes: {
            fontSize: 12,
            color: colors.textSecondary,
            fontStyle: 'italic',
            marginTop: 4,
        },
        deleteButton: {
            padding: spacing.sm,
        },
        emptyState: {
            flex: 1,
            justifyContent: 'center',
            alignItems: 'center',
            padding: spacing.xl,
        },
        emptyTitle: {
            fontSize: 18,
            fontWeight: '600',
            color: colors.text,
            marginTop: spacing.md,
        },
        emptySubtitle: {
            fontSize: 14,
            color: colors.textMuted,
            textAlign: 'center',
            marginTop: spacing.xs,
        },
        emptyText: {
            fontSize: 14,
            color: colors.textMuted,
            textAlign: 'center',
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
        // Sort Modal
        modalOverlay: {
            flex: 1,
            backgroundColor: 'rgba(0, 0, 0, 0.4)',
            justifyContent: 'center',
            alignItems: 'center',
            padding: spacing.md,
        },
        sortModal: {
            width: '100%',
            maxWidth: 300,
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
            textAlign: 'center',
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
        // Global Search Modal Styles (matching SocialFeedScreen style)
        globalSearchContainer: {
            flex: 1,
            backgroundColor: colors.background,
        },
        globalSearchHeader: {
            flexDirection: 'row',
            alignItems: 'center',
            padding: spacing.md,
            gap: spacing.md,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
        },
        searchInputContainer: {
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: colors.surface,
            borderRadius: 20,
            paddingHorizontal: spacing.md,
            paddingVertical: 8,
            gap: 8,
        },
        globalSearchInput: {
            flex: 1,
            fontSize: 15,
            color: colors.text,
            paddingVertical: 0,
        },
        cancelButtonText: {
            fontSize: 16,
            color: colors.primary,
            fontWeight: '500',
        },
        loaderContainer: {
            padding: spacing.xl,
            alignItems: 'center',
        },
        // Search Result Items
        searchResultItem: {
            flexDirection: 'row',
            alignItems: 'center',
            padding: spacing.md,
            gap: spacing.md,
            borderBottomWidth: 1,
            borderBottomColor: colors.border + '40', // light separator
        },
        searchResultCover: {
            width: 48,
            height: 64, // Shelf item ratio
            borderRadius: 6,
            backgroundColor: colors.surfaceElevated,
        },
        searchResultCoverFallback: {
            justifyContent: 'center',
            alignItems: 'center',
        },
        searchResultInfo: {
            flex: 1,
        },
        searchResultTitle: {
            fontSize: 16,
            fontWeight: '600',
            color: colors.text,
        },
        searchResultSubtitle: {
            fontSize: 14,
            color: colors.textMuted,
            marginTop: 2,
        },
    });

