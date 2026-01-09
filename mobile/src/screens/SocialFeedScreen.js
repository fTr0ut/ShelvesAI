import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    RefreshControl,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
    StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AuthContext } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { apiRequest } from '../services/api';

const FILTERS = [
    { key: 'all', label: 'All' },
    { key: 'friends', label: 'Friends' },
    { key: 'public', label: 'Discover' },
];

// --- Helpers ---
function normalizeDate(value) {
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.valueOf()) ? date.getTime() : 0;
}

function formatRelativeTime(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'now';
    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) return `${diffHours}h`;
    if (diffDays < 7) return `${diffDays}d`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function getItemPreview(entry) {
    const collectable = entry.collectable || entry.item || entry.collectableSnapshot || null;
    const manual = entry.manual || entry.manualItem || entry.manualSnapshot || null;
    const title = collectable?.title || collectable?.name || manual?.title || manual?.name || entry?.title || 'Untitled';
    return title;
}

// --- Component ---
export default function SocialFeedScreen({ navigation }) {
    const { token, apiBase } = useContext(AuthContext);
    const { colors, spacing, typography, shadows, isDark } = useTheme();

    const [publicEntries, setPublicEntries] = useState([]);
    const [friendEntries, setFriendEntries] = useState([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState('');
    const [activeFilter, setActiveFilter] = useState('all');

    const load = useCallback(async (opts = {}) => {
        if (!token) {
            setPublicEntries([]);
            setFriendEntries([]);
            setLoading(false);
            return;
        }
        if (!opts.silent) setLoading(true);

        const requests = await Promise.allSettled([
            apiRequest({ apiBase, path: '/api/feed?scope=global', token }),
            apiRequest({ apiBase, path: '/api/feed?scope=friends', token }),
        ]);

        const [globalResult, friendsResult] = requests;
        if (globalResult.status === 'fulfilled') {
            setPublicEntries(globalResult.value.entries || []);
        }
        if (friendsResult.status === 'fulfilled') {
            setFriendEntries(friendsResult.value.entries || []);
        }
        if (globalResult.status === 'rejected' && friendsResult.status === 'rejected') {
            setError('Unable to load feed');
        } else {
            setError('');
        }
        setLoading(false);
        setRefreshing(false);
    }, [apiBase, token]);

    useEffect(() => { load(); }, [load]);

    const onRefresh = () => {
        setRefreshing(true);
        load({ silent: true });
    };

    const combinedEntries = useMemo(() => {
        const all = [
            ...publicEntries.map(e => ({ ...e, __origin: 'public' })),
            ...friendEntries.map(e => ({ ...e, __origin: 'friends' })),
        ];
        let filtered = activeFilter === 'all' ? all : all.filter(e => e.__origin === activeFilter);
        return filtered.sort((a, b) => normalizeDate(b.shelf?.updatedAt) - normalizeDate(a.shelf?.updatedAt));
    }, [publicEntries, friendEntries, activeFilter]);

    const styles = useMemo(() => createStyles({ colors, spacing, typography, shadows }), [colors, spacing, typography, shadows]);

    const renderItem = ({ item }) => {
        const { shelf, owner, items } = item;
        const timeAgo = formatRelativeTime(shelf?.updatedAt);
        const displayName = owner?.name || owner?.username || 'Someone';
        const initial = displayName.charAt(0).toUpperCase();
        const previewItems = (items || []).slice(0, 3);

        return (
            <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => navigation.navigate('ShelfDetail', { id: shelf?.id, title: shelf?.name })}
                style={styles.feedCard}
            >
                {/* Thread-style header */}
                <View style={styles.cardHeader}>
                    <View style={styles.avatar}>
                        <Text style={styles.avatarText}>{initial}</Text>
                    </View>
                    <View style={styles.headerContent}>
                        <View style={styles.headerTop}>
                            <Text style={styles.username}>{displayName}</Text>
                            <Text style={styles.timestamp}>{timeAgo}</Text>
                        </View>
                        <Text style={styles.shelfAction}>
                            updated <Text style={styles.shelfName}>{shelf?.name || 'a shelf'}</Text>
                        </Text>
                    </View>
                </View>

                {/* Content preview */}
                {shelf?.description ? (
                    <Text style={styles.description} numberOfLines={2}>{shelf.description}</Text>
                ) : null}

                {/* Items preview - Goodreads style */}
                {previewItems.length > 0 && (
                    <View style={styles.itemsPreview}>
                        {previewItems.map((entry, idx) => (
                            <View key={idx} style={styles.itemChip}>
                                <Ionicons name="book" size={12} color={colors.primary} />
                                <Text style={styles.itemTitle} numberOfLines={1}>{getItemPreview(entry)}</Text>
                            </View>
                        ))}
                        {(items?.length || 0) > 3 && (
                            <Text style={styles.moreItems}>+{items.length - 3} more</Text>
                        )}
                    </View>
                )}

                {/* Footer */}
                <View style={styles.cardFooter}>
                    <View style={styles.footerStat}>
                        <Ionicons name="library-outline" size={14} color={colors.textMuted} />
                        <Text style={styles.footerText}>{shelf?.itemCount || 0} items</Text>
                    </View>
                    <View style={styles.footerStat}>
                        <Ionicons name="globe-outline" size={14} color={colors.textMuted} />
                        <Text style={styles.footerText}>{shelf?.type || 'Collection'}</Text>
                    </View>
                </View>
            </TouchableOpacity>
        );
    };

    const renderEmpty = () => {
        if (loading) return null;
        return (
            <View style={styles.emptyState}>
                <Ionicons name="newspaper-outline" size={48} color={colors.textMuted} />
                <Text style={styles.emptyTitle}>Your feed is quiet</Text>
                <Text style={styles.emptyText}>
                    {activeFilter === 'friends'
                        ? 'Add friends to see their collections'
                        : 'Collections from other users will appear here'}
                </Text>
                {activeFilter === 'friends' && (
                    <TouchableOpacity
                        style={styles.emptyButton}
                        onPress={() => navigation.navigate('FriendSearch')}
                    >
                        <Text style={styles.emptyButtonText}>Find Friends</Text>
                    </TouchableOpacity>
                )}
            </View>
        );
    };

    return (
        <SafeAreaView style={styles.screen} edges={['top']}>
            <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />

            {/* Header */}
            <View style={styles.header}>
                <Text style={styles.headerTitle}>Feed</Text>
                <View style={styles.headerRight}>
                    <TouchableOpacity onPress={() => navigation.navigate('FriendSearch')} style={styles.headerButton}>
                        <Ionicons name="search" size={22} color={colors.text} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => navigation.navigate('Account')} style={styles.headerButton}>
                        <Ionicons name="person-circle-outline" size={26} color={colors.text} />
                    </TouchableOpacity>
                </View>
            </View>

            {/* Filter Tabs - Threads style */}
            <View style={styles.filterBar}>
                {FILTERS.map(filter => {
                    const active = activeFilter === filter.key;
                    return (
                        <TouchableOpacity
                            key={filter.key}
                            onPress={() => setActiveFilter(filter.key)}
                            style={[styles.filterTab, active && styles.filterTabActive]}
                        >
                            <Text style={[styles.filterText, active && styles.filterTextActive]}>
                                {filter.label}
                            </Text>
                        </TouchableOpacity>
                    );
                })}
            </View>

            {/* Error */}
            {error ? (
                <View style={styles.errorBanner}>
                    <Text style={styles.errorText}>{error}</Text>
                </View>
            ) : null}

            {/* Content */}
            {loading && !refreshing ? (
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color={colors.primary} />
                </View>
            ) : (
                <FlatList
                    data={combinedEntries}
                    keyExtractor={(item, idx) => item.shelf?.id ? `${item.shelf.id}-${item.__origin}` : `entry-${idx}`}
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
                    ItemSeparatorComponent={() => <View style={styles.separator} />}
                />
            )}
        </SafeAreaView>
    );
}

