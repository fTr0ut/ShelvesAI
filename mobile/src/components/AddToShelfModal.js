import React, { useCallback, useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Modal,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { apiRequest } from '../services/api';

export default function AddToShelfModal({ visible, onClose, onSuccess, apiBase, token, collectableId, manualId }) {
    const { colors, spacing, typography, shadows, radius } = useTheme();
    const [shelves, setShelves] = useState([]);
    const [loading, setLoading] = useState(false);
    const [search, setSearch] = useState('');
    const [addingId, setAddingId] = useState(null);

    const styles = React.useMemo(
        () => createStyles({ colors, spacing, typography, shadows, radius }),
        [colors, spacing, typography, shadows, radius],
    );

    useEffect(() => {
        if (!visible) return;
        setSearch('');
        setAddingId(null);
        fetchShelves();
    }, [visible]);

    const fetchShelves = async () => {
        setLoading(true);
        try {
            const data = await apiRequest({ apiBase, path: '/api/shelves', token });
            setShelves(data?.shelves ?? []);
        } catch (e) {
            console.warn('Failed to fetch shelves', e);
        } finally {
            setLoading(false);
        }
    };

    const filtered = search.trim()
        ? shelves.filter((s) => s.name.toLowerCase().includes(search.trim().toLowerCase()))
        : shelves;

    const handleAdd = useCallback(async (shelf) => {
        if (addingId) return;
        setAddingId(shelf.id);
        try {
            const body = collectableId ? { collectableId } : { manualId };
            await apiRequest({
                apiBase,
                path: `/api/shelves/${shelf.id}/items`,
                method: 'POST',
                token,
                body,
            });
            Alert.alert('Added!', `Added to ${shelf.name}`);
            onSuccess?.(shelf);
            onClose?.();
        } catch (e) {
            const msg = e?.message || 'Failed to add to shelf';
            Alert.alert('Error', msg);
        } finally {
            setAddingId(null);
        }
    }, [addingId, collectableId, manualId, apiBase, token, onSuccess, onClose]);

    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
            <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={onClose}>
                <View style={styles.modalContent} onStartShouldSetResponder={() => true}>
                    <View style={styles.modalHeader}>
                        <Text style={styles.modalTitle}>Add to Shelf</Text>
                        <TouchableOpacity onPress={onClose}>
                            <Ionicons name="close" size={24} color={colors.text} />
                        </TouchableOpacity>
                    </View>

                    <View style={styles.searchContainer}>
                        <Ionicons name="search" size={18} color={colors.textMuted} style={{ marginRight: 8 }} />
                        <TextInput
                            style={styles.searchInput}
                            placeholder="Search shelves..."
                            placeholderTextColor={colors.textMuted}
                            value={search}
                            onChangeText={setSearch}
                            autoCorrect={false}
                        />
                    </View>

                    {loading ? (
                        <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: spacing.xl }} />
                    ) : filtered.length === 0 ? (
                        <View style={styles.emptyState}>
                            <Text style={styles.emptyText}>
                                {shelves.length === 0 ? 'No shelves found.' : 'No matching shelves.'}
                            </Text>
                            {shelves.length === 0 && (
                                <Text style={styles.emptySubtext}>Create one in your Profile.</Text>
                            )}
                        </View>
                    ) : (
                        <FlatList
                            data={filtered}
                            keyExtractor={(item) => item.id.toString()}
                            keyboardShouldPersistTaps="handled"
                            renderItem={({ item: shelf }) => (
                                <TouchableOpacity
                                    style={styles.shelfItem}
                                    onPress={() => handleAdd(shelf)}
                                    disabled={addingId === shelf.id}
                                >
                                    <View style={styles.shelfIcon}>
                                        <Ionicons name="library" size={16} color={colors.primary} />
                                    </View>
                                    <View style={styles.shelfInfo}>
                                        <Text style={styles.shelfName}>{shelf.name}</Text>
                                        <Text style={styles.shelfCount}>
                                            {shelf.itemCount ?? shelf.item_count ?? 0} items
                                        </Text>
                                    </View>
                                    {addingId === shelf.id ? (
                                        <ActivityIndicator size="small" color={colors.primary} />
                                    ) : (
                                        <Ionicons name="add-circle-outline" size={24} color={colors.primary} />
                                    )}
                                </TouchableOpacity>
                            )}
                        />
                    )}
                </View>
            </TouchableOpacity>
        </Modal>
    );
}

const createStyles = ({ colors, spacing, typography, shadows, radius }) =>
    StyleSheet.create({
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
            maxHeight: '60%',
        },
        modalHeader: {
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: spacing.md,
        },
        modalTitle: {
            fontSize: 18,
            fontWeight: '600',
            color: colors.text,
        },
        searchContainer: {
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: colors.background,
            borderRadius: radius.md,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
            marginBottom: spacing.md,
        },
        searchInput: {
            flex: 1,
            fontSize: 15,
            color: colors.text,
            padding: 0,
        },
        shelfItem: {
            flexDirection: 'row',
            alignItems: 'center',
            paddingVertical: spacing.md,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
        },
        shelfIcon: {
            width: 32,
            height: 32,
            borderRadius: 16,
            backgroundColor: colors.primary + '15',
            justifyContent: 'center',
            alignItems: 'center',
            marginRight: spacing.md,
        },
        shelfInfo: {
            flex: 1,
        },
        shelfName: {
            fontSize: 16,
            fontWeight: '500',
            color: colors.text,
        },
        shelfCount: {
            fontSize: 12,
            color: colors.textSecondary,
        },
        emptyState: {
            padding: spacing.xl,
            alignItems: 'center',
        },
        emptyText: {
            fontSize: 16,
            color: colors.text,
            marginBottom: 8,
        },
        emptySubtext: {
            fontSize: 14,
            color: colors.textMuted,
        },
    });
