import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
    FlatList,
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
import { CategoryIcon, AccountSlideMenu } from '../components/ui';
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
    const [viewMode, setViewMode] = useState('grid');
    const [unmatchedCount, setUnmatchedCount] = useState(0);
    const [unreadCount, setUnreadCount] = useState(0);
    const [isMenuOpen, setIsMenuOpen] = useState(false);

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

    const filteredShelves = useMemo(() => {
        if (!searchQuery.trim()) {
            return [...shelves, { id: 'create-shelf', type: 'special-create', name: 'New Shelf' }];
        }
        const q = searchQuery.toLowerCase();
        return shelves.filter(s => s.name?.toLowerCase().includes(q));
    }, [shelves, searchQuery]);



    const styles = useMemo(() => createStyles({ colors, spacing, typography, shadows, radius }), [colors, spacing, typography, shadows, radius]);

    const handleOpenShelf = (shelf) => {
        if (shelf.type === 'special-create') {
            navigation.navigate('ShelfCreateScreen');
        } else {
            navigation.navigate('ShelfDetail', { id: shelf.id, title: shelf.name });
        }
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
                    <CategoryIcon type={item.type} size={28} />
                </View>
                <Text style={styles.gridTitle} numberOfLines={2}>{item.name}</Text>
                <Text style={styles.gridMeta}>{item.itemCount || 0} items</Text>
            </TouchableOpacity>
        );
    };

    const renderListItem = ({ item }) => {
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

        return (
            <TouchableOpacity
                style={styles.listCard}
                onPress={() => handleOpenShelf(item)}
                activeOpacity={0.8}
            >
                <View style={styles.listIcon}>
                    <CategoryIcon type={item.type} size={22} />
                </View>
                <View style={styles.listContent}>
                    <Text style={styles.listTitle} numberOfLines={1}>{item.name}</Text>
                    <Text style={styles.listMeta}>{item.itemCount || 0} items • {item.type || 'Collection'}</Text>
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

    return (
        <SafeAreaView style={styles.screen} edges={['top']}>
            <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />

            {/* Header */}
            <View style={styles.header}>
                <View>
                    <Text style={styles.headerTitle}>My Shelves</Text>
                    <Text style={styles.headerSubtitle}>{shelves.length} collection{shelves.length !== 1 ? 's' : ''}</Text>
                </View>
                <View style={styles.headerRight}>
                    <TouchableOpacity
                        style={styles.viewToggle}
                        onPress={() => setViewMode(v => v === 'grid' ? 'list' : 'grid')}
                    >
                        <Ionicons name={viewMode === 'grid' ? 'list' : 'grid'} size={22} color={colors.text} />
                    </TouchableOpacity>
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
                    <TouchableOpacity onPress={() => setIsMenuOpen(true)}>
                        <Ionicons name="person-circle-outline" size={28} color={colors.text} />
                    </TouchableOpacity>
                </View>
            </View>

            {/* Search */}
            <View style={styles.searchContainer}>
                <View style={styles.searchBox}>
                    <Ionicons name="search" size={18} color={colors.textMuted} />
                    <TextInput
                        style={styles.searchInput}
                        placeholder="Search shelves..."
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
                    data={filteredShelves}
                    keyExtractor={(item) => String(item.id)}
                    renderItem={viewMode === 'grid' ? renderGridItem : renderListItem}
                    numColumns={viewMode === 'grid' ? 2 : 1}
                    key={viewMode}
                    contentContainerStyle={styles.listContainer}
                    columnWrapperStyle={viewMode === 'grid' ? styles.gridRow : undefined}
                    refreshControl={
                        <RefreshControl
                            refreshing={refreshing}
                            onRefresh={onRefresh}
                            tintColor={colors.primary}
                            colors={[colors.primary]}
                        />
                    }
                    showsVerticalScrollIndicator={false}
                    ListEmptyComponent={renderEmpty}
                />
            )}

            {/* Account Slide Menu */}
            <AccountSlideMenu
                isVisible={isMenuOpen}
                onClose={() => setIsMenuOpen(false)}
                navigation={navigation}
                user={user}
            />
        </SafeAreaView>
    );
}

const createStyles = ({ colors, spacing, typography, shadows, radius }) => StyleSheet.create({
    screen: {
        flex: 1,
        backgroundColor: colors.background,
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
    searchContainer: {
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
});
