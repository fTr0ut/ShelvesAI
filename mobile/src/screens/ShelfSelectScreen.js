import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    RefreshControl,
    StatusBar,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { CategoryIcon } from '../components/ui';
import { AuthContext } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { apiRequest } from '../services/api';

export default function ShelfSelectScreen({ navigation }) {
    const { token, apiBase } = useContext(AuthContext);
    const { colors, spacing, typography, shadows, radius, isDark } = useTheme();
    const styles = useMemo(
        () => createStyles({ colors, spacing, typography, shadows, radius }),
        [colors, spacing, typography, shadows, radius]
    );

    const [shelves, setShelves] = useState([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState('');

    const loadShelves = useCallback(async () => {
        try {
            if (!refreshing) setLoading(true);
            setError('');
            const data = await apiRequest({ apiBase, path: '/api/shelves', token });
            setShelves(Array.isArray(data?.shelves) ? data.shelves : []);
        } catch (e) {
            setError(e.message || 'Failed to load shelves.');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [apiBase, token, refreshing]);

    useEffect(() => {
        loadShelves();
    }, []);

    useEffect(() => {
        const unsubscribe = navigation.addListener('focus', loadShelves);
        return unsubscribe;
    }, [navigation, loadShelves]);

    useEffect(() => {
        if (!loading && !error && shelves.length === 0) {
            navigation.replace('ShelfCreateScreen', { autoAddItem: true });
        }
    }, [loading, error, shelves, navigation]);

    const onRefresh = useCallback(() => {
        setRefreshing(true);
        loadShelves();
    }, [loadShelves]);



    const handleSelectShelf = useCallback((shelf) => {
        navigation.navigate('ShelfDetail', {
            id: shelf.id,
            title: shelf.name,
            type: shelf.type,
            autoAddItem: true,
        });
    }, [navigation]);

    const handleCreateShelf = useCallback(() => {
        navigation.navigate('ShelfCreateScreen', { autoAddItem: true });
    }, [navigation]);

    const renderItem = ({ item }) => (
        <TouchableOpacity
            style={styles.listCard}
            onPress={() => handleSelectShelf(item)}
            activeOpacity={0.8}
        >
            <View style={styles.listIcon}>
                <CategoryIcon type={item.type} size={22} />
            </View>
            <View style={styles.listContent}>
                <Text style={styles.listTitle} numberOfLines={1}>{item.name}</Text>
                <Text style={styles.listMeta}>{item.itemCount || 0} items</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </TouchableOpacity>
    );

    const renderCreateShelf = () => (
        <TouchableOpacity
            style={[styles.listCard, styles.createCard]}
            onPress={handleCreateShelf}
            activeOpacity={0.8}
        >
            <View style={styles.createIconBoxList}>
                <Ionicons name="add" size={22} color={colors.primary} />
            </View>
            <View style={styles.listContent}>
                <Text style={styles.createTitleList}>New Shelf</Text>
                <Text style={styles.createMetaList}>Create a new collection</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </TouchableOpacity>
    );

    const renderEmpty = () => (
        <View style={styles.emptyState}>
            <Ionicons name="library-outline" size={56} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>No shelves yet</Text>
            <Text style={styles.emptyText}>Create a shelf to start adding items.</Text>
            <TouchableOpacity
                style={styles.emptyButton}
                onPress={handleCreateShelf}
            >
                <Ionicons name="add" size={18} color={colors.textInverted} />
                <Text style={styles.emptyButtonText}>New Shelf</Text>
            </TouchableOpacity>
        </View>
    );

    if (loading && !refreshing) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={colors.primary} />
            </View>
        );
    }

    return (
        <SafeAreaView style={styles.screen} edges={['top']}>
            <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />

            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
                    <Ionicons name="arrow-back" size={22} color={colors.text} />
                </TouchableOpacity>
                <View style={styles.headerCenter}>
                    <Text style={styles.headerTitle}>Choose Shelf</Text>
                    <Text style={styles.headerSubtitle}>Select where to add your item</Text>
                </View>
                <View style={styles.headerPlaceholder} />
            </View>

            {error ? (
                <View style={styles.errorBox}>
                    <Ionicons name="alert-circle" size={18} color={colors.error} />
                    <Text style={styles.errorText}>{error}</Text>
                    <TouchableOpacity onPress={loadShelves}>
                        <Text style={styles.errorAction}>Try again</Text>
                    </TouchableOpacity>
                </View>
            ) : null}

            <FlatList
                data={shelves}
                keyExtractor={(item) => String(item.id)}
                renderItem={renderItem}
                contentContainerStyle={styles.listContentContainer}
                ListHeaderComponent={shelves.length > 0 ? renderCreateShelf : null}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={onRefresh}
                        tintColor={colors.primary}
                        colors={[colors.primary]}
                    />
                }
                ListEmptyComponent={!error ? renderEmpty : null}
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
    loadingContainer: {
        flex: 1,
        backgroundColor: colors.background,
        alignItems: 'center',
        justifyContent: 'center',
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
        alignItems: 'center',
        justifyContent: 'center',
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
        fontFamily: typography.medium,
    },
    headerSubtitle: {
        fontSize: 13,
        color: colors.textMuted,
        marginTop: 2,
    },
    headerPlaceholder: {
        width: 40,
    },
    errorBox: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        marginHorizontal: spacing.md,
        marginBottom: spacing.sm,
        padding: spacing.sm,
        borderRadius: radius.md,
        backgroundColor: colors.error + '15',
    },
    errorText: {
        flex: 1,
        color: colors.error,
        fontSize: 13,
    },
    errorAction: {
        color: colors.primary,
        fontSize: 13,
        fontWeight: '600',
    },
    listContentContainer: {
        padding: spacing.md,
        paddingBottom: spacing.xl,
    },
    listCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.surface,
        borderRadius: radius.lg,
        padding: spacing.md,
        marginBottom: spacing.sm,
        ...shadows.sm,
    },
    createCard: {
        borderStyle: 'dashed',
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: 'transparent',
        shadowOpacity: 0,
        elevation: 0,
    },
    listIcon: {
        width: 44,
        height: 44,
        borderRadius: radius.md,
        backgroundColor: colors.primary + '15',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: spacing.md,
    },
    createIconBoxList: {
        width: 44,
        height: 44,
        borderRadius: radius.md,
        backgroundColor: colors.surface,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: spacing.md,
        borderWidth: 1,
        borderColor: colors.border,
    },
    listContent: {
        flex: 1,
    },
    listTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.text,
    },
    listMeta: {
        fontSize: 13,
        color: colors.textMuted,
        marginTop: 2,
    },
    createTitleList: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.primary,
    },
    createMetaList: {
        fontSize: 13,
        color: colors.textMuted,
        marginTop: 2,
    },
    emptyState: {
        alignItems: 'center',
        paddingTop: spacing['3xl'],
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
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginTop: spacing.lg,
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.sm + 2,
        backgroundColor: colors.primary,
        borderRadius: 24,
    },
    emptyButtonText: {
        color: colors.textInverted,
        fontWeight: '600',
        fontSize: 15,
    },
});
