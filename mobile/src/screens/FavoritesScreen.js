import React, { useContext, useEffect, useState, useMemo, useCallback } from 'react';
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Image,
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

export default function FavoritesScreen({ navigation, route }) {
    const { token, apiBase } = useContext(AuthContext);
    const { colors, spacing, typography, shadows, radius, isDark } = useTheme();

    const targetUserId = route.params?.userId;
    const targetUsername = route.params?.username;
    // We can pass firstName for better UI
    const targetFirstName = route.params?.firstName;

    // Valid if we are targeting someone else
    const isViewingOther = !!(targetUserId || targetUsername);
    const displayName = targetFirstName || targetUsername || 'User';

    const [favorites, setFavorites] = useState([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    const styles = useMemo(
        () => createStyles({ colors, spacing, typography, shadows, radius }),
        [colors, spacing, typography, shadows, radius]
    );

    const loadFavorites = useCallback(async (isRefresh = false) => {
        try {
            if (!refreshing && !isRefresh) setLoading(true);

            let path = '/api/favorites';

            if (targetUserId) {
                path = `/api/favorites/user/${targetUserId}`;
            } else if (targetUsername) {
                // Determine ID if only username provided - similar logic to WishlistsScreen could apply, 
                // but simpler to rely on ProfileScreen passing userId. 
                // If we must support username-only deep links later, we'd need a profile lookup here first.
                // For now, let's assume specific navigation from Profile passes userId or handle username lookup if critical.
                // Re-using logic from WishlistsScreen for robustness:
                const profileData = await apiRequest({ apiBase, path: `/api/profile/${targetUsername}`, token });
                if (profileData.profile?.id) {
                    path = `/api/favorites/user/${profileData.profile.id}`;
                }
            }

            const data = await apiRequest({
                apiBase,
                path,
                token,
            });
            setFavorites(data.favorites || []);
        } catch (e) {
            console.warn('Failed to load favorites:', e);
            if (!isRefresh) Alert.alert('Error', 'Failed to load favorites');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [apiBase, token, refreshing, targetUserId, targetUsername]);

    useEffect(() => {
        loadFavorites();
    }, [loadFavorites]);

    const onRefresh = () => {
        setRefreshing(true);
        loadFavorites();
    };

    const handleRemoveFavorite = async (collectableId) => {
        Alert.alert('Remove Favorite', 'Remove this item from your favorites?', [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Remove',
                style: 'destructive',
                onPress: async () => {
                    try {
                        await apiRequest({
                            apiBase,
                            path: `/api/favorites/${collectableId}`,
                            method: 'DELETE',
                            token,
                        });
                        setFavorites(prev => prev.filter(f => f.collectable?.id !== collectableId));
                    } catch (e) {
                        Alert.alert('Error', e.message);
                    }
                },
            },
        ]);
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

    const buildCoverUri = (pathOrUrl) => {
        if (!pathOrUrl) return null;
        if (/^https?:/i.test(pathOrUrl)) return pathOrUrl;
        const trimmed = pathOrUrl.replace(/^\/+/, '');
        const resource = trimmed.startsWith('media/') ? trimmed : `media/${trimmed}`;
        if (!apiBase) return `/${resource}`;
        return `${apiBase.replace(/\/+$/, '')}/${resource}`;
    };

    const renderItem = ({ item }) => {
        const collectable = item.collectable || {};
        const coverUri = buildCoverUri(collectable.coverMediaPath || collectable.coverUrl);

        return (
            <TouchableOpacity
                style={styles.itemCard}
                onPress={() => navigation.navigate('CollectableDetail', { item: { collectable } })}
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
                            <Ionicons name={getIconForType(collectable.kind)} size={22} color={colors.primary} />
                        </View>
                    )}
                </View>
                <View style={styles.itemContent}>
                    <Text style={styles.itemTitle} numberOfLines={1}>{collectable.title || 'Untitled'}</Text>
                    {collectable.primaryCreator ? (
                        <Text style={styles.itemSubtitle} numberOfLines={1}>{collectable.primaryCreator}</Text>
                    ) : null}
                    <View style={styles.itemMeta}>
                        <Ionicons name="heart" size={14} color={colors.error} />
                        <Text style={styles.itemMetaText}>Favorited</Text>
                    </View>
                </View>
                {!isViewingOther && (
                    <TouchableOpacity
                        onPress={() => handleRemoveFavorite(collectable.id)}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                        <Ionicons name="close" size={18} color={colors.textMuted} />
                    </TouchableOpacity>
                )}
            </TouchableOpacity>
        );
    };

    const renderEmpty = () => (
        <View style={styles.emptyState}>
            <Ionicons name="heart-outline" size={56} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>No favorites yet</Text>
            <Text style={styles.emptyText}>
                {isViewingOther
                    ? `${displayName} hasn't favorited any items yet`
                    : 'Tap the heart icon on any item in your shelves to add it here'}
            </Text>
        </View>
    );

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
                    <Text style={styles.headerTitle}>
                        {isViewingOther ? `${displayName}'s Favorites` : 'My Favorites'}
                    </Text>
                    <Text style={styles.headerSubtitle}>{favorites.length} item{favorites.length !== 1 ? 's' : ''}</Text>
                </View>
                <View style={{ width: 40 }} />
            </View>

            <FlatList
                data={favorites}
                keyExtractor={(item) => String(item.id || item.collectable?.id)}
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
            />
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
        listContent: {
            padding: spacing.md,
            paddingBottom: spacing.xl,
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
        itemMeta: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            marginTop: 4,
        },
        itemMetaText: {
            fontSize: 12,
            color: colors.error,
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
    });
