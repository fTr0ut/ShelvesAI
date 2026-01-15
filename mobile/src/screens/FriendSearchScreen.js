import React, { useCallback, useContext, useEffect, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    Image,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
    StatusBar,
    Alert,
    SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AuthContext } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { apiRequest } from '../services/api';

export default function FriendSearchScreen({ route, navigation }) {
    const { initialQuery } = route.params || {};
    const { token, apiBase } = useContext(AuthContext);
    const { colors, spacing, typography, shadows, radius, isDark } = useTheme();

    const [query, setQuery] = useState(initialQuery || '');
    const [activeTab, setActiveTab] = useState('friends'); // 'friends' or 'items'
    const [friendResults, setFriendResults] = useState([]);
    const [itemResults, setItemResults] = useState([]);
    const [loading, setLoading] = useState(false);
    const [searched, setSearched] = useState(false);
    const [sending, setSending] = useState({});

    const styles = createStyles({ colors, spacing, typography, shadows, radius });

    // Auto-search if initial query provided
    useEffect(() => {
        if (initialQuery?.trim()) {
            handleSearch();
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const handleSearch = useCallback(async () => {
        const q = query.trim();
        if (!q) return;

        try {
            setLoading(true);
            setSearched(true);

            // Parallel search for both friends and items
            const [friendsRes, itemsRes] = await Promise.all([
                apiRequest({
                    apiBase,
                    path: `/api/friends/search?q=${encodeURIComponent(q)}&wildcard=true`,
                    token,
                }),
                apiRequest({
                    apiBase,
                    path: `/api/collectables?q=${encodeURIComponent(q)}&wildcard=true&limit=20`,
                    token,
                }),
            ]);

            setFriendResults(Array.isArray(friendsRes?.users) ? friendsRes.users : []);
            setItemResults(Array.isArray(itemsRes?.results) ? itemsRes.results : []);
        } catch (e) {
            Alert.alert('Error', e.message);
        } finally {
            setLoading(false);
        }
    }, [apiBase, token, query]);

    const handleSendRequest = useCallback(async (targetUserId) => {
        setSending(prev => ({ ...prev, [targetUserId]: true }));
        try {
            await apiRequest({
                apiBase,
                path: '/api/friends/request',
                method: 'POST',
                token,
                body: { targetUserId },
            });
            // Update result to show pending
            setResults(prev => prev.map(u => u.id === targetUserId ? { ...u, requestSent: true } : u));
        } catch (e) {
            Alert.alert('Error', e.message);
        } finally {
            setSending(prev => ({ ...prev, [targetUserId]: false }));
        }
    }, [apiBase, token]);

    const renderUser = ({ item }) => {
        const displayName = item.firstName && item.lastName
            ? `${item.firstName} ${item.lastName}`
            : item.name || item.username;
        const initial = (displayName || '?').charAt(0).toUpperCase();
        const isSending = sending[item.id];
        const isPending = item.requestSent || item.isFriend === 'pending';
        const isFriend = item.isFriend === true;

        return (
            <TouchableOpacity
                style={styles.userCard}
                onPress={() => navigation.navigate('Profile', { username: item.username })}
            >
                <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{initial}</Text>
                </View>
                <View style={styles.userInfo}>
                    <Text style={styles.userName}>{displayName}</Text>
                    <Text style={styles.userHandle}>@{item.username}</Text>
                </View>
                {isFriend ? (
                    <View style={styles.friendBadge}>
                        <Ionicons name="checkmark-circle" size={16} color={colors.success} />
                        <Text style={styles.friendBadgeText}>Friends</Text>
                    </View>
                ) : isPending ? (
                    <View style={styles.pendingBadge}>
                        <Text style={styles.pendingBadgeText}>Pending</Text>
                    </View>
                ) : (
                    <TouchableOpacity
                        style={styles.addButton}
                        onPress={(e) => { e.stopPropagation(); handleSendRequest(item.id); }}
                        disabled={isSending}
                    >
                        {isSending ? (
                            <ActivityIndicator size="small" color={colors.textInverted} />
                        ) : (
                            <>
                                <Ionicons name="person-add" size={16} color={colors.textInverted} />
                                <Text style={styles.addButtonText}>Add</Text>
                            </>
                        )}
                    </TouchableOpacity>
                )}
            </TouchableOpacity>
        );
    };

    const renderItem = ({ item }) => {
        const coverUrl = item.coverMediaPath
            ? `${apiBase}/media/${item.coverMediaPath}`
            : item.coverUrl;

        return (
            <TouchableOpacity
                style={styles.itemCard}
                onPress={() => navigation.navigate('CollectableDetail', { item: { collectable: item } })}
            >
                {coverUrl ? (
                    <Image source={{ uri: coverUrl }} style={styles.itemCover} />
                ) : (
                    <View style={[styles.itemCover, styles.itemCoverFallback]}>
                        <Ionicons name="book" size={24} color={colors.primary} />
                    </View>
                )}
                <View style={styles.itemInfo}>
                    <Text style={styles.itemTitle} numberOfLines={2}>{item.title || 'Untitled'}</Text>
                    {item.primaryCreator && (
                        <Text style={styles.itemCreator} numberOfLines={1}>{item.primaryCreator}</Text>
                    )}
                    {item.kind && (
                        <Text style={styles.itemKind}>{item.kind}</Text>
                    )}
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>
        );
    };


    return (
        <SafeAreaView style={styles.screen}>
            <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />

            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
                    <Ionicons name="arrow-back" size={22} color={colors.text} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Search</Text>
                <View style={{ width: 40 }} />
            </View>

            {/* Search */}
            <View style={styles.searchContainer}>
                <View style={styles.searchBox}>
                    <Ionicons name="search" size={18} color={colors.textMuted} />
                    <TextInput
                        style={styles.searchInput}
                        value={query}
                        onChangeText={setQuery}
                        placeholder="Search friends & items..."
                        placeholderTextColor={colors.textMuted}
                        autoCapitalize="none"
                        autoCorrect={false}
                        returnKeyType="search"
                        onSubmitEditing={handleSearch}
                    />
                    {query.length > 0 && (
                        <TouchableOpacity onPress={() => { setQuery(''); setFriendResults([]); setItemResults([]); setSearched(false); }}>
                            <Ionicons name="close-circle" size={18} color={colors.textMuted} />
                        </TouchableOpacity>
                    )}
                </View>
                <TouchableOpacity style={styles.searchButton} onPress={handleSearch}>
                    <Text style={styles.searchButtonText}>Search</Text>
                </TouchableOpacity>
            </View>

            {/* Tabs */}
            <View style={styles.tabBar}>
                <TouchableOpacity
                    style={[styles.tab, activeTab === 'friends' && styles.tabActive]}
                    onPress={() => setActiveTab('friends')}
                >
                    <Ionicons name="people" size={18} color={activeTab === 'friends' ? colors.primary : colors.textMuted} />
                    <Text style={[styles.tabText, activeTab === 'friends' && styles.tabTextActive]}>
                        Friends {searched && `(${friendResults.length})`}
                    </Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={[styles.tab, activeTab === 'items' && styles.tabActive]}
                    onPress={() => setActiveTab('items')}
                >
                    <Ionicons name="library" size={18} color={activeTab === 'items' ? colors.primary : colors.textMuted} />
                    <Text style={[styles.tabText, activeTab === 'items' && styles.tabTextActive]}>
                        Items {searched && `(${itemResults.length})`}
                    </Text>
                </TouchableOpacity>
            </View>

            {/* Results */}
            {loading ? (
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color={colors.primary} />
                </View>
            ) : activeTab === 'friends' ? (
                <FlatList
                    data={friendResults}
                    keyExtractor={(item) => String(item.id)}
                    renderItem={renderUser}
                    contentContainerStyle={styles.listContent}
                    ListEmptyComponent={
                        searched ? (
                            <View style={styles.emptyState}>
                                <Ionicons name="people-outline" size={48} color={colors.textMuted} />
                                <Text style={styles.emptyTitle}>No users found</Text>
                                <Text style={styles.emptyText}>Try a different search term</Text>
                            </View>
                        ) : (
                            <View style={styles.emptyState}>
                                <Ionicons name="search-outline" size={48} color={colors.textMuted} />
                                <Text style={styles.emptyTitle}>Search for collectors</Text>
                                <Text style={styles.emptyText}>Find friends to share your shelves with</Text>
                            </View>
                        )
                    }
                />
            ) : (
                <FlatList
                    data={itemResults}
                    keyExtractor={(item) => String(item.id)}
                    renderItem={renderItem}
                    contentContainerStyle={styles.listContent}
                    ListEmptyComponent={
                        searched ? (
                            <View style={styles.emptyState}>
                                <Ionicons name="library-outline" size={48} color={colors.textMuted} />
                                <Text style={styles.emptyTitle}>No items found</Text>
                                <Text style={styles.emptyText}>Try a different search term</Text>
                            </View>
                        ) : (
                            <View style={styles.emptyState}>
                                <Ionicons name="search-outline" size={48} color={colors.textMuted} />
                                <Text style={styles.emptyTitle}>Search the catalog</Text>
                                <Text style={styles.emptyText}>Find books, movies, games, and more</Text>
                            </View>
                        )
                    }
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
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
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
    headerTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: colors.text,
    },
    searchContainer: {
        flexDirection: 'row',
        paddingHorizontal: spacing.md,
        paddingBottom: spacing.md,
        gap: spacing.sm,
    },
    searchBox: {
        flex: 1,
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
    },
    searchButton: {
        backgroundColor: colors.primary,
        paddingHorizontal: spacing.md,
        borderRadius: radius.lg,
        justifyContent: 'center',
    },
    searchButtonText: {
        color: colors.textInverted,
        fontWeight: '600',
        fontSize: 14,
    },
    listContent: {
        padding: spacing.md,
        paddingTop: 0,
    },
    userCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.surface,
        borderRadius: radius.lg,
        padding: spacing.md,
        marginBottom: spacing.sm,
        ...shadows.sm,
    },
    avatar: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: colors.primary,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: spacing.md,
    },
    avatarText: {
        fontSize: 18,
        fontWeight: '600',
        color: colors.textInverted,
    },
    userInfo: {
        flex: 1,
    },
    userName: {
        fontSize: 15,
        fontWeight: '600',
        color: colors.text,
    },
    userHandle: {
        fontSize: 13,
        color: colors.textMuted,
        marginTop: 1,
    },
    addButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: colors.primary,
        paddingHorizontal: spacing.sm + 4,
        paddingVertical: spacing.xs + 2,
        borderRadius: 16,
    },
    addButtonText: {
        color: colors.textInverted,
        fontSize: 13,
        fontWeight: '600',
    },
    friendBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    friendBadgeText: {
        color: colors.success,
        fontSize: 13,
        fontWeight: '500',
    },
    pendingBadge: {
        backgroundColor: colors.warning + '20',
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs,
        borderRadius: 12,
    },
    pendingBadgeText: {
        color: colors.warning,
        fontSize: 12,
        fontWeight: '500',
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    emptyState: {
        alignItems: 'center',
        paddingTop: spacing['2xl'],
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
        marginTop: spacing.xs,
    },
    // Tab styles
    tabBar: {
        flexDirection: 'row',
        marginHorizontal: spacing.md,
        marginBottom: spacing.sm,
        backgroundColor: colors.surface,
        borderRadius: radius.lg,
        padding: 4,
        ...shadows.sm,
    },
    tab: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingVertical: spacing.sm,
        borderRadius: radius.lg - 2,
    },
    tabActive: {
        backgroundColor: colors.background,
    },
    tabText: {
        fontSize: 14,
        fontWeight: '500',
        color: colors.textMuted,
    },
    tabTextActive: {
        color: colors.primary,
        fontWeight: '600',
    },
    // Item card styles
    itemCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.surface,
        borderRadius: radius.lg,
        padding: spacing.md,
        marginBottom: spacing.sm,
        gap: spacing.md,
        ...shadows.sm,
    },
    itemCover: {
        width: 50,
        height: 70,
        borderRadius: 6,
        backgroundColor: colors.surfaceElevated,
    },
    itemCoverFallback: {
        justifyContent: 'center',
        alignItems: 'center',
    },
    itemInfo: {
        flex: 1,
    },
    itemTitle: {
        fontSize: 15,
        fontWeight: '600',
        color: colors.text,
    },
    itemCreator: {
        fontSize: 13,
        color: colors.textMuted,
        marginTop: 2,
    },
    itemKind: {
        fontSize: 11,
        color: colors.primary,
        textTransform: 'capitalize',
        marginTop: 4,
    },
});
