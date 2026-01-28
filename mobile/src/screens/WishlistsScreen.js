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
    TextInput,
    Modal,
    KeyboardAvoidingView,
    Platform,
    Keyboard,
    TouchableWithoutFeedback,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AuthContext } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { apiRequest } from '../services/api';

const SORT_OPTIONS = [
    { key: 'name_asc', label: 'Name A-Z' },
    { key: 'name_desc', label: 'Name Z-A' },
    { key: 'count_desc', label: 'Most Items' },
    { key: 'count_asc', label: 'Fewest Items' },
    { key: 'newest', label: 'Newest First' },
];

export default function WishlistsScreen({ navigation, route }) {
    const { token, apiBase, user: currentUser } = useContext(AuthContext);
    const { colors, spacing, typography, shadows, radius, isDark } = useTheme();

    // Determine if viewing own or another user's wishlists
    const targetUserId = route.params?.userId;
    const targetUsername = route.params?.username;
    const targetFirstName = route.params?.firstName;
    const isOwnProfile = !targetUserId && !targetUsername;

    const [wishlists, setWishlists] = useState([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [targetUser, setTargetUser] = useState(null);

    // Search & Sort State
    const [searchQuery, setSearchQuery] = useState('');
    const [sortKey, setSortKey] = useState('newest');
    const [sortOpen, setSortOpen] = useState(false);

    // Create Modal State
    const [createModalVisible, setCreateModalVisible] = useState(false);
    const [newWishlistName, setNewWishlistName] = useState('');
    const [creating, setCreating] = useState(false);

    const styles = useMemo(
        () => createStyles({ colors, spacing, typography, shadows, radius }),
        [colors, spacing, typography, shadows, radius]
    );

    useEffect(() => {
        loadWishlists();
    }, [targetUserId, targetUsername]);

    const loadWishlists = async (isRefresh = false) => {
        try {
            if (isRefresh) setRefreshing(true);
            else setLoading(true);

            let data;
            if (targetUserId) {
                // Viewing another user's wishlists by userId
                data = await apiRequest({ apiBase, path: `/api/wishlists/user/${targetUserId}`, token });
            } else if (targetUsername) {
                // Need to get user ID from username first
                const profileData = await apiRequest({ apiBase, path: `/api/profile/${targetUsername}`, token });
                setTargetUser(profileData.profile);
                if (profileData.profile?.id) {
                    data = await apiRequest({ apiBase, path: `/api/wishlists/user/${profileData.profile.id}`, token });
                } else {
                    data = { wishlists: [] };
                }
            } else {
                // Own wishlists
                data = await apiRequest({ apiBase, path: '/api/wishlists', token });
            }
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

    const handleCreateWishlist = async () => {
        if (!newWishlistName.trim()) {
            Alert.alert('Error', 'Please enter a name for your wishlist');
            return;
        }

        setCreating(true);
        try {
            const data = await apiRequest({
                apiBase,
                path: '/api/wishlists',
                method: 'POST',
                token,
                body: {
                    name: newWishlistName.trim(),
                    visibility: 'public', // Default to public
                },
            });

            // Add new wishlist to list
            if (data.wishlist) {
                setWishlists(prev => [data.wishlist, ...prev]);
                setNewWishlistName('');
                setCreateModalVisible(false);
                // Optionally navigate to it
                // navigation.navigate('Wishlist', { wishlistId: data.wishlist.id });
            }
        } catch (e) {
            Alert.alert('Error', e.message || 'Failed to create wishlist');
        } finally {
            setCreating(false);
        }
    };

    const visibleWishlists = useMemo(() => {
        let filtered = wishlists;

        // Filter
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase().trim();
            filtered = filtered.filter(w => w.name?.toLowerCase().includes(q));
        }

        // Sort
        return [...filtered].sort((a, b) => {
            const nameA = (a.name || '').toLowerCase();
            const nameB = (b.name || '').toLowerCase();
            const countA = a.itemCount || 0;
            const countB = b.itemCount || 0;
            const dateA = new Date(a.createdAt || 0).getTime();
            const dateB = new Date(b.createdAt || 0).getTime();

            switch (sortKey) {
                case 'name_asc': return nameA.localeCompare(nameB);
                case 'name_desc': return nameB.localeCompare(nameA);
                case 'count_desc': return countB - countA;
                case 'count_asc': return countA - countB;
                case 'newest': return dateB - dateA;
                default: return 0;
            }
        });
    }, [wishlists, searchQuery, sortKey]);

    const sortLabel = useMemo(() => {
        const option = SORT_OPTIONS.find(o => o.key === sortKey);
        return option ? option.label : 'Sort';
    }, [sortKey]);

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
            onLongPress={isOwnProfile ? () => handleDelete(item.id) : undefined}
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
                    {isOwnProfile && (
                        <View style={styles.visibilityBadge}>
                            <Ionicons
                                name={getVisibilityIcon(item.visibility)}
                                size={12}
                                color={colors.textMuted}
                            />
                            <Text style={styles.visibilityText}>{item.visibility}</Text>
                        </View>
                    )}
                </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </TouchableOpacity>
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
                <Text style={styles.headerTitle}>
                    {isOwnProfile
                        ? 'My Wishlists'
                        : `${targetUser?.firstName || targetFirstName || targetUsername || 'User'}'s Wishlists`}
                </Text>
                {/* Spacer to balance back button */}
                <View style={{ width: 40 }} />
            </View>

            {/* Search + Sort Controls */}
            <View style={styles.controlsRow}>
                <View style={styles.searchBox}>
                    <Ionicons name="search" size={18} color={colors.textMuted} />
                    <TextInput
                        style={styles.searchInput}
                        placeholder="Search wishlists..."
                        placeholderTextColor={colors.textMuted}
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                    />
                </View>
                <TouchableOpacity
                    style={styles.sortButton}
                    onPress={() => setSortOpen(true)}
                >
                    <Ionicons name="swap-vertical" size={16} color={colors.textMuted} />
                    <Text style={styles.sortButtonText} numberOfLines={1}>{sortLabel}</Text>
                </TouchableOpacity>
            </View>

            {wishlists.length === 0 && !loading ? (
                <View style={styles.emptyState}>
                    <Ionicons name="heart-outline" size={48} color={colors.textMuted} />
                    <Text style={styles.emptyTitle}>No wishlists yet</Text>
                    <Text style={styles.emptySubtitle}>
                        {isOwnProfile
                            ? 'Create a wishlist to track items you want'
                            : 'This user has no public wishlists'}
                    </Text>
                    {isOwnProfile && (
                        <TouchableOpacity
                            style={styles.createButton}
                            onPress={() => setCreateModalVisible(true)}
                        >
                            <Ionicons name="add" size={20} color={colors.textInverted} />
                            <Text style={styles.createButtonText}>Create Wishlist</Text>
                        </TouchableOpacity>
                    )}
                </View>
            ) : (
                <FlatList
                    data={visibleWishlists}
                    keyExtractor={(item) => item.id.toString()}
                    renderItem={renderWishlistCard}
                    contentContainerStyle={styles.listContent}
                    refreshing={refreshing}
                    onRefresh={handleRefresh}
                />
            )}

            {/* FAB */}
            {isOwnProfile && (
                <TouchableOpacity
                    style={styles.fab}
                    onPress={() => setCreateModalVisible(true)}
                >
                    <Ionicons name="add" size={28} color={colors.textInverted} />
                </TouchableOpacity>
            )}

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
                        <TouchableOpacity
                            style={styles.sortCancel}
                            onPress={() => setSortOpen(false)}
                        >
                            <Text style={styles.sortCancelText}>Cancel</Text>
                        </TouchableOpacity>
                    </TouchableOpacity>
                </TouchableOpacity>
            </Modal>

            {/* Create Wishlist Modal */}
            <Modal
                visible={createModalVisible}
                transparent
                animationType="slide"
                onRequestClose={() => setCreateModalVisible(false)}
            >
                <KeyboardAvoidingView
                    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                    style={styles.modalOverlay}
                >
                    <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
                        <View style={styles.createModalContent}>
                            <View style={styles.createModalHeader}>
                                <Text style={styles.createModalTitle}>New Wishlist</Text>
                                <TouchableOpacity onPress={() => setCreateModalVisible(false)}>
                                    <Ionicons name="close" size={24} color={colors.textMuted} />
                                </TouchableOpacity>
                            </View>

                            <Text style={styles.inputLabel}>Wishlist Name</Text>
                            <TextInput
                                style={styles.createInput}
                                placeholder="e.g. Birthday List, Tech Upgrades"
                                placeholderTextColor={colors.textMuted}
                                value={newWishlistName}
                                onChangeText={setNewWishlistName}
                                autoFocus
                            />

                            <TouchableOpacity
                                style={[styles.createActionBtn, creating && styles.disabledBtn]}
                                onPress={handleCreateWishlist}
                                disabled={creating}
                            >
                                {creating ? (
                                    <ActivityIndicator size="small" color={colors.textInverted} />
                                ) : (
                                    <Text style={styles.createActionBtnText}>Create Wishlist</Text>
                                )}
                            </TouchableOpacity>
                        </View>
                    </TouchableWithoutFeedback>
                </KeyboardAvoidingView>
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
        headerTitle: {
            fontSize: 18,
            fontWeight: '600',
            color: colors.text,
        },
        controlsRow: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
            paddingHorizontal: spacing.md,
            paddingBottom: spacing.sm,
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
            maxWidth: 120,
        },
        sortButtonText: {
            fontSize: 12,
            color: colors.textMuted,
        },
        listContent: {
            padding: spacing.md,
            paddingTop: 0,
            paddingBottom: 80,
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
        modalOverlay: {
            flex: 1,
            backgroundColor: 'rgba(0, 0, 0, 0.4)',
            justifyContent: 'flex-end',
        },
        sortModal: {
            backgroundColor: colors.surface,
            borderTopLeftRadius: radius.xl,
            borderTopRightRadius: radius.xl,
            padding: spacing.md,
            paddingBottom: spacing.xl,
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
            paddingVertical: spacing.md,
            paddingHorizontal: spacing.sm,
            borderRadius: radius.md,
        },
        sortOptionSelected: {
            backgroundColor: colors.primary + '15',
        },
        sortOptionText: {
            fontSize: 16,
            color: colors.text,
        },
        sortOptionTextSelected: {
            color: colors.primary,
            fontWeight: '600',
        },
        sortCancel: {
            marginTop: spacing.md,
            paddingVertical: spacing.md,
            alignItems: 'center',
            borderTopWidth: 1,
            borderTopColor: colors.border,
        },
        sortCancelText: {
            fontSize: 16,
            color: colors.textMuted,
        },
        createModalContent: {
            backgroundColor: colors.surface,
            borderTopLeftRadius: radius.xl,
            borderTopRightRadius: radius.xl,
            padding: spacing.lg,
            paddingBottom: spacing.xl * 2,
            ...shadows.lg,
        },
        createModalHeader: {
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: spacing.lg,
        },
        createModalTitle: {
            fontSize: 20,
            fontWeight: 'bold',
            color: colors.text,
        },
        inputLabel: {
            fontSize: 14,
            fontWeight: '500',
            color: colors.text,
            marginBottom: spacing.xs,
        },
        createInput: {
            backgroundColor: colors.background,
            borderRadius: radius.md,
            padding: spacing.md,
            color: colors.text,
            fontSize: 16,
            marginBottom: spacing.lg,
            borderWidth: 1,
            borderColor: colors.border,
        },
        createActionBtn: {
            backgroundColor: colors.primary,
            padding: spacing.md,
            borderRadius: radius.md,
            alignItems: 'center',
        },
        disabledBtn: {
            opacity: 0.7,
        },
        createActionBtnText: {
            fontSize: 16,
            fontWeight: '600',
            color: colors.textInverted,
        },
    });

