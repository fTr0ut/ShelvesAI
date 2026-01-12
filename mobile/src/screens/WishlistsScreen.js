import React, { useContext, useEffect, useMemo, useState, useCallback } from 'react';
import {
    ActivityIndicator,
    Alert,
    FlatList,
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

export default function WishlistsScreen({ navigation }) {
    const { token, apiBase } = useContext(AuthContext);
    const { colors, spacing, typography, shadows, radius, isDark } = useTheme();

    const [wishlists, setWishlists] = useState([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    const styles = useMemo(
        () => createStyles({ colors, spacing, typography, shadows, radius }),
        [colors, spacing, typography, shadows, radius]
    );

    useEffect(() => {
        loadWishlists();
    }, []);

    const loadWishlists = async (isRefresh = false) => {
        try {
            if (isRefresh) setRefreshing(true);
            else setLoading(true);

            const data = await apiRequest({ apiBase, path: '/api/wishlists', token });
            setWishlists(data.wishlists || []);
        } catch (e) {
            if (!isRefresh) Alert.alert('Error', 'Failed to load wishlists');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    const handleRefresh = () => loadWishlists(true);

    const handleDelete = useCallback(async (wishlistId) => {
        Alert.alert('Delete Wishlist', 'Are you sure you want to delete this wishlist?', [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Delete',
                style: 'destructive',
                onPress: async () => {
                    try {
                        await apiRequest({
                            apiBase,
                            path: `/api/wishlists/${wishlistId}`,
                            method: 'DELETE',
                            token,
                        });
                        setWishlists((prev) => prev.filter((w) => w.id !== wishlistId));
                    } catch (e) {
                        Alert.alert('Error', e.message);
                    }
                },
            },
        ]);
    }, [apiBase, token]);

    const getVisibilityIcon = (visibility) => {
        switch (visibility) {
            case 'public':
                return 'globe';
            case 'friends':
                return 'people';
            default:
                return 'lock-closed';
        }
    };

    const renderWishlistCard = ({ item }) => (
        <TouchableOpacity
            style={styles.wishlistCard}
            onPress={() => navigation.navigate('Wishlist', { wishlistId: item.id })}
            onLongPress={() => handleDelete(item.id)}
        >
            <View style={styles.wishlistIcon}>
                <Ionicons name="heart" size={24} color={colors.primary} />
            </View>
            <View style={styles.wishlistInfo}>
                <Text style={styles.wishlistName} numberOfLines={1}>
                    {item.name}
                </Text>
                <View style={styles.wishlistMeta}>
                    <Text style={styles.wishlistMetaText}>
                        {item.itemCount || 0} items
                    </Text>
                    <View style={styles.visibilityBadge}>
                        <Ionicons
                            name={getVisibilityIcon(item.visibility)}
                            size={12}
                            color={colors.textMuted}
                        />
                        <Text style={styles.visibilityText}>{item.visibility}</Text>
                    </View>
                </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </TouchableOpacity>
    );

    if (loading) {
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
                <Text style={styles.headerTitle}>My Wishlists</Text>
                <TouchableOpacity
                    onPress={() => navigation.navigate('WishlistCreate')}
                    style={styles.addButton}
                >
                    <Ionicons name="add" size={24} color={colors.primary} />
                </TouchableOpacity>
            </View>

            {wishlists.length === 0 ? (
                <View style={styles.emptyState}>
                    <Ionicons name="heart-outline" size={48} color={colors.textMuted} />
                    <Text style={styles.emptyTitle}>No wishlists yet</Text>
                    <Text style={styles.emptySubtitle}>Create a wishlist to track items you want</Text>
                    <TouchableOpacity
                        style={styles.createButton}
                        onPress={() => navigation.navigate('WishlistCreate')}
                    >
                        <Ionicons name="add" size={20} color={colors.textInverted} />
                        <Text style={styles.createButtonText}>Create Wishlist</Text>
                    </TouchableOpacity>
                </View>
            ) : (
                <FlatList
                    data={wishlists}
                    keyExtractor={(item) => item.id.toString()}
                    renderItem={renderWishlistCard}
                    contentContainerStyle={styles.listContent}
                    refreshing={refreshing}
                    onRefresh={handleRefresh}
                />
            )}
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
            justifyContent: 'space-between',
            padding: spacing.md,
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
        addButton: {
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
        listContent: {
            padding: spacing.md,
            paddingTop: 0,
        },
        wishlistCard: {
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: colors.surface,
            padding: spacing.md,
            borderRadius: radius.lg,
            marginBottom: spacing.sm,
            ...shadows.sm,
        },
        wishlistIcon: {
            width: 48,
            height: 48,
            borderRadius: radius.md,
            backgroundColor: colors.primary + '20',
            justifyContent: 'center',
            alignItems: 'center',
            marginRight: spacing.md,
        },
        wishlistInfo: {
            flex: 1,
        },
        wishlistName: {
            fontSize: 16,
            fontWeight: '600',
            color: colors.text,
            marginBottom: 4,
        },
        wishlistMeta: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
        },
        wishlistMetaText: {
            fontSize: 13,
            color: colors.textMuted,
        },
        visibilityBadge: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            backgroundColor: colors.background,
            paddingHorizontal: spacing.xs + 2,
            paddingVertical: 2,
            borderRadius: radius.sm,
        },
        visibilityText: {
            fontSize: 11,
            color: colors.textMuted,
            textTransform: 'capitalize',
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
            marginBottom: spacing.lg,
        },
        createButton: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
            backgroundColor: colors.primary,
            paddingHorizontal: spacing.lg,
            paddingVertical: spacing.sm + 2,
            borderRadius: radius.md,
        },
        createButtonText: {
            fontSize: 15,
            fontWeight: '600',
            color: colors.textInverted,
        },
    });