const createStyles = ({ colors, spacing, typography, shadows }) => StyleSheet.create({
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
        fontFamily: typography.bold || 'System',
        fontWeight: '700',
        color: colors.text,
    },
    headerRight: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
    },
    headerButton: {
        padding: spacing.xs,
    },
    filterBar: {
        flexDirection: 'row',
        paddingHorizontal: spacing.md,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    filterTab: {
        flex: 1,
        paddingVertical: spacing.sm + 4,
        alignItems: 'center',
        borderBottomWidth: 2,
        borderBottomColor: 'transparent',
    },
    filterTabActive: {
        borderBottomColor: colors.text,
    },
    filterText: {
        fontSize: 15,
        fontWeight: '500',
        color: colors.textMuted,
    },
    filterTextActive: {
        color: colors.text,
        fontWeight: '600',
    },
    listContent: {
        padding: spacing.md,
        paddingBottom: 100,
    },
    feedCard: {
        backgroundColor: colors.surface,
        borderRadius: 12,
        padding: spacing.md,
        ...shadows.sm,
    },
    separator: {
        height: spacing.sm,
    },
    cardHeader: {
        flexDirection: 'row',
        marginBottom: spacing.sm,
    },
    avatar: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: colors.primary,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: spacing.sm,
    },
    avatarText: {
        color: colors.textInverted,
        fontSize: 16,
        fontWeight: '600',
    },
    headerContent: {
        flex: 1,
    },
    headerTop: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    username: {
        fontSize: 15,
        fontWeight: '600',
        color: colors.text,
    },
    timestamp: {
        fontSize: 13,
        color: colors.textMuted,
    },
    shelfAction: {
        fontSize: 14,
        color: colors.textSecondary,
        marginTop: 2,
    },
    shelfName: {
        fontWeight: '600',
        color: colors.text,
    },
    description: {
        fontSize: 14,
        color: colors.textSecondary,
        lineHeight: 20,
        marginBottom: spacing.sm,
    },
    itemsPreview: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: spacing.xs,
        marginBottom: spacing.sm,
    },
    itemChip: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.surfaceElevated,
        paddingHorizontal: spacing.sm,
        paddingVertical: 4,
        borderRadius: 16,
        gap: 4,
    },
    itemTitle: {
        fontSize: 12,
        color: colors.textSecondary,
        maxWidth: 120,
    },
    moreItems: {
        fontSize: 12,
        color: colors.primary,
        fontWeight: '500',
        alignSelf: 'center',
    },
    cardFooter: {
        flexDirection: 'row',
        gap: spacing.md,
        paddingTop: spacing.sm,
        borderTopWidth: 1,
        borderTopColor: colors.border,
    },
    footerStat: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    footerText: {
        fontSize: 12,
        color: colors.textMuted,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
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
        lineHeight: 20,
    },
    emptyButton: {
        marginTop: spacing.lg,
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.sm,
        backgroundColor: colors.primary,
        borderRadius: 20,
    },
    emptyButtonText: {
        color: colors.textInverted,
        fontWeight: '600',
        fontSize: 14,
    },
    errorBanner: {
        backgroundColor: colors.error + '15',
        padding: spacing.sm,
        margin: spacing.md,
        borderRadius: 8,
    },
    errorText: {
        color: colors.error,
        textAlign: 'center',
        fontSize: 14,
    },
});
