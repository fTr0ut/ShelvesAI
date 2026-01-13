import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
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
import { AuthContext } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { apiRequest } from '../services/api';

export default function UnmatchedScreen({ navigation }) {
    const { token, apiBase } = useContext(AuthContext);
    const { colors, spacing, typography, shadows, radius, isDark } = useTheme();

    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [editValues, setEditValues] = useState({});

    const styles = useMemo(() => createStyles({ colors, spacing, typography, shadows, radius }), [colors, spacing, typography, shadows, radius]);

    const loadItems = useCallback(async () => {
        try {
            if (!refreshing) setLoading(true);
            const data = await apiRequest({ apiBase, path: '/api/unmatched', token });
            setItems(data.items || []);
        } catch (e) {
            console.warn('Failed to load unmatched items:', e);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [apiBase, token, refreshing]);

    useEffect(() => {
        loadItems();
    }, [loadItems]);

    useEffect(() => {
        const unsubscribe = navigation.addListener('focus', loadItems);
        return unsubscribe;
    }, [navigation, loadItems]);

    const onRefresh = () => {
        setRefreshing(true);
        loadItems();
    };

    const handleEdit = (item) => {
        setEditingId(item.id);
        setEditValues({
            title: item.rawData?.title || '',
            primaryCreator: item.rawData?.primaryCreator || item.rawData?.author || '',
            year: item.rawData?.year || '',
        });
    };

    const handleSaveEdit = async (item) => {
        try {
            await apiRequest({
                apiBase,
                path: `/api/unmatched/${item.id}`,
                method: 'PUT',
                token,
                body: editValues,
            });
            setEditingId(null);
            setItems(prev => prev.filter(i => i.id !== item.id));
            Alert.alert('Success', 'Item added to your shelf!');
        } catch (e) {
            Alert.alert('Error', e.message || 'Failed to save item');
        }
    };

    const handleDismiss = async (item) => {
        Alert.alert('Dismiss Item', 'Remove this item without adding to your shelf?', [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Dismiss',
                style: 'destructive',
                onPress: async () => {
                    try {
                        await apiRequest({
                            apiBase,
                            path: `/api/unmatched/${item.id}`,
                            method: 'DELETE',
                            token,
                        });
                        setItems(prev => prev.filter(i => i.id !== item.id));
                    } catch (e) {
                        Alert.alert('Error', e.message);
                    }
                },
            },
        ]);
    };

    const handleDismissAll = async () => {
        Alert.alert(
            'Dismiss All Items',
            `Are you sure you want to dismiss all ${items.length} unmatched items? This cannot be undone.`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Dismiss All',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            await apiRequest({
                                apiBase,
                                path: '/api/unmatched/all',
                                method: 'DELETE',
                                token,
                            });
                            setItems([]);
                            Alert.alert('Success', 'All items have been dismissed.');
                        } catch (e) {
                            Alert.alert('Error', e.message || 'Failed to dismiss items');
                        }
                    },
                },
            ]
        );
    };

    const renderItem = ({ item }) => {
        const isEditing = editingId === item.id;
        const rawData = item.rawData || {};

        return (
            <View style={styles.itemCard}>
                <View style={styles.itemHeader}>
                    <Ionicons name="alert-circle" size={20} color={colors.warning || '#f59e0b'} />
                    <Text style={styles.shelfName}>{item.shelfName || 'Unknown Shelf'}</Text>
                    <Text style={styles.confidence}>
                        {Math.round((rawData.confidence || 0) * 100)}% confidence
                    </Text>
                </View>

                {isEditing ? (
                    <View style={styles.editContainer}>
                        <TextInput
                            style={styles.input}
                            placeholder="Title"
                            placeholderTextColor={colors.textMuted}
                            value={editValues.title}
                            onChangeText={(text) => setEditValues(prev => ({ ...prev, title: text }))}
                        />
                        <TextInput
                            style={styles.input}
                            placeholder="Author/Creator"
                            placeholderTextColor={colors.textMuted}
                            value={editValues.primaryCreator}
                            onChangeText={(text) => setEditValues(prev => ({ ...prev, primaryCreator: text }))}
                        />
                        <TextInput
                            style={styles.input}
                            placeholder="Year"
                            placeholderTextColor={colors.textMuted}
                            value={editValues.year}
                            onChangeText={(text) => setEditValues(prev => ({ ...prev, year: text }))}
                            keyboardType="numeric"
                        />
                        <View style={styles.editActions}>
                            <TouchableOpacity
                                style={[styles.actionButton, styles.cancelButton]}
                                onPress={() => setEditingId(null)}
                            >
                                <Text style={styles.cancelButtonText}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.actionButton, styles.saveButton, { backgroundColor: colors.primary }]}
                                onPress={() => handleSaveEdit(item)}
                            >
                                <Text style={styles.saveButtonText}>Add to Shelf</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                ) : (
                    <>
                        <Text style={styles.itemTitle}>{rawData.title || 'Unknown Title'}</Text>
                        <Text style={styles.itemSubtitle}>
                            {rawData.primaryCreator || rawData.author || 'Unknown Creator'}
                        </Text>
                        <View style={styles.itemActions}>
                            <TouchableOpacity
                                style={[styles.actionButton, { backgroundColor: colors.primary }]}
                                onPress={() => handleEdit(item)}
                            >
                                <Ionicons name="pencil" size={16} color="#fff" />
                                <Text style={styles.actionButtonText}>Edit & Add</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.actionButton, styles.dismissButton]}
                                onPress={() => handleDismiss(item)}
                            >
                                <Ionicons name="close" size={16} color={colors.error} />
                                <Text style={[styles.actionButtonText, { color: colors.error }]}>Dismiss</Text>
                            </TouchableOpacity>
                        </View>
                    </>
                )}
            </View>
        );
    };

    const renderEmpty = () => (
        <View style={styles.emptyState}>
            <Ionicons name="checkmark-circle" size={56} color={colors.success || '#22c55e'} />
            <Text style={styles.emptyTitle}>All caught up!</Text>
            <Text style={styles.emptyText}>No items need review right now.</Text>
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
                    <Text style={styles.headerTitle}>Unmatched Items</Text>
                    <Text style={styles.headerSubtitle}>{items.length} item{items.length !== 1 ? 's' : ''} need review</Text>
                </View>
                <View style={styles.headerPlaceholder} />
            </View>

            {/* 7-Day Disclaimer and Dismiss All */}
            {items.length > 0 && (
                <View style={styles.disclaimerContainer}>
                    <View style={styles.disclaimerBox}>
                        <Ionicons name="time-outline" size={16} color={colors.textMuted} />
                        <Text style={styles.disclaimerText}>
                            Unmatched items are automatically removed after 7 days.
                        </Text>
                    </View>
                    <TouchableOpacity
                        style={styles.dismissAllButton}
                        onPress={handleDismissAll}
                    >
                        <Ionicons name="trash-outline" size={16} color="#fff" />
                        <Text style={styles.dismissAllText}>Dismiss All</Text>
                    </TouchableOpacity>
                </View>
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
        </SafeAreaView>
    );
}

const createStyles = ({ colors, spacing, typography, shadows, radius }) => StyleSheet.create({
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
    headerPlaceholder: {
        width: 40,
    },
    listContent: {
        padding: spacing.md,
        paddingBottom: 100,
    },
    itemCard: {
        backgroundColor: colors.surface,
        borderRadius: radius.lg,
        padding: spacing.md,
        marginBottom: spacing.md,
        borderLeftWidth: 4,
        borderLeftColor: colors.warning || '#f59e0b',
        ...shadows.md,
    },
    itemHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: spacing.sm,
    },
    shelfName: {
        flex: 1,
        fontSize: 12,
        color: colors.textMuted,
        marginLeft: 8,
    },
    confidence: {
        fontSize: 11,
        color: colors.textMuted,
    },
    itemTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.text,
        marginBottom: 4,
    },
    itemSubtitle: {
        fontSize: 14,
        color: colors.textMuted,
        marginBottom: spacing.md,
    },
    itemActions: {
        flexDirection: 'row',
        gap: 10,
    },
    actionButton: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: 8,
        gap: 6,
    },
    actionButtonText: {
        color: '#fff',
        fontSize: 13,
        fontWeight: '600',
    },
    dismissButton: {
        backgroundColor: 'transparent',
        borderWidth: 1,
        borderColor: colors.error,
    },
    editContainer: {
        marginTop: spacing.sm,
    },
    input: {
        backgroundColor: colors.background,
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 10,
        color: colors.text,
        fontSize: 14,
        marginBottom: 10,
        borderWidth: 1,
        borderColor: colors.border,
    },
    editActions: {
        flexDirection: 'row',
        gap: 10,
        marginTop: spacing.sm,
    },
    cancelButton: {
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        flex: 1,
        justifyContent: 'center',
    },
    cancelButtonText: {
        color: colors.text,
        fontSize: 13,
        fontWeight: '600',
        textAlign: 'center',
    },
    saveButton: {
        flex: 2,
        justifyContent: 'center',
    },
    saveButtonText: {
        color: '#fff',
        fontSize: 13,
        fontWeight: '600',
        textAlign: 'center',
    },
    emptyState: {
        alignItems: 'center',
        paddingVertical: 60,
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
        marginTop: spacing.sm,
        textAlign: 'center',
    },
    // Disclaimer and Dismiss All
    disclaimerContainer: {
        paddingHorizontal: spacing.md,
        marginBottom: spacing.md,
    },
    disclaimerBox: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.surface,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        borderRadius: radius.md,
        gap: 8,
        marginBottom: spacing.sm,
    },
    disclaimerText: {
        flex: 1,
        fontSize: 12,
        color: colors.textMuted,
    },
    dismissAllButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.error || '#ef4444',
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.md,
        borderRadius: radius.md,
        gap: 6,
    },
    dismissAllText: {
        color: '#fff',
        fontSize: 14,
        fontWeight: '600',
    },
});
