import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
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

function formatRelativeTime(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'now';
    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) return `${diffHours}h`;
    if (diffDays < 7) return `${diffDays}d`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function buildNotificationText(notification) {
    const actorName = notification?.actor?.name || notification?.actor?.username || 'Someone';
    switch (notification?.type) {
        case 'like':
            return `${actorName} liked your activity`;
        case 'comment': {
            const preview = notification?.metadata?.preview;
            return preview
                ? `${actorName} commented: "${preview}"`
                : `${actorName} commented on your activity`;
        }
        case 'friend_request':
            return `${actorName} sent you a friend request`;
        case 'friend_accept':
            return `${actorName} accepted your friend request`;
        default:
            return `${actorName} sent you a notification`;
    }
}

export default function NotificationScreen({ navigation }) {
    const { token, apiBase } = useContext(AuthContext);
    const { colors, spacing, typography, shadows, radius, isDark } = useTheme();

    const [notifications, setNotifications] = useState([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState('');

    const styles = useMemo(
        () => createStyles({ colors, spacing, typography, shadows, radius }),
        [colors, spacing, typography, shadows, radius]
    );

    const loadNotifications = useCallback(async (opts = {}) => {
        if (!token) {
            setNotifications([]);
            setLoading(false);
            return;
        }
        if (!opts.silent) setLoading(true);
        try {
            const data = await apiRequest({ apiBase, path: '/api/notifications?limit=50&offset=0', token });
            setNotifications(Array.isArray(data.notifications) ? data.notifications : []);
            setError('');
        } catch (err) {
            setError('Unable to load notifications');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [apiBase, token]);

    useEffect(() => { loadNotifications(); }, [loadNotifications]);

    useEffect(() => {
        const unsubscribe = navigation.addListener('focus', () => loadNotifications({ silent: true }));
        return unsubscribe;
    }, [navigation, loadNotifications]);

    const onRefresh = () => {
        setRefreshing(true);
        loadNotifications({ silent: true });
    };

    const markRead = useCallback(async (notificationIds) => {
        if (!notificationIds.length) return;
        try {
            await apiRequest({
                apiBase,
                path: '/api/notifications/read',
                method: 'POST',
                token,
                body: { notificationIds },
            });
        } catch (err) {
            console.warn('Failed to mark notifications read:', err.message);
        }
    }, [apiBase, token]);

    const handlePress = useCallback(async (notification) => {
        if (!notification) return;

        if (!notification.isRead) {
            setNotifications((prev) => prev.map((item) => (
                item.id === notification.id ? { ...item, isRead: true } : item
            )));
            await markRead([notification.id]);
        }

        if (notification.entityType === 'event' && notification.entityId) {
            navigation.navigate('FeedDetail', { id: notification.entityId });
            return;
        }

        const username = notification?.actor?.username;
        if (username) {
            navigation.navigate('Profile', { username });
        }
    }, [markRead, navigation]);

    const renderItem = ({ item }) => {
        const actor = item.actor;
        const initial = (actor?.name || actor?.username || '?').charAt(0).toUpperCase();
        const timeAgo = formatRelativeTime(item.createdAt);
        const description = buildNotificationText(item);
        const isUnread = !item.isRead;

        let avatarSource = null;
        if (actor?.profileMediaPath) {
            avatarSource = { uri: `${apiBase}/media/${actor.profileMediaPath}` };
        } else if (actor?.picture) {
            avatarSource = { uri: actor.picture };
        }

        return (
            <TouchableOpacity
                style={[styles.notificationCard, isUnread && styles.notificationUnread]}
                onPress={() => handlePress(item)}
                activeOpacity={0.8}
            >
                <View style={styles.avatar}>
                    {avatarSource ? (
                        <Image source={avatarSource} style={styles.avatarImage} />
                    ) : (
                        <Text style={styles.avatarText}>{initial}</Text>
                    )}
                </View>
                <View style={styles.notificationContent}>
                    <Text style={styles.notificationText}>{description}</Text>
                    <View style={styles.notificationMeta}>
                        <Text style={styles.notificationTime}>{timeAgo}</Text>
                        {isUnread && <View style={styles.unreadDot} />}
                    </View>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>
        );
    };

    const renderEmpty = () => {
        if (loading) return null;
        return (
            <View style={styles.emptyState}>
                <Ionicons name="notifications-outline" size={48} color={colors.textMuted} />
                <Text style={styles.emptyTitle}>No notifications</Text>
                <Text style={styles.emptyText}>Likes, comments, and friend updates will appear here.</Text>
            </View>
        );
    };

    return (
        <SafeAreaView style={styles.screen} edges={['top']}>
            <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />

            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
                    <Ionicons name="arrow-back" size={22} color={colors.text} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Notifications</Text>
                <View style={styles.headerSpacer} />
            </View>

            {error ? (
                <View style={styles.errorBanner}>
                    <Text style={styles.errorText}>{error}</Text>
                </View>
            ) : null}

            {loading && !refreshing ? (
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color={colors.primary} />
                </View>
            ) : (
                <FlatList
                    data={notifications}
                    keyExtractor={(item) => item.id}
                    renderItem={renderItem}
                    contentContainerStyle={styles.listContent}
                    refreshControl={(
                        <RefreshControl
                            refreshing={refreshing}
                            onRefresh={onRefresh}
                            tintColor={colors.primary}
                            colors={[colors.primary]}
                        />
                    )}
                    ListEmptyComponent={renderEmpty}
                    ItemSeparatorComponent={() => <View style={styles.separator} />}
                    showsVerticalScrollIndicator={false}
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
        paddingHorizontal: spacing.md,
        paddingTop: spacing.lg,
        paddingBottom: spacing.sm,
    },
    backButton: {
        padding: spacing.xs,
        marginRight: spacing.sm,
    },
    headerTitle: {
        flex: 1,
        fontSize: 22,
        fontFamily: typography.bold,
        fontWeight: '700',
        color: colors.text,
    },
    headerSpacer: {
        width: 32,
    },
    listContent: {
        padding: spacing.md,
        paddingBottom: 100,
    },
    separator: {
        height: spacing.sm,
    },
    notificationCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.surface,
        borderRadius: radius.lg,
        padding: spacing.md,
        gap: spacing.sm,
        ...shadows.sm,
    },
    notificationUnread: {
        borderWidth: 1,
        borderColor: colors.primary + '40',
        backgroundColor: colors.surfaceElevated,
    },
    avatar: {
        width: 42,
        height: 42,
        borderRadius: 21,
        backgroundColor: colors.primary,
        justifyContent: 'center',
        alignItems: 'center',
        overflow: 'hidden',
    },
    avatarImage: {
        width: '100%',
        height: '100%',
    },
    avatarText: {
        color: colors.textInverted,
        fontSize: 16,
        fontWeight: '600',
    },
    notificationContent: {
        flex: 1,
    },
    notificationText: {
        fontSize: 14,
        color: colors.text,
        lineHeight: 20,
    },
    notificationMeta: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginTop: 4,
    },
    notificationTime: {
        fontSize: 12,
        color: colors.textMuted,
    },
    unreadDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: colors.primary,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
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
        lineHeight: 20,
    },
    errorBanner: {
        backgroundColor: colors.error + '15',
        padding: spacing.sm,
        margin: spacing.md,
        borderRadius: radius.md,
    },
    errorText: {
        color: colors.error,
        textAlign: 'center',
        fontSize: 14,
    },
});
