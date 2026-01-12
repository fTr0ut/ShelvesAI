import React, { useContext, useEffect, useMemo, useState, useCallback } from 'react';
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AuthContext } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { apiRequest } from '../services/api';

export default function WishlistScreen({ navigation, route }) {
    const { wishlistId } = route.params;
    const { token, apiBase } = useContext(AuthContext);
    const { colors, spacing, typography, shadows, radius, isDark } = useTheme();

    const [wishlist, setWishlist] = useState(null);
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [showAddModal, setShowAddModal] = useState(false);
    const [manualText, setManualText] = useState('');
    const [addingItem, setAddingItem] = useState(false);

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

    const handleAddManualItem = async () => {
        if (!manualText.trim()) return;

        try {
            setAddingItem(true);
            await apiRequest({
                apiBase,
                path: `/api/wishlists/${wishlistId}/items`,
                method: 'POST',
                token,
                body: { manualText: manualText.trim() },
            });
            setManualText('');
            setShowAddModal(false);
            loadWishlist(true);
        } catch (e) {
            Alert.alert('Error', e.message);
        } finally {
            setAddingItem(false);
        }
    };

    const handleDeleteItem = useCallback(async (itemId) => {
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
    }, [apiBase, token, wishlistId]);

    const renderItem = ({ item }) => {
        const hasCollectable = item.collectableId || item.collectableTitle;
        const imageUri = item.collectableCoverMediaPath
            ? `${apiBase}/media/${item.collectableCoverMediaPath}`
            : item.collectableCover;

        return (
            <View style={styles.itemCard}>
                {hasCollectable && imageUri ? (
                    <Image source={{ uri: imageUri }} style={styles.itemImage} />
                ) : (
                    <View style={styles.itemImagePlaceholder}>
                        <Ionicons name="heart" size={20} color={colors.primary} />
                    </View>
                )}
                <View style={styles.itemInfo}>
                    <Text style={styles.itemTitle} numberOfLines={2}>
                        {hasCollectable ? item.collectableTitle : item.manualText}
                    </Text>
                    {hasCollectable && item.collectableCreator && (
                        <Text style={styles.itemCreator}>{item.collectableCreator}</Text>
                    )}
                    {item.notes && (
                        <Text style={styles.itemNotes} numberOfLines={1}>{item.notes}</Text>
                    )}
                </View>
                <TouchableOpacity
                    style={styles.deleteButton}
                    onPress={() => handleDeleteItem(item.id)}
                >
                    <Ionicons name="trash-outline" size={18} color={colors.error} />
                </TouchableOpacity>
            </View>
        );
    };

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
                <View style={styles.headerCenter}>
                    <Text style={styles.headerTitle} numberOfLines={1}>{wishlist?.name || 'Wishlist'}</Text>
                    {wishlist?.visibility && (
                        <View style={styles.visibilityBadge}>
                            <Ionicons
                                name={wishlist.visibility === 'public' ? 'globe' : wishlist.visibility === 'friends' ? 'people' : 'lock-closed'}
                                size={12}
                                color={colors.textMuted}
                            />
                        </View>
                    )}
                </View>
                <TouchableOpacity onPress={() => setShowAddModal(true)} style={styles.addButton}>
                    <Ionicons name="add" size={24} color={colors.primary} />
                </TouchableOpacity>
            </View>

            {wishlist?.description && (
                <Text style={styles.description}>{wishlist.description}</Text>
            )}

            {items.length === 0 ? (
                <View style={styles.emptyState}>
                    <Ionicons name="heart-outline" size={48} color={colors.textMuted} />
                    <Text style={styles.emptyTitle}>No items yet</Text>
                    <Text style={styles.emptySubtitle}>Add items you want to this wishlist</Text>
                    <TouchableOpacity
                        style={styles.addItemButton}
                        onPress={() => setShowAddModal(true)}
                    >
                        <Ionicons name="add" size={20} color={colors.textInverted} />
                        <Text style={styles.addItemButtonText}>Add Item</Text>
                    </TouchableOpacity>
                </View>
            ) : (
                <FlatList
                    data={items}
                    keyExtractor={(item) => item.id.toString()}
                    renderItem={renderItem}
                    contentContainerStyle={styles.listContent}
                    refreshing={refreshing}
                    onRefresh={handleRefresh}
                />
            )}

            {/* Add Item Modal */}
            <Modal
                visible={showAddModal}
                transparent
                animationType="slide"
                onRequestClose={() => setShowAddModal(false)}
            >
                <View style={styles.modalOverlay}>
                    <View style={styles.modalContent}>
                        <View style={styles.modalHeader}>
                            <Text style={styles.modalTitle}>Add Item</Text>
                            <TouchableOpacity onPress={() => setShowAddModal(false)}>
                                <Ionicons name="close" size={24} color={colors.text} />
                            </TouchableOpacity>
                        </View>

                        <Text style={styles.modalLabel}>Item Description</Text>
                        <TextInput
                            style={styles.modalInput}
                            value={manualText}
                            onChangeText={setManualText}
                            placeholder="What do you want?"
                            placeholderTextColor={colors.textMuted}
                            multiline
                            numberOfLines={3}
                        />

                        <TouchableOpacity
                            style={[styles.modalButton, (!manualText.trim() || addingItem) && styles.modalButtonDisabled]}
                            onPress={handleAddManualItem}
                            disabled={!manualText.trim() || addingItem}
                        >
                            <Text style={styles.modalButtonText}>
                                {addingItem ? 'Adding...' : 'Add to Wishlist'}
                            </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={styles.searchButton}
                            onPress={() => {
                                setShowAddModal(false);
                                navigation.navigate('ItemSearch', {
                                    mode: 'wishlist',
                                    wishlistId: wishlistId
                                });
                            }}
                        >
                            <Ionicons name="search" size={18} color={colors.primary} />
                            <Text style={styles.searchButtonText}>Search Catalog</Text>
                        </TouchableOpacity>
                    </View>
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
        headerCenter: {
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: spacing.xs,
        },
        headerTitle: {
            fontSize: 18,
            fontWeight: '600',
            color: colors.text,
        },
        visibilityBadge: {
            backgroundColor: colors.surface,
            padding: 4,
            borderRadius: radius.sm,
        },
        description: {
            fontSize: 14,
            color: colors.textSecondary,
            paddingHorizontal: spacing.md,
            marginBottom: spacing.md,
        },
        listContent: {
            padding: spacing.md,
            paddingTop: 0,
        },
        itemCard: {
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: colors.surface,
            padding: spacing.sm,
            borderRadius: radius.md,
            marginBottom: spacing.sm,
            ...shadows.sm,
        },
        itemImage: {
            width: 50,
            height: 70,
            borderRadius: radius.sm,
            backgroundColor: colors.background,
        },
        itemImagePlaceholder: {
            width: 50,
            height: 70,
            borderRadius: radius.sm,
            backgroundColor: colors.primary + '20',
            justifyContent: 'center',
            alignItems: 'center',
        },
        itemInfo: {
            flex: 1,
            marginLeft: spacing.sm,
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
            marginBottom: spacing.lg,
        },
        addItemButton: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
            backgroundColor: colors.primary,
            paddingHorizontal: spacing.lg,
            paddingVertical: spacing.sm + 2,
            borderRadius: radius.md,
        },
        addItemButtonText: {
            fontSize: 15,
            fontWeight: '600',
            color: colors.textInverted,
        },
        modalOverlay: {
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.5)',
            justifyContent: 'flex-end',
        },
        modalContent: {
            backgroundColor: colors.surface,
            borderTopLeftRadius: radius.xl,
            borderTopRightRadius: radius.xl,
            padding: spacing.lg,
            paddingBottom: spacing.xl + 20,
        },
        modalHeader: {
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: spacing.lg,
        },
        modalTitle: {
            fontSize: 20,
            fontWeight: '700',
            color: colors.text,
        },
        modalLabel: {
            fontSize: 13,
            color: colors.textMuted,
            marginBottom: spacing.xs,
        },
        modalInput: {
            backgroundColor: colors.background,
            borderRadius: radius.md,
            padding: spacing.sm,
            fontSize: 15,
            color: colors.text,
            minHeight: 80,
            textAlignVertical: 'top',
            marginBottom: spacing.md,
        },
        modalButton: {
            backgroundColor: colors.primary,
            paddingVertical: spacing.md,
            borderRadius: radius.md,
            alignItems: 'center',
        },
        modalButtonDisabled: {
            opacity: 0.5,
        },
        modalButtonText: {
            color: colors.textInverted,
            fontWeight: '600',
            fontSize: 16,
        },
        searchButton: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: spacing.sm,
            paddingVertical: spacing.md,
            marginTop: spacing.sm,
        },
        searchButtonText: {
            fontSize: 15,
            color: colors.primary,
            fontWeight: '500',
        },
    });
