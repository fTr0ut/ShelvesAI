import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    Image,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
    StatusBar,
    Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AuthContext } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { apiRequest } from '../services/api';

export default function FriendsListScreen({ navigation }) {
    const { token, apiBase, user: currentUser } = useContext(AuthContext);
    const { colors, spacing, typography, shadows, radius, isDark } = useTheme();

    const [friendships, setFriendships] = useState([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    const styles = useMemo(
        () => createStyles({ colors, spacing, typography, shadows, radius }),
        [colors, spacing, typography, shadows, radius]
    );

    useEffect(() => {
        loadFriends();
    }, []);

    const loadFriends = async (isRefresh = false) => {
        try {
            if (isRefresh) setRefreshing(true);
            else setLoading(true);

            const data = await apiRequest({ apiBase, path: '/api/friends', token });
            setFriendships(data.friendships || []);
        } catch (e) {
            if (!isRefresh) Alert.alert('Error', 'Failed to load friends');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    const handleRefresh = () => loadFriends(true);

    // Get the friend user from a friendship (the other person)
    const getFriend = (friendship) => {
        if (friendship.requester.id === currentUser?.id) {
            return friendship.addressee;
        }
        return friendship.requester;
    };

    // Filter to only accepted friendships and apply search
    const filteredFriends = useMemo(() => {
        const accepted = friendships.filter(f => f.status === 'accepted');

        if (!searchQuery.trim()) {
            return accepted;
        }

        const query = searchQuery.toLowerCase().trim();
        return accepted.filter(f => {
            const friend = getFriend(f);
            const name = friend.name?.toLowerCase() || '';
            const username = friend.username?.toLowerCase() || '';
            return name.includes(query) || username.includes(query);
        });
    }, [friendships, searchQuery, currentUser]);

    // Get pending requests (where I'm the addressee)
    const pendingRequests = useMemo(() => {
        return friendships.filter(f => f.status === 'pending' && !f.isRequester);
    }, [friendships]);

    const handleRespondToRequest = async (friendshipId, action) => {
        try {
            await apiRequest({
                apiBase,
                path: '/api/friends/respond',
                method: 'POST',
                token,
                body: { friendshipId, action },
            });
            loadFriends(true);
        } catch (e) {
            Alert.alert('Error', e.message);
        }
    };

    const handleRemoveFriend = useCallback((friendshipId, friendName) => {
        Alert.alert(
            'Remove Friend',
            `Are you sure you want to remove ${friendName} from your friends?`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Remove',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            await apiRequest({
                                apiBase,
                                path: `/api/friends/${friendshipId}`,
                                method: 'DELETE',
                                token,
                            });
                            setFriendships(prev => prev.filter(f => f.id !== friendshipId));
                        } catch (e) {
                            Alert.alert('Error', e.message);
                        }
                    },
                },
            ]
        );
    }, [apiBase, token]);

    const renderFriend = ({ item }) => {
        const friend = getFriend(item);
        const initial = (friend.name?.[0] || friend.username?.[0] || '?').toUpperCase();

        // Build avatar source from profile media path or picture
        let avatarSource = null;
        if (friend.profileMediaPath) {
            avatarSource = { uri: `${apiBase}/media/${friend.profileMediaPath}` };
        } else if (friend.picture) {
            avatarSource = { uri: friend.picture };
        }

        return (
            <TouchableOpacity
                style={styles.friendCard}
                onPress={() => navigation.navigate('Profile', { username: friend.username })}
                onLongPress={() => handleRemoveFriend(item.id, friend.name || friend.username)}
            >
                <View style={styles.avatar}>
                    {avatarSource ? (
                        <Image source={avatarSource} style={styles.avatarImage} />
                    ) : (
                        <Text style={styles.avatarText}>{initial}</Text>
                    )}
                </View>
                <View style={styles.friendInfo}>
                    <Text style={styles.friendName}>{friend.name || friend.username}</Text>
                    <Text style={styles.friendUsername}>@{friend.username}</Text>
                </View>
                <TouchableOpacity
                    style={styles.removeButton}
                    onPress={() => handleRemoveFriend(item.id, friend.name || friend.username)}
                >
                    <Ionicons name="person-remove-outline" size={18} color={colors.textMuted} />
                </TouchableOpacity>
            </TouchableOpacity>
        );
    };

    const renderPendingRequest = ({ item }) => {
        const friend = getFriend(item);
        const initial = (friend.name?.[0] || friend.username?.[0] || '?').toUpperCase();

        // Build avatar source from profile media path or picture
        let avatarSource = null;
        if (friend.profileMediaPath) {
            avatarSource = { uri: `${apiBase}/media/${friend.profileMediaPath}` };
        } else if (friend.picture) {
            avatarSource = { uri: friend.picture };
        }

        return (
            <View style={styles.requestCard}>
                <View style={styles.avatar}>
                    {avatarSource ? (
                        <Image source={avatarSource} style={styles.avatarImage} />
                    ) : (
                        <Text style={styles.avatarText}>{initial}</Text>
                    )}
                </View>
                <View style={styles.friendInfo}>
                    <Text style={styles.friendName}>{friend.name || friend.username}</Text>
                    <Text style={styles.friendUsername}>@{friend.username}</Text>
                </View>
                <View style={styles.requestActions}>
                    <TouchableOpacity
                        style={styles.acceptButton}
                        onPress={() => handleRespondToRequest(item.id, 'accept')}
                    >
                        <Ionicons name="checkmark" size={18} color={colors.textInverted} />
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={styles.declineButton}
                        onPress={() => handleRespondToRequest(item.id, 'reject')}
                    >
                        <Ionicons name="close" size={18} color={colors.error} />
                    </TouchableOpacity>
                </View>
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
                <Text style={styles.headerTitle}>Friends</Text>
                <TouchableOpacity
                    onPress={() => navigation.navigate('FriendSearch')}
                    style={styles.addButton}
                >
                    <Ionicons name="person-add" size={20} color={colors.primary} />
                </TouchableOpacity>
            </View>

            {/* Search */}
            <View style={styles.searchContainer}>
                <View style={styles.searchBox}>
                    <Ionicons name="search" size={18} color={colors.textMuted} />
                    <TextInput
                        style={styles.searchInput}
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                        placeholder="Search friends..."
                        placeholderTextColor={colors.textMuted}
                        autoCapitalize="none"
                        autoCorrect={false}
                    />
                    {searchQuery.length > 0 && (
                        <TouchableOpacity onPress={() => setSearchQuery('')}>
                            <Ionicons name="close-circle" size={18} color={colors.textMuted} />
                        </TouchableOpacity>
                    )}
                </View>
            </View>

            {/* Pending Requests */}
            {pendingRequests.length > 0 && (
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Friend Requests ({pendingRequests.length})</Text>
                    {pendingRequests.map((item) => (
                        <View key={item.id}>{renderPendingRequest({ item })}</View>
                    ))}
                </View>
            )}

            {/* Friends List */}
            <FlatList
                data={filteredFriends}
                keyExtractor={(item) => item.id.toString()}
                renderItem={renderFriend}
                contentContainerStyle={styles.listContent}
                refreshing={refreshing}
                onRefresh={handleRefresh}
                ListHeaderComponent={
                    filteredFriends.length > 0 ? (
                        <Text style={styles.sectionTitle}>
                            {searchQuery ? `Results (${filteredFriends.length})` : `All Friends (${filteredFriends.length})`}
                        </Text>
                    ) : null
                }
                ListEmptyComponent={
                    <View style={styles.emptyState}>
                        <Ionicons name="people-outline" size={48} color={colors.textMuted} />
                        <Text style={styles.emptyTitle}>
                            {searchQuery ? 'No friends found' : 'No friends yet'}
                        </Text>
                        <Text style={styles.emptyText}>
                            {searchQuery ? 'Try a different search' : 'Find and add friends to see them here'}
                        </Text>
                        {!searchQuery && (
                            <TouchableOpacity
                                style={styles.findButton}
                                onPress={() => navigation.navigate('FriendSearch')}
                            >
                                <Ionicons name="search" size={18} color={colors.textInverted} />
                                <Text style={styles.findButtonText}>Find Friends</Text>
                            </TouchableOpacity>
                        )}
                    </View>
                }
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
            justifyContent: 'space-between',
            paddingHorizontal: spacing.md,
            paddingTop: spacing.md,
            paddingBottom: spacing.sm,
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
            height: 44,
            gap: spacing.sm,
            ...shadows.sm,
        },
        searchInput: {
            flex: 1,
            fontSize: 15,
            color: colors.text,
        },
        section: {
            paddingHorizontal: spacing.md,
            marginBottom: spacing.sm,
        },
        sectionTitle: {
            fontSize: 14,
            fontWeight: '600',
            color: colors.textMuted,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            marginBottom: spacing.sm,
        },
        listContent: {
            padding: spacing.md,
            paddingTop: 0,
        },
        friendCard: {
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: colors.surface,
            borderRadius: radius.lg,
            padding: spacing.md,
            marginBottom: spacing.sm,
            ...shadows.sm,
        },
        requestCard: {
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: colors.surface,
            borderRadius: radius.lg,
            padding: spacing.md,
            marginBottom: spacing.sm,
            ...shadows.sm,
        },
        avatar: {
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: colors.primary,
            justifyContent: 'center',
            alignItems: 'center',
            marginRight: spacing.md,
            overflow: 'hidden',
        },
        avatarImage: {
            width: '100%',
            height: '100%',
        },
        avatarText: {
            fontSize: 18,
            fontWeight: '600',
            color: colors.textInverted,
        },
        friendInfo: {
            flex: 1,
        },
        friendName: {
            fontSize: 15,
            fontWeight: '600',
            color: colors.text,
        },
        friendUsername: {
            fontSize: 13,
            color: colors.textMuted,
            marginTop: 1,
        },
        removeButton: {
            padding: spacing.sm,
        },
        requestActions: {
            flexDirection: 'row',
            gap: spacing.sm,
        },
        acceptButton: {
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: colors.success,
            justifyContent: 'center',
            alignItems: 'center',
        },
        declineButton: {
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.error,
            justifyContent: 'center',
            alignItems: 'center',
        },
        emptyState: {
            alignItems: 'center',
            paddingTop: spacing['2xl'],
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
            marginTop: spacing.xs,
            textAlign: 'center',
        },
        findButton: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
            backgroundColor: colors.primary,
            paddingHorizontal: spacing.lg,
            paddingVertical: spacing.sm + 2,
            borderRadius: radius.md,
            marginTop: spacing.lg,
        },
        findButtonText: {
            fontSize: 15,
            fontWeight: '600',
            color: colors.textInverted,
        },
    });
