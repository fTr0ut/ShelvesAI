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
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { AuthContext } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { apiRequest } from '../services/api';
import { extractTextFromImage, parseTextToItems } from '../services/ocr';

const CAMERA_QUALITY = 0.6;

async function getBase64Payload(asset) {
    if (!asset?.uri) return null;
    if (asset.base64) {
        return { base64: asset.base64, mime: asset.mimeType || 'image/jpeg' };
    }
    try {
        const processed = await ImageManipulator.manipulateAsync(
            asset.uri,
            [],
            { compress: CAMERA_QUALITY, format: ImageManipulator.SaveFormat.JPEG, base64: true }
        );
        if (!processed?.base64) return null;
        return { base64: processed.base64, mime: 'image/jpeg' };
    } catch (e) {
        console.warn('Failed to prepare image payload', e);
        return null;
    }
}

export default function ShelfDetailScreen({ route, navigation }) {
    const { id, title } = route.params || {};
    const { token, apiBase, premiumEnabled } = useContext(AuthContext);
    const { colors, spacing, typography, shadows, radius, isDark } = useTheme();

    const [shelf, setShelf] = useState(null);
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [visionLoading, setVisionLoading] = useState(false);

    const styles = useMemo(() => createStyles({ colors, spacing, typography, shadows, radius }), [colors, spacing, typography, shadows, radius]);
    const shelfType = shelf?.type || route?.params?.type || '';

    const loadShelf = useCallback(async () => {
        try {
            if (!refreshing) setLoading(true);
            const [shelfData, itemsData] = await Promise.all([
                apiRequest({ apiBase, path: `/api/shelves/${id}`, token }),
                apiRequest({ apiBase, path: `/api/shelves/${id}/items`, token }),
            ]);
            setShelf(shelfData.shelf);
            setItems(Array.isArray(itemsData.items) ? itemsData.items : []);
        } catch (e) {
            console.warn('Failed to load shelf:', e);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [apiBase, id, token, refreshing]);

    useEffect(() => { loadShelf(); }, [loadShelf]);

    useEffect(() => {
        const unsubscribe = navigation.addListener('focus', loadShelf);
        return unsubscribe;
    }, [navigation, loadShelf]);

    const onRefresh = () => {
        setRefreshing(true);
        loadShelf();
    };

    const handleDeleteItem = useCallback(async (itemId) => {
        Alert.alert('Remove Item', 'Remove this item from the shelf?', [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Remove',
                style: 'destructive',
                onPress: async () => {
                    try {
                        await apiRequest({ apiBase, path: `/api/shelves/${id}/items/${itemId}`, method: 'DELETE', token });
                        setItems(prev => prev.filter(i => i.id !== itemId));
                    } catch (e) {
                        Alert.alert('Error', e.message);
                    }
                },
            },
        ]);
    }, [apiBase, id, token]);

    const filteredItems = useMemo(() => {
        if (!searchQuery.trim()) return items;
        const q = searchQuery.toLowerCase();
        return items.filter(item => {
            const title = item.collectable?.title || item.manual?.title || item.title || '';
            return title.toLowerCase().includes(q);
        });
    }, [items, searchQuery]);

    const getItemInfo = (item) => {
        const collectable = item.collectable || item.collectableSnapshot;
        const manual = item.manual || item.manualSnapshot;
        return {
            title: collectable?.title || manual?.title || item.title || 'Untitled',
            subtitle: collectable?.author || collectable?.primaryCreator || manual?.author || collectable?.publisher || '',
            type: collectable?.type || manual?.type || 'item',
        };
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

    const renderItem = ({ item }) => {
        const info = getItemInfo(item);
        return (
            <TouchableOpacity
                style={styles.itemCard}
                onPress={() => navigation.navigate('CollectableDetail', { item, shelfId: id })}
                activeOpacity={0.7}
            >
                <View style={styles.itemIcon}>
                    <Ionicons name={getIconForType(info.type)} size={20} color={colors.primary} />
                </View>
                <View style={styles.itemContent}>
                    <Text style={styles.itemTitle} numberOfLines={1}>{info.title}</Text>
                    {info.subtitle ? <Text style={styles.itemSubtitle} numberOfLines={1}>{info.subtitle}</Text> : null}
                </View>
                <TouchableOpacity onPress={() => handleDeleteItem(item.id)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                    <Ionicons name="close" size={18} color={colors.textMuted} />
                </TouchableOpacity>
            </TouchableOpacity>
        );
    };

    const renderEmpty = () => (
        <View style={styles.emptyState}>
            <Ionicons name="cube-outline" size={56} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>No items yet</Text>
            <Text style={styles.emptyText}>Add items to this shelf using the camera or search</Text>
        </View>
    );

    const handleCameraScan = useCallback(async () => {
        if (!id || visionLoading) return;

        const cameraPermission = await ImagePicker.requestCameraPermissionsAsync();
        const libraryPermission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!cameraPermission.granted && !libraryPermission.granted) {
            Alert.alert('Permission required', 'Camera or photo library permission is required to scan items.');
            return;
        }

        let selectedSource = null;
        if (cameraPermission.granted && libraryPermission.granted) {
            selectedSource = await new Promise((resolve) => {
                Alert.alert('Add Photo', 'Choose how you want to add a photo', [
                    { text: 'Take Photo', onPress: () => resolve('camera') },
                    { text: 'Choose from Library', onPress: () => resolve('library') },
                    { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
                ]);
            });
            if (!selectedSource) return;
        } else if (cameraPermission.granted) {
            selectedSource = 'camera';
        } else {
            selectedSource = 'library';
        }

        const pickerConfig = {
            base64: true,
            quality: CAMERA_QUALITY,
            mediaTypes: ImagePicker.MediaType.Images,
            allowsMultipleSelection: false,
            exif: false,
        };

        const result = selectedSource === 'camera'
            ? await ImagePicker.launchCameraAsync(pickerConfig)
            : await ImagePicker.launchImageLibraryAsync(pickerConfig);

        if (result.canceled) return;

        const asset = result.assets?.[0];
        if (!asset?.uri) {
            Alert.alert('Error', 'No photo captured.');
            return;
        }

        setVisionLoading(true);
        try {
            if (premiumEnabled) {
                const payload = await getBase64Payload(asset);
                if (!payload?.base64) {
                    Alert.alert('Error', 'Unable to read the captured photo.');
                    return;
                }

                const data = await apiRequest({
                    apiBase,
                    path: `/api/shelves/${id}/vision`,
                    method: 'POST',
                    token,
                    body: {
                        imageBase64: `data:${payload.mime};base64,${payload.base64}`,
                    },
                });

                if (Array.isArray(data?.items)) {
                    setItems(data.items);
                }
                const detected = data?.analysis?.items?.length || 0;
                Alert.alert('Scan complete', detected ? `Detected ${detected} items.` : 'No items detected.');
                return;
            }

            const { text } = await extractTextFromImage(asset.uri);
            if (!text || text.trim().length < 5) {
                Alert.alert('No text found', 'Try a clearer photo or enable premium scanning.');
                return;
            }

            const parsedItems = parseTextToItems(text, shelfType);
            if (!parsedItems.length) {
                Alert.alert('No items detected', 'Try a clearer photo.');
                return;
            }

            const data = await apiRequest({
                apiBase,
                path: `/api/shelves/${id}/catalog-lookup`,
                method: 'POST',
                token,
                body: { items: parsedItems, autoApply: true },
            });

            if (Array.isArray(data?.items)) {
                setItems(data.items);
            }
            const detected = data?.analysis?.items?.length || parsedItems.length;
            Alert.alert('Scan complete', `Detected ${detected} items.`);
        } catch (e) {
            const requiresPremium = e?.data?.requiresPremium;
            const message = requiresPremium
                ? 'Premium is required for cloud vision scanning.'
                : (e.message || 'Scan failed');
            Alert.alert('Error', message);
        } finally {
            setVisionLoading(false);
        }
    }, [apiBase, id, premiumEnabled, shelfType, token, visionLoading]);

    const handleOpenSearch = useCallback(() => {
        navigation.navigate('ItemSearch', { shelfId: id, shelfType });
    }, [navigation, id, shelfType]);

    const handleAddItem = useCallback(() => {
        Alert.alert('Add Item', 'Scan with camera or search catalog', [
            { text: 'Camera', onPress: handleCameraScan },
            { text: 'Search', onPress: handleOpenSearch },
            { text: 'Cancel', style: 'cancel' },
        ]);
    }, [handleCameraScan, handleOpenSearch]);

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
                    <Text style={styles.headerTitle} numberOfLines={1}>{shelf?.name || title || 'Shelf'}</Text>
                    <Text style={styles.headerSubtitle}>{items.length} item{items.length !== 1 ? 's' : ''}</Text>
                </View>
                <TouchableOpacity onPress={() => navigation.navigate('ShelfEdit', { shelf })} style={styles.editButton}>
                    <Ionicons name="settings-outline" size={22} color={colors.text} />
                </TouchableOpacity>
            </View>

            {/* Search */}
            {items.length > 5 && (
                <View style={styles.searchContainer}>
                    <View style={styles.searchBox}>
                        <Ionicons name="search" size={18} color={colors.textMuted} />
                        <TextInput
                            style={styles.searchInput}
                            placeholder="Search items..."
                            placeholderTextColor={colors.textMuted}
                            value={searchQuery}
                            onChangeText={setSearchQuery}
                        />
                    </View>
                </View>
            )}

            {/* Items List */}
            <FlatList
                data={filteredItems}
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

            {/* FAB for adding items */}
            <TouchableOpacity
                style={[styles.fab, visionLoading && styles.fabDisabled]}
                onPress={handleAddItem}
                disabled={visionLoading}
            >
                {visionLoading ? (
                    <ActivityIndicator size="small" color={colors.textInverted} />
                ) : (
                    <Ionicons name="add" size={28} color={colors.textInverted} />
                )}
            </TouchableOpacity>
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
    editButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: colors.surface,
        justifyContent: 'center',
        alignItems: 'center',
        ...shadows.sm,
    },
    searchContainer: {
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
    },
    searchInput: {
        flex: 1,
        fontSize: 14,
        color: colors.text,
    },
    listContent: {
        padding: spacing.md,
        paddingBottom: 100,
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
    itemIcon: {
        width: 40,
        height: 40,
        borderRadius: radius.md,
        backgroundColor: colors.primary + '15',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: spacing.md,
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
    fabDisabled: {
        opacity: 0.6,
    },
});
