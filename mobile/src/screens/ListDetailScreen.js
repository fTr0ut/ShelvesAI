import React, { useContext, useEffect, useState, useMemo, useCallback } from 'react';
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Image,
    RefreshControl,
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

export default function ListDetailScreen({ route, navigation }) {
    const { id } = route.params || {};
    const { token, apiBase, user } = useContext(AuthContext);
    const { colors, spacing, typography, shadows, radius, isDark } = useTheme();

    const [list, setList] = useState(null);
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [editing, setEditing] = useState(false);
    const [editName, setEditName] = useState('');
    const [editDescription, setEditDescription] = useState('');
    const [saving, setSaving] = useState(false);
    const [addModalVisible, setAddModalVisible] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [searching, setSearching] = useState(false);

    const styles = useMemo(
        () => createStyles({ colors, spacing, typography, shadows, radius }),
        [colors, spacing, typography, shadows, radius]
    );

    const isOwner = list?.userId === user?.id;

    const loadList = useCallback(async () => {
        try {
            if (!refreshing) setLoading(true);
            const data = await apiRequest({
                apiBase,
                path: `/api/lists/${id}`,
                token,
            });
            setList(data.list);
            setItems(data.items || []);
            setEditName(data.list?.name || '');
            setEditDescription(data.list?.description || '');
        } catch (e) {
            console.warn('Failed to load list:', e);
            Alert.alert('Error', 'Failed to load list');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [apiBase, id, token, refreshing]);

    useEffect(() => {
        loadList();
    }, [loadList]);

    const onRefresh = () => {
        setRefreshing(true);
        loadList();
    };

    const handleSave = async () => {
        if (!editName.trim()) {
            Alert.alert('Error', 'List name is required');
            return;
        }
        setSaving(true);
        try {
            await apiRequest({
                apiBase,
                path: `/api/lists/${id}`,
                method: 'PUT',
                token,
                body: {
                    name: editName.trim(),
                    description: editDescription.trim() || null,
                },
            });
            setList(prev => ({ ...prev, name: editName.trim(), description: editDescription.trim() }));
            setEditing(false);
            Alert.alert('Saved', 'List updated');
        } catch (e) {
            Alert.alert('Error', e.message);
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = () => {
        Alert.alert('Delete List', 'Are you sure you want to delete this list?', [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Delete',
                style: 'destructive',
                onPress: async () => {
                    try {
                        await apiRequest({
                            apiBase,
                            path: `/api/lists/${id}`,
                            method: 'DELETE',
                            token,
                        });
                        navigation.goBack();
                    } catch (e) {
                        Alert.alert('Error', e.message);
                    }
                },
            },
        ]);
    };

    const handleRemoveItem = (itemId) => {
        Alert.alert('Remove Item', 'Remove this item from the list?', [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Remove',
                style: 'destructive',
                onPress: async () => {
                    try {
                        await apiRequest({
                            apiBase,
                            path: `/api/lists/${id}/items/${itemId}`,
                            method: 'DELETE',
                            token,
                        });
                        setItems(prev => prev.filter(i => i.id !== itemId));
                    } catch (e) {
                        Alert.alert('Error', e.message);
                    }
                },
            },
        ]);
    };

    const handleMoveItem = async (itemId, direction) => {
        const currentIndex = items.findIndex(i => i.id === itemId);
        if (currentIndex === -1) return;

        const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
        if (newIndex < 0 || newIndex >= items.length) return;

        // Build new order
        const newItems = [...items];
        const [moved] = newItems.splice(currentIndex, 1);
        newItems.splice(newIndex, 0, moved);

        // Update positions
        const reorderPayload = newItems.map((item, idx) => ({
            id: item.id,
            position: idx + 1,
        }));

        // Optimistic update
        setItems(newItems.map((item, idx) => ({ ...item, position: idx + 1 })));

        try {
            await apiRequest({
                apiBase,
                path: `/api/lists/${id}/reorder`,
                method: 'PUT',
                token,
                body: { items: reorderPayload },
            });
        } catch (e) {
            console.warn('Failed to reorder:', e);
            loadList(); // Reload on error
        }
    };

    const handleSearch = async () => {
        if (!searchQuery.trim()) return;
        setSearching(true);
        try {
            const data = await apiRequest({
                apiBase,
                path: `/api/collectables/search?q=${encodeURIComponent(searchQuery.trim())}`,
                token,
            });
            setSearchResults(data.results || []);
        } catch (e) {
            console.warn('Search failed:', e);
        } finally {
            setSearching(false);
        }
    };

    const handleAddItem = async (collectableId) => {
        try {
            await apiRequest({
                apiBase,
                path: `/api/lists/${id}/items`,
                method: 'POST',
                token,
                body: { collectableId },
            });
            setAddModalVisible(false);
            setSearchQuery('');
            setSearchResults([]);
            loadList();
        } catch (e) {
            Alert.alert('Error', e.message || 'Failed to add item');
        }
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

    const renderItem = ({ item, index }) => {
        const collectable = item.collectable || {};
        const coverUri = buildCoverUri(collectable.coverMediaPath || collectable.coverUrl);

        return (
            <View style={styles.itemCard}>
                <View style={styles.positionBadge}>
                    <Text style={styles.positionText}>{item.position || index + 1}</Text>
                </View>
                <View style={styles.itemCover}>
                    {coverUri ? (
                        <Image source={{ uri: coverUri }} style={styles.itemCoverImage} resizeMode="cover" />
                    ) : (
                        <View style={styles.itemCoverFallback}>
                            <Ionicons name={getIconForType(collectable.kind)} size={20} color={colors.primary} />
                        </View>
                    )}
                </View>
                <View style={styles.itemContent}>
                    <Text style={styles.itemTitle} numberOfLines={1}>{collectable.title || 'Untitled'}</Text>
                    {collectable.primaryCreator ? (
                        <Text style={styles.itemSubtitle} numberOfLines={1}>{collectable.primaryCreator}</Text>
                    ) : null}
                </View>
                {isOwner && (
                    <View style={styles.itemActions}>
                        <TouchableOpacity
                            onPress={() => handleMoveItem(item.id, 'up')}
                            disabled={index === 0}
                            style={[styles.actionButton, index === 0 && styles.actionButtonDisabled]}
                        >
                            <Ionicons name="chevron-up" size={18} color={index === 0 ? colors.textMuted : colors.text} />
                        </TouchableOpacity>
                        <TouchableOpacity
                            onPress={() => handleMoveItem(item.id, 'down')}
                            disabled={index === items.length - 1}
                            style={[styles.actionButton, index === items.length - 1 && styles.actionButtonDisabled]}
                        >
                            <Ionicons name="chevron-down" size={18} color={index === items.length - 1 ? colors.textMuted : colors.text} />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => handleRemoveItem(item.id)} style={styles.actionButton}>
                            <Ionicons name="close" size={18} color={colors.error} />
                        </TouchableOpacity>
                    </View>
                )}
            </View>
        );
    };

    const renderEmpty = () => (
        <View style={styles.emptyState}>
            <Ionicons name="list-outline" size={56} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>No items yet</Text>
            <Text style={styles.emptyText}>
                {isOwner ? 'Add up to 10 items to this list' : 'This list is empty'}
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
                    {editing ? (
                        <TextInput
                            style={styles.headerTitleInput}
                            value={editName}
                            onChangeText={setEditName}
                            placeholder="List name"
                            placeholderTextColor={colors.textMuted}
                        />
                    ) : (
                        <Text style={styles.headerTitle} numberOfLines={1}>{list?.name || 'List'}</Text>
                    )}
                    <Text style={styles.headerSubtitle}>{items.length} / 10 items</Text>
                </View>
                {isOwner && (
                    <TouchableOpacity
                        onPress={editing ? handleSave : () => setEditing(true)}
                        style={styles.editButton}
                        disabled={saving}
                    >
                        {saving ? (
                            <ActivityIndicator size="small" color={colors.primary} />
                        ) : (
                            <Ionicons name={editing ? 'checkmark' : 'pencil'} size={18} color={colors.primary} />
                        )}
                    </TouchableOpacity>
                )}
            </View>

            {/* Description */}
            {(list?.description || editing) && (
                <View style={styles.descriptionContainer}>
                    {editing ? (
                        <TextInput
                            style={styles.descriptionInput}
                            value={editDescription}
                            onChangeText={setEditDescription}
                            placeholder="Add a description..."
                            placeholderTextColor={colors.textMuted}
                            multiline
                        />
                    ) : (
                        <Text style={styles.description}>{list.description}</Text>
                    )}
                </View>
            )}

            {/* Add Item Button */}
            {isOwner && items.length < 10 && (
                <TouchableOpacity
                    style={styles.addButton}
                    onPress={() => setAddModalVisible(true)}
                >
                    <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
                    <Text style={styles.addButtonText}>Add Item</Text>
                </TouchableOpacity>
            )}

            <FlatList
                data={items}
                keyExtractor={(item) => String(item.id)}
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

            {/* Delete Button */}
            {isOwner && editing && (
                <TouchableOpacity style={styles.deleteButton} onPress={handleDelete}>
                    <Ionicons name="trash-outline" size={18} color={colors.error} />
                    <Text style={styles.deleteButtonText}>Delete List</Text>
                </TouchableOpacity>
            )}

            {/* Add Item Modal */}
            <Modal visible={addModalVisible} animationType="slide" transparent>
                <View style={styles.modalOverlay}>
                    <View style={styles.modalContent}>
                        <View style={styles.modalHeader}>
                            <Text style={styles.modalTitle}>Add Item</Text>
                            <TouchableOpacity onPress={() => { setAddModalVisible(false); setSearchQuery(''); setSearchResults([]); }}>
                                <Ionicons name="close" size={24} color={colors.text} />
                            </TouchableOpacity>
                        </View>
                        <View style={styles.searchBox}>
                            <Ionicons name="search" size={18} color={colors.textMuted} />
                            <TextInput
                                style={styles.searchInput}
                                value={searchQuery}
                                onChangeText={setSearchQuery}
                                placeholder="Search collectables..."
                                placeholderTextColor={colors.textMuted}
                                onSubmitEditing={handleSearch}
                                returnKeyType="search"
                            />
                            {searching && <ActivityIndicator size="small" color={colors.primary} />}
                        </View>
                        <FlatList
                            data={searchResults}
                            keyExtractor={(item) => String(item.id)}
                            renderItem={({ item }) => (
                                <TouchableOpacity
                                    style={styles.searchResultItem}
                                    onPress={() => handleAddItem(item.id)}
                                >
                                    <Text style={styles.searchResultTitle} numberOfLines={1}>{item.title}</Text>
                                    <Text style={styles.searchResultSubtitle} numberOfLines={1}>
                                        {item.primaryCreator || item.kind}
                                    </Text>
                                </TouchableOpacity>
                            )}
                            ListEmptyComponent={
                                searchQuery.trim() && !searching ? (
                                    <Text style={styles.noResultsText}>No results found</Text>
                                ) : null
                            }
                            style={styles.searchResults}
                        />
                    </View>
                </View>
            </Modal>
        </SafeAreaView>
    );
}

const createStyles = ({ colors, spacing, typography, shadows, radius }) =>
    StyleSheet.create({
        screen: { flex: 1, backgroundColor: colors.background },
        centerContainer: { justifyContent: 'center', alignItems: 'center' },
        header: {
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: spacing.md,
            paddingTop: spacing.lg,
            paddingBottom: spacing.md,
        },
        backButton: {
            width: 40, height: 40, borderRadius: 20,
            backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center', ...shadows.sm,
        },
        headerCenter: { flex: 1, alignItems: 'center' },
        headerTitle: { fontSize: 18, fontWeight: '600', color: colors.text },
        headerTitleInput: {
            fontSize: 18, fontWeight: '600', color: colors.text, textAlign: 'center',
            backgroundColor: colors.surface, paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
            borderRadius: radius.md, minWidth: 150,
        },
        headerSubtitle: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
        editButton: {
            width: 40, height: 40, borderRadius: 20,
            backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center', ...shadows.sm,
        },
        descriptionContainer: { paddingHorizontal: spacing.md, marginBottom: spacing.sm },
        description: { fontSize: 14, color: colors.textSecondary, lineHeight: 20 },
        descriptionInput: {
            fontSize: 14, color: colors.text, backgroundColor: colors.surface,
            borderRadius: radius.md, padding: spacing.sm, minHeight: 60, textAlignVertical: 'top',
        },
        addButton: {
            flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
            marginHorizontal: spacing.md, marginBottom: spacing.sm, paddingVertical: spacing.md,
            backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1,
            borderColor: colors.primary, borderStyle: 'dashed',
        },
        addButtonText: { fontSize: 15, fontWeight: '600', color: colors.primary },
        listContent: { padding: spacing.md, paddingBottom: spacing.xl },
        itemCard: {
            flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface,
            borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.sm, ...shadows.sm,
        },
        positionBadge: {
            width: 28, height: 28, borderRadius: 14, backgroundColor: colors.primary,
            justifyContent: 'center', alignItems: 'center', marginRight: spacing.sm,
        },
        positionText: { fontSize: 14, fontWeight: '700', color: colors.textInverted },
        itemCover: {
            width: 44, height: 60, borderRadius: radius.sm, overflow: 'hidden', marginRight: spacing.md,
        },
        itemCoverImage: { width: '100%', height: '100%' },
        itemCoverFallback: {
            width: '100%', height: '100%', backgroundColor: colors.primary + '15',
            justifyContent: 'center', alignItems: 'center',
        },
        itemContent: { flex: 1 },
        itemTitle: { fontSize: 15, fontWeight: '500', color: colors.text },
        itemSubtitle: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
        itemActions: { flexDirection: 'row', gap: 4 },
        actionButton: { padding: 4 },
        actionButtonDisabled: { opacity: 0.3 },
        emptyState: { alignItems: 'center', paddingTop: spacing['2xl'], paddingHorizontal: spacing.xl },
        emptyTitle: { fontSize: 18, fontWeight: '600', color: colors.text, marginTop: spacing.md },
        emptyText: { fontSize: 14, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xs },
        deleteButton: {
            flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
            marginHorizontal: spacing.md, marginVertical: spacing.md, paddingVertical: spacing.md,
            backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.error,
        },
        deleteButtonText: { fontSize: 15, fontWeight: '600', color: colors.error },
        modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
        modalContent: {
            backgroundColor: colors.background, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
            paddingTop: spacing.md, paddingHorizontal: spacing.md, paddingBottom: spacing.xl, maxHeight: '80%',
        },
        modalHeader: {
            flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md,
        },
        modalTitle: { fontSize: 18, fontWeight: '600', color: colors.text },
        searchBox: {
            flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface,
            borderRadius: radius.lg, paddingHorizontal: spacing.md, height: 44, gap: spacing.sm, marginBottom: spacing.md,
        },
        searchInput: { flex: 1, fontSize: 15, color: colors.text },
        searchResults: { maxHeight: 300 },
        searchResultItem: {
            paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border,
        },
        searchResultTitle: { fontSize: 15, fontWeight: '500', color: colors.text },
        searchResultSubtitle: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
        noResultsText: { textAlign: 'center', color: colors.textMuted, paddingVertical: spacing.lg },
    });
