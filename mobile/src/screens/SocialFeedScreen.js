import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Dimensions,
    FlatList,
    Image,
    RefreshControl,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    TouchableWithoutFeedback,
    View,
    StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AuthContext } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { apiRequest } from '../services/api';
import { toggleLike, addComment } from '../services/feedApi';

const FILTERS = [
    { key: 'all', label: 'All' },
    { key: 'friends', label: 'Friends' },
    { key: 'public', label: 'Discover' },
];

// --- Helpers ---
function normalizeDate(value) {
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.valueOf()) ? date.getTime() : 0;
}

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

function getItemPreview(entry, apiBase = '') {
    const collectable = entry.collectable || entry.item || entry.collectableSnapshot || null;
    const manual = entry.manual || entry.manualItem || entry.manualSnapshot || null;
    const title = collectable?.title || collectable?.name || manual?.title || manual?.name || entry?.title || 'Untitled';

    // Extract cover URL with priority: local media path > external URL
    let coverUrl = null;
    if (collectable?.coverMediaPath && apiBase) {
        coverUrl = `${apiBase}/media/${collectable.coverMediaPath}`;
    } else if (collectable?.coverUrl) {
        coverUrl = collectable.coverUrl;
    }

    return { title, coverUrl };
}

function buildSummaryText(items, totalCount) {
    const titles = Array.isArray(items) ? items.map(i => i?.title).filter(Boolean) : [];
    if (!totalCount || totalCount <= 0) return '';
    if (titles.length === 0) return `${totalCount} item${totalCount === 1 ? '' : 's'}`;
    if (totalCount === 1) return titles[0];
    if (totalCount === 2 && titles.length >= 2) return `${titles[0]} and ${titles[1]}`;
    const remaining = Math.max(0, totalCount - titles.length);
    const shown = titles.slice(0, 2);
    if (remaining > 0) {
        return `${shown.join(', ')}, and ${remaining} others`;
    }
    return shown.join(', ');
}

// --- Component ---
export default function SocialFeedScreen({ navigation }) {
    const { token, apiBase, user } = useContext(AuthContext);
    const { colors, spacing, typography, shadows, isDark } = useTheme();

    const [entries, setEntries] = useState([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState('');
    const [activeFilter, setActiveFilter] = useState('all');
    const [pendingLikes, setPendingLikes] = useState({});
    const [unreadCount, setUnreadCount] = useState(0);

    // Inline search state
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState({ friends: [], collectables: [] });
    const [searchLoading, setSearchLoading] = useState(false);
    const [showResults, setShowResults] = useState(false);
    const searchTimeoutRef = useRef(null);

    // Inline comment state
    const [commentTexts, setCommentTexts] = useState({});
    const [pendingComments, setPendingComments] = useState({});

    const load = useCallback(async (opts = {}) => {
        if (!token) {
            setEntries([]);
            setLoading(false);
            return;
        }
        if (!opts.silent) setLoading(true);

        // Map tab key to backend scope
        let scope = 'global';
        if (activeFilter === 'friends') scope = 'friends';
        else if (activeFilter === 'all') scope = 'all';

        try {
            const result = await apiRequest({ apiBase, path: `/api/feed?scope=${scope}`, token });
            // Filter out shelf.created events as requested (legacy logic preserved)
            const filtered = (result.entries || []).filter(e => e.eventType !== 'shelf.created');
            setEntries(filtered);
            setError('');
        } catch (err) {
            console.error('Feed load error:', err);
            setError('Unable to load feed');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [apiBase, token, activeFilter]);

    useEffect(() => { load(); }, [load]);

    const loadUnreadCount = useCallback(async () => {
        if (!token) {
            setUnreadCount(0);
            return;
        }
        try {
            const result = await apiRequest({ apiBase, path: '/api/notifications/unread-count', token });
            const count = result?.unreadCount ?? result?.count ?? 0;
            setUnreadCount(Number(count) || 0);
        } catch (err) {
            setUnreadCount(0);
        }
    }, [apiBase, token]);

    useEffect(() => { loadUnreadCount(); }, [loadUnreadCount]);

    useEffect(() => {
        const unsubscribe = navigation.addListener('focus', loadUnreadCount);
        return unsubscribe;
    }, [navigation, loadUnreadCount]);

    const onRefresh = () => {
        setRefreshing(true);
        load({ silent: true });
        loadUnreadCount();
    };

    // Debounced search handler
    const handleSearchChange = useCallback((text) => {
        setSearchQuery(text);

        if (searchTimeoutRef.current) {
            clearTimeout(searchTimeoutRef.current);
        }

        if (!text.trim()) {
            setSearchResults({ friends: [], collectables: [] });
            setShowResults(false);
            return;
        }

        searchTimeoutRef.current = setTimeout(async () => {
            setSearchLoading(true);
            setShowResults(true);

            try {
                // Parallel API calls for friends and collectables
                const [friendsRes, collectablesRes] = await Promise.all([
                    apiRequest({ apiBase, path: `/api/friends/search?q=${encodeURIComponent(text)}&limit=3&wildcard=true`, token }),
                    apiRequest({ apiBase, path: `/api/collectables?q=${encodeURIComponent(text)}&limit=3&wildcard=true`, token }),
                ]);

                setSearchResults({
                    friends: friendsRes?.users || [],
                    collectables: collectablesRes?.results || [],
                });
            } catch (err) {
                console.error('Search error:', err);
            } finally {
                setSearchLoading(false);
            }
        }, 300);
    }, [apiBase, token]);

    const handleFriendPress = (friend) => {
        setShowResults(false);
        setSearchQuery('');
        navigation.navigate('Profile', { username: friend.username });
    };

    const handleCollectablePress = (collectable) => {
        setShowResults(false);
        setSearchQuery('');
        navigation.navigate('CollectableDetail', { item: { collectable } });
    };

    const handleSeeMore = () => {
        setShowResults(false);
        navigation.navigate('FriendSearch', { initialQuery: searchQuery });
        setSearchQuery('');
    };

    const dismissSearch = () => {
        setShowResults(false);
    };

    const styles = useMemo(() => createStyles({ colors, spacing, typography, shadows }), [colors, spacing, typography, shadows]);

    const updateEntrySocial = useCallback((targetId, updates) => {
        if (!targetId) return;
        setEntries((prevEntries) => prevEntries.map((entry) => {
            const entryId = entry?.aggregateId || entry?.id;
            if (entryId !== targetId) return entry;
            return { ...entry, ...updates };
        }));
    }, []);

    const setPendingLike = useCallback((targetId, isPending) => {
        if (!targetId) return;
        setPendingLikes((prev) => {
            const next = { ...prev };
            if (isPending) {
                next[targetId] = true;
            } else {
                delete next[targetId];
            }
            return next;
        });
    }, []);

    const handleToggleLike = useCallback(async (entry) => {
        const targetId = entry?.aggregateId || entry?.id;
        if (!token || !targetId || pendingLikes[targetId]) return;

        const previous = {
            hasLiked: !!entry?.hasLiked,
            likeCount: entry?.likeCount || 0,
        };
        const optimisticLiked = !previous.hasLiked;
        const optimisticCount = Math.max(0, previous.likeCount + (optimisticLiked ? 1 : -1));

        updateEntrySocial(targetId, { hasLiked: optimisticLiked, likeCount: optimisticCount });
        setPendingLike(targetId, true);

        try {
            const response = await toggleLike({ apiBase, token, eventId: targetId });
            const resolvedLiked = typeof response?.liked === 'boolean' ? response.liked : optimisticLiked;
            const resolvedCount = typeof response?.likeCount === 'number' ? response.likeCount : optimisticCount;
            updateEntrySocial(targetId, { hasLiked: resolvedLiked, likeCount: resolvedCount });
        } catch (err) {
            updateEntrySocial(targetId, previous);
        } finally {
            setPendingLike(targetId, false);
        }
    }, [apiBase, token, pendingLikes, setPendingLike, updateEntrySocial]);

    const handleCommentPress = useCallback((entry) => {
        const targetId = entry?.aggregateId || entry?.id;
        if (!targetId) return;
        navigation.navigate('FeedDetail', { entry });
    }, [navigation]);

    const handleAddInlineComment = useCallback(async (entry) => {
        const targetId = entry?.aggregateId || entry?.id;
        const content = commentTexts[targetId]?.trim();

        if (!token || !targetId || !content || pendingComments[targetId]) return;

        setPendingComments(prev => ({ ...prev, [targetId]: true }));

        try {
            const response = await addComment({ apiBase, token, eventId: targetId, content });

            // Clear input on success
            setCommentTexts(prev => {
                const next = { ...prev };
                delete next[targetId];
                return next;
            });

            // Optimistic updates
            const previousCount = entry?.commentCount || 0;
            const newComment = response?.comment || {
                content,
                username: user?.username || 'You',
                id: 'optimistic-' + Date.now()
            };

            // If this is the first comment, set it as topComment so it appears immediately
            const updates = {
                commentCount: (typeof response?.commentCount === 'number') ? response.commentCount : previousCount + 1
            };

            if (!entry?.topComment) {
                updates.topComment = newComment;
            }

            updateEntrySocial(targetId, updates);

        } catch (err) {
            console.error('Failed to add comment:', err);
        } finally {
            setPendingComments(prev => {
                const next = { ...prev };
                delete next[targetId];
                return next;
            });
        }
    }, [apiBase, token, commentTexts, pendingComments, updateEntrySocial, user]);

    const renderSocialActions = (entry) => {
        const targetId = entry?.aggregateId || entry?.id;
        const hasLiked = !!entry?.hasLiked;
        const likeCount = entry?.likeCount || 0;
        const commentCount = entry?.commentCount || 0;
        const topComment = entry?.topComment || null;
        const likeLabel = likeCount > 0 ? `${likeCount} Like${likeCount === 1 ? '' : 's'}` : 'Like';
        const commentLabel = commentCount > 0 ? `${commentCount} Comment${commentCount === 1 ? '' : 's'}` : 'Comment';
        const isPending = !!(targetId && pendingLikes[targetId]);

        const commentText = commentTexts[targetId] || '';
        const isSending = !!pendingComments[targetId];

        // Prepare comment avatar
        let commentAvatarSource = null;
        if (topComment) {
            const commentUser = topComment.user || {}; // backend might nest user info
            // Fallbacks if user info is at top level or nested
            const profilePath = commentUser.profileMediaPath || topComment.profileMediaPath;
            const pictureUrl = commentUser.picture || topComment.picture || topComment.userPicture;

            if (profilePath) {
                commentAvatarSource = { uri: `${apiBase}/media/${profilePath}` };
            } else if (pictureUrl) {
                commentAvatarSource = { uri: pictureUrl };
            }
        }

        // Fallback initial
        const commentUsername = topComment?.username || topComment?.user?.username || 'User';
        const commentInitial = commentUsername.charAt(0).toUpperCase();
        const commentTime = formatRelativeTime(topComment?.createdAt);

        return (
            <View style={styles.socialRow}>
                {/* Stats & Actions Row */}
                <View style={styles.socialActions}>
                    <TouchableOpacity
                        style={[
                            styles.socialButton,
                            hasLiked && styles.socialButtonActive,
                            isPending && styles.socialButtonDisabled,
                        ]}
                        onPress={() => handleToggleLike(entry)}
                        disabled={isPending || !targetId}
                    >
                        <Ionicons
                            name={hasLiked ? 'heart' : 'heart-outline'}
                            size={16}
                            color={hasLiked ? colors.primary : colors.textMuted}
                        />
                        <Text style={[styles.socialButtonText, hasLiked && styles.socialButtonTextActive]}>
                            {likeLabel}
                        </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={styles.socialButton}
                        onPress={() => handleCommentPress(entry)}
                        disabled={!targetId}
                    >
                        <Ionicons name="chatbubble-outline" size={16} color={colors.textMuted} />
                        <Text style={styles.socialButtonText}>{commentLabel}</Text>
                    </TouchableOpacity>
                </View>

                {/* Top Comment Preview */}
                {topComment?.content ? (
                    <TouchableOpacity
                        style={styles.commentPreviewContainer}
                        onPress={() => handleCommentPress(entry)}
                        activeOpacity={0.8}
                    >
                        <View style={styles.commentPreviewRow}>
                            <View style={styles.commentAvatar}>
                                {commentAvatarSource ? (
                                    <Image source={commentAvatarSource} style={styles.commentAvatarImage} />
                                ) : (
                                    <Text style={styles.commentAvatarText}>{commentInitial}</Text>
                                )}
                            </View>
                            <Text style={styles.commentPreview} numberOfLines={2}>
                                <Text style={styles.commentUsername}>{commentUsername ? `${commentUsername} ` : ''}</Text>
                                <Text style={styles.commentContent}>{topComment.content}</Text>
                            </Text>
                            <Text style={styles.commentTimestamp}>{commentTime}</Text>
                        </View>
                    </TouchableOpacity>
                ) : null}

                {/* Inline Comment Input */}
                <View style={styles.inlineCommentRow}>
                    <TextInput
                        style={styles.inlineCommentInput}
                        placeholder="Add a comment..."
                        placeholderTextColor={colors.textMuted}
                        value={commentText}
                        onChangeText={(text) => setCommentTexts(prev => ({ ...prev, [targetId]: text }))}
                        multiline
                    />
                    <TouchableOpacity
                        style={[
                            styles.inlineCommentSend,
                            (!commentText.trim() || isSending) && styles.inlineCommentSendDisabled
                        ]}
                        onPress={() => handleAddInlineComment(entry)}
                        disabled={!commentText.trim() || isSending}
                    >
                        {isSending ? (
                            <ActivityIndicator size="small" color={colors.textInverted} />
                        ) : (
                            <Ionicons name="arrow-up" size={16} color={colors.textInverted} />
                        )}
                    </TouchableOpacity>
                </View>
            </View>
        );
    };

    const renderItem = ({ item }) => {
        const { shelf, owner, items, eventType, collectable, checkinStatus, note } = item;
        const isCheckIn = eventType === 'checkin.activity';
        const timeAgo = formatRelativeTime(isCheckIn ? item.createdAt : shelf?.updatedAt);
        const displayName = owner?.name || owner?.username || 'Someone';
        const initial = displayName.charAt(0).toUpperCase();

        let avatarSource = null;
        if (owner?.profileMediaPath) {
            avatarSource = { uri: `${apiBase}/media/${owner.profileMediaPath}` };
        } else if (owner?.picture) {
            avatarSource = { uri: owner.picture };
        }

        const handlePress = () => {
            if (isCheckIn) {
                // Check-in events now navigate to FeedDetail (event details)
                // The item preview inside handles navigation to the collectable
                navigation.navigate('FeedDetail', { entry: item });
            } else if (eventType && (eventType.includes('added') || eventType.includes('removed'))) {
                navigation.navigate('FeedDetail', { entry: item });
            } else {
                navigation.navigate('ShelfDetail', { id: shelf?.id, title: shelf?.name });
            }
        };

        // Check-in event rendering
        if (isCheckIn) {
            const statusLabels = {
                starting: 'started',
                continuing: 'is continuing',
                completed: 'finished',
            };
            const statusIcons = {
                starting: 'play-circle-outline',
                continuing: 'refresh-outline',
                completed: 'checkmark-circle-outline',
            };
            const statusLabel = statusLabels[checkinStatus] || checkinStatus;
            const statusIcon = statusIcons[checkinStatus] || 'checkbox-outline';

            let collectableCoverUrl = null;
            if (collectable?.coverMediaPath) {
                collectableCoverUrl = `${apiBase}/media/${collectable.coverMediaPath}`;
            } else if (collectable?.coverUrl) {
                collectableCoverUrl = collectable.coverUrl;
            }

            const handleCheckinCollectablePress = () => {
                if (collectable?.id) {
                    navigation.navigate('CollectableDetail', { item: { collectable } });
                }
            };

            return (
                <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={handlePress}
                    style={styles.feedCard}
                >
                    {/* Header */}
                    <View style={styles.cardHeader}>
                        <View style={styles.avatar}>
                            {avatarSource ? (
                                <Image source={avatarSource} style={styles.avatarImage} />
                            ) : (
                                <Text style={styles.avatarText}>{initial}</Text>
                            )}
                        </View>
                        <View style={styles.headerContent}>
                            <View style={styles.headerTop}>
                                <Text style={styles.username}>{displayName}</Text>
                                <Text style={styles.timestamp}>{timeAgo}</Text>
                            </View>
                            <View style={styles.checkinAction}>
                                <Ionicons name={statusIcon} size={14} color={colors.primary} />
                                <Text style={styles.shelfAction}>
                                    {statusLabel}{' '}
                                    <Text style={styles.shelfName}>{collectable?.title || 'something'}</Text>
                                </Text>
                            </View>
                        </View>
                    </View>

                    {/* Collectable preview */}
                    <TouchableOpacity
                        style={styles.checkinPreview}
                        onPress={handleCheckinCollectablePress}
                        activeOpacity={0.9}
                    >
                        {collectableCoverUrl ? (
                            <Image
                                source={{ uri: collectableCoverUrl }}
                                style={styles.checkinCover}
                                resizeMode="cover"
                            />
                        ) : (
                            <View style={[styles.checkinCover, styles.checkinCoverFallback]}>
                                <Ionicons name="book" size={24} color={colors.primary} />
                            </View>
                        )}
                        <View style={styles.checkinInfo}>
                            <Text style={styles.checkinTitle} numberOfLines={2}>{collectable?.title}</Text>
                            {collectable?.primaryCreator && (
                                <Text style={styles.checkinCreator} numberOfLines={1}>{collectable.primaryCreator}</Text>
                            )}
                            {collectable?.kind && (
                                <View style={styles.kindBadge}>
                                    <Text style={styles.kindText}>{collectable.kind}</Text>
                                </View>
                            )}
                        </View>
                    </TouchableOpacity>

                    {/* Note if present */}
                    {note ? (
                        <Text style={styles.checkinNote} numberOfLines={3}>{note}</Text>
                    ) : null}

                    {renderSocialActions(item)}
                </TouchableOpacity>
            );
        }

        // Regular shelf-based event rendering
        const previewItems = (items || []).slice(0, 3);
        const totalItems = item?.eventItemCount || items?.length || 0;
        const itemPreviews = previewItems.map(e => getItemPreview(e, apiBase));
        const summaryText = buildSummaryText(itemPreviews, totalItems);
        const coverItems = itemPreviews.filter(i => i.coverUrl).slice(0, 3);

        let actionText = 'updated';
        if (eventType === 'shelf.created') actionText = 'created';
        else if (eventType && eventType.includes('added')) actionText = 'added';

        return (
            <TouchableOpacity
                activeOpacity={0.7}
                onPress={handlePress}
                style={styles.feedCard}
            >
                {/* Thread-style header */}
                <View style={styles.cardHeader}>
                    <View style={styles.avatar}>
                        {avatarSource ? (
                            <Image source={avatarSource} style={styles.avatarImage} />
                        ) : (
                            <Text style={styles.avatarText}>{initial}</Text>
                        )}
                    </View>
                    <View style={styles.headerContent}>
                        <View style={styles.headerTop}>
                            <Text style={styles.username}>{displayName}</Text>
                            <Text style={styles.timestamp}>{timeAgo}</Text>
                        </View>
                        <Text style={styles.shelfAction}>
                            {actionText}{' '}
                            {actionText === 'added' && summaryText
                                ? <Text style={styles.shelfName}>{summaryText}</Text>
                                : <Text style={styles.shelfName}>{shelf?.name || 'a shelf'}</Text>}
                            {actionText === 'added' && (
                                <Text> to <Text style={styles.shelfName}>{shelf?.name || 'a shelf'}</Text></Text>
                            )}
                        </Text>
                    </View>
                </View>

                {/* Content preview */}
                {shelf?.description ? (
                    <Text style={styles.description} numberOfLines={2}>{shelf.description}</Text>
                ) : null}

                {/* Cover art thumbnails */}
                {coverItems.length > 0 && (
                    <View style={styles.coverRow}>
                        {coverItems.map((item, idx) => (
                            <Image
                                key={idx}
                                source={{ uri: item.coverUrl }}
                                style={[
                                    styles.coverThumb,
                                    idx > 0 && { marginLeft: -8 },
                                ]}
                                resizeMode="cover"
                            />
                        ))}
                        {totalItems > coverItems.length && (
                            <View style={styles.moreCoversChip}>
                                <Text style={styles.moreCoversText}>+{totalItems - coverItems.length}</Text>
                            </View>
                        )}
                    </View>
                )}

                {/* Items preview - text fallback when no covers */}
                {coverItems.length === 0 && previewItems.length > 0 && (
                    <View style={styles.itemsPreview}>
                        {previewItems.map((entry, idx) => (
                            <View key={idx} style={styles.itemChip}>
                                <Ionicons name="book" size={12} color={colors.primary} />
                                <Text style={styles.itemTitle} numberOfLines={1}>{itemPreviews[idx]?.title || 'Untitled'}</Text>
                            </View>
                        ))}
                        {totalItems > previewItems.length && (
                            <Text style={styles.moreItems}>+{totalItems - previewItems.length} more</Text>
                        )}
                    </View>
                )}

                {renderSocialActions(item)}

                {/* Footer */}
                <View style={styles.cardFooter}>
                    <View style={styles.footerStat}>
                        <Ionicons name="library-outline" size={14} color={colors.textMuted} />
                        <Text style={styles.footerText}>{shelf?.itemCount || 0} items</Text>
                    </View>
                    <View style={styles.footerStat}>
                        <Ionicons name="globe-outline" size={14} color={colors.textMuted} />
                        <Text style={styles.footerText}>{shelf?.type || 'Collection'}</Text>
                    </View>
                </View>
            </TouchableOpacity>
        );
    };

    const renderEmpty = () => {
        if (loading) return null;
        return (
            <View style={styles.emptyState}>
                <Ionicons name="newspaper-outline" size={48} color={colors.textMuted} />
                <Text style={styles.emptyTitle}>Your feed is quiet</Text>
                <Text style={styles.emptyText}>
                    {activeFilter === 'friends'
                        ? 'Add friends to see their collections'
                        : 'Collections from other users will appear here'}
                </Text>
                {activeFilter === 'friends' && (
                    <TouchableOpacity
                        style={styles.emptyButton}
                        onPress={() => navigation.navigate('FriendSearch')}
                    >
                        <Text style={styles.emptyButtonText}>Find Friends</Text>
                    </TouchableOpacity>
                )}
            </View>
        );
    };

    return (
        <SafeAreaView style={styles.screen} edges={['top']}>
            <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />

            {/* Header with inline search */}
            <View style={styles.header}>
                <Text style={styles.headerTitle}>Feed</Text>
                <View style={styles.searchInputContainer}>
                    <Ionicons name="search" size={16} color={colors.textMuted} />
                    <TextInput
                        style={styles.searchInput}
                        placeholder="Search Titles, Creators, or Friends"
                        placeholderTextColor={colors.textMuted}
                        value={searchQuery}
                        onChangeText={handleSearchChange}
                        onFocus={() => searchQuery.trim() && setShowResults(true)}
                    />
                    {searchQuery.length > 0 && (
                        <TouchableOpacity onPress={() => { setSearchQuery(''); setShowResults(false); }}>
                            <Ionicons name="close-circle" size={16} color={colors.textMuted} />
                        </TouchableOpacity>
                    )}
                </View>
                <View style={styles.headerRight}>
                    <TouchableOpacity
                        onPress={() => navigation.navigate('Notifications')}
                        style={styles.headerButton}
                    >
                        <Ionicons name="notifications-outline" size={24} color={colors.text} />
                        {unreadCount > 0 && (
                            <View style={styles.badge}>
                                <Text style={styles.badgeText}>
                                    {unreadCount > 99 ? '99+' : unreadCount}
                                </Text>
                            </View>
                        )}
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => navigation.navigate('Account')} style={styles.headerButton}>
                        <Ionicons name="person-circle-outline" size={26} color={colors.text} />
                    </TouchableOpacity>
                </View>
            </View>

            {/* Floating search results dropdown */}
            {showResults && (
                <TouchableWithoutFeedback onPress={dismissSearch}>
                    <View style={styles.searchOverlay}>
                        <TouchableWithoutFeedback>
                            <View style={styles.searchDropdown}>
                                {searchLoading ? (
                                    <View style={styles.searchLoadingContainer}>
                                        <ActivityIndicator size="small" color={colors.primary} />
                                    </View>
                                ) : (
                                    <>
                                        {/* Friends section */}
                                        {searchResults.friends.length > 0 && (
                                            <View style={styles.searchSection}>
                                                <Text style={styles.searchSectionTitle}>Friends</Text>
                                                {searchResults.friends.map((friend) => {
                                                    const displayName = friend.firstName && friend.lastName
                                                        ? `${friend.firstName} ${friend.lastName}`
                                                        : friend.name || friend.username;
                                                    return (
                                                        <TouchableOpacity
                                                            key={friend.id}
                                                            style={styles.searchResultItem}
                                                            onPress={() => handleFriendPress(friend)}
                                                        >
                                                            <View style={styles.searchResultAvatar}>
                                                                <Text style={styles.searchResultAvatarText}>
                                                                    {(displayName || '?').charAt(0).toUpperCase()}
                                                                </Text>
                                                            </View>
                                                            <View style={styles.searchResultInfo}>
                                                                <Text style={styles.searchResultTitle} numberOfLines={1}>{displayName}</Text>
                                                                <Text style={styles.searchResultSubtitle} numberOfLines={1}>@{friend.username}</Text>
                                                            </View>
                                                            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                                                        </TouchableOpacity>
                                                    );
                                                })}
                                            </View>
                                        )}

                                        {/* Collectables section */}
                                        {searchResults.collectables.length > 0 && (
                                            <View style={styles.searchSection}>
                                                <Text style={styles.searchSectionTitle}>Items</Text>
                                                {searchResults.collectables.map((item) => {
                                                    const coverUrl = item.coverMediaPath
                                                        ? `${apiBase}/media/${item.coverMediaPath}`
                                                        : item.coverUrl;
                                                    return (
                                                        <TouchableOpacity
                                                            key={item.id}
                                                            style={styles.searchResultItem}
                                                            onPress={() => handleCollectablePress(item)}
                                                        >
                                                            {coverUrl ? (
                                                                <Image source={{ uri: coverUrl }} style={styles.searchResultCover} />
                                                            ) : (
                                                                <View style={[styles.searchResultCover, styles.searchResultCoverFallback]}>
                                                                    <Ionicons name="book" size={16} color={colors.primary} />
                                                                </View>
                                                            )}
                                                            <View style={styles.searchResultInfo}>
                                                                <Text style={styles.searchResultTitle} numberOfLines={1}>{item.title || 'Untitled'}</Text>
                                                                {item.primaryCreator && (
                                                                    <Text style={styles.searchResultSubtitle} numberOfLines={1}>{item.primaryCreator}</Text>
                                                                )}
                                                            </View>
                                                            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                                                        </TouchableOpacity>
                                                    );
                                                })}
                                            </View>
                                        )}

                                        {/* Empty state */}
                                        {searchResults.friends.length === 0 && searchResults.collectables.length === 0 && (
                                            <View style={styles.searchEmptyState}>
                                                <Ionicons name="search-outline" size={24} color={colors.textMuted} />
                                                <Text style={styles.searchEmptyText}>No results found</Text>
                                            </View>
                                        )}

                                        {/* See more button */}
                                        {(searchResults.friends.length > 0 || searchResults.collectables.length > 0) && (
                                            <TouchableOpacity style={styles.seeMoreButton} onPress={handleSeeMore}>
                                                <Text style={styles.seeMoreText}>See more results</Text>
                                                <Ionicons name="arrow-forward" size={14} color={colors.primary} />
                                            </TouchableOpacity>
                                        )}
                                    </>
                                )}
                            </View>
                        </TouchableWithoutFeedback>
                    </View>
                </TouchableWithoutFeedback>
            )}

            {/* Filter Tabs - Threads style */}
            <View style={styles.filterBar}>
                {FILTERS.map(filter => {
                    const active = activeFilter === filter.key;
                    return (
                        <TouchableOpacity
                            key={filter.key}
                            onPress={() => setActiveFilter(filter.key)}
                            style={[styles.filterTab, active && styles.filterTabActive]}
                        >
                            <Text style={[styles.filterText, active && styles.filterTextActive]}>
                                {filter.label}
                            </Text>
                        </TouchableOpacity>
                    );
                })}
            </View>

            {/* Error */}
            {error ? (
                <View style={styles.errorBanner}>
                    <Text style={styles.errorText}>{error}</Text>
                </View>
            ) : null}

            {/* Content */}
            {loading && !refreshing ? (
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color={colors.primary} />
                </View>
            ) : (
                <FlatList
                    data={entries}
                    keyExtractor={(item, idx) => item.id ? `${item.id}-${activeFilter}` : (item.shelf?.id ? `${item.shelf.id}-${activeFilter}` : `entry-${idx}`)}
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
                    ItemSeparatorComponent={() => <View style={styles.separator} />}
                />
            )}
        </SafeAreaView>
    );
}

const createStyles = ({ colors, spacing, typography, shadows }) => StyleSheet.create({
    screen: {
        flex: 1,
        backgroundColor: colors.background,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: spacing.md,
        paddingTop: spacing.lg,
        paddingBottom: spacing.sm,
    },
    headerTitle: {
        fontSize: 28,
        fontFamily: typography.bold || 'System',
        fontWeight: '700',
        color: colors.text,
    },
    headerRight: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
    },
    headerButton: {
        padding: spacing.xs,
        position: 'relative',
    },
    badge: {
        position: 'absolute',
        top: -2,
        right: -2,
        minWidth: 16,
        height: 16,
        borderRadius: 8,
        backgroundColor: colors.error,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 3,
    },
    badgeText: {
        color: colors.textInverted,
        fontSize: 10,
        fontWeight: '700',
    },
    filterBar: {
        flexDirection: 'row',
        paddingHorizontal: spacing.md,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    filterTab: {
        flex: 1,
        paddingVertical: spacing.sm + 4,
        alignItems: 'center',
        borderBottomWidth: 2,
        borderBottomColor: 'transparent',
    },
    filterTabActive: {
        borderBottomColor: colors.text,
    },
    filterText: {
        fontSize: 15,
        fontWeight: '500',
        color: colors.textMuted,
    },
    filterTextActive: {
        color: colors.text,
        fontWeight: '600',
    },
    listContent: {
        padding: spacing.md,
        paddingBottom: 100,
    },
    feedCard: {
        backgroundColor: colors.surface,
        borderRadius: 12,
        padding: spacing.md,
        ...shadows.sm,
    },
    separator: {
        height: spacing.sm,
    },
    cardHeader: {
        flexDirection: 'row',
        marginBottom: spacing.sm,
    },
    avatar: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: colors.primary,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: spacing.sm,
        overflow: 'hidden', // Ensure image clips to border radius
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
    headerContent: {
        flex: 1,
    },
    headerTop: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    username: {
        fontSize: 15,
        fontWeight: '600',
        color: colors.text,
    },
    timestamp: {
        fontSize: 13,
        color: colors.textMuted,
    },
    shelfAction: {
        fontSize: 14,
        color: colors.textSecondary,
        marginTop: 2,
    },
    shelfName: {
        fontWeight: '600',
        color: colors.text,
    },
    description: {
        fontSize: 14,
        color: colors.textSecondary,
        lineHeight: 20,
        marginBottom: spacing.sm,
    },
    itemsPreview: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: spacing.xs,
        marginBottom: spacing.sm,
    },
    itemChip: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.surfaceElevated,
        paddingHorizontal: spacing.sm,
        paddingVertical: 4,
        borderRadius: 16,
        gap: 4,
    },
    itemTitle: {
        fontSize: 12,
        color: colors.textSecondary,
        maxWidth: 120,
    },
    moreItems: {
        fontSize: 12,
        color: colors.primary,
        fontWeight: '500',
        alignSelf: 'center',
    },
    coverRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: spacing.sm,
        paddingLeft: 4,
    },
    coverThumb: {
        width: 32,
        height: 48,
        borderRadius: 4,
        backgroundColor: colors.surfaceElevated,
        borderWidth: 1,
        borderColor: colors.border,
    },
    moreCoversChip: {
        width: 32,
        height: 48,
        borderRadius: 4,
        backgroundColor: colors.surfaceElevated,
        borderWidth: 1,
        borderColor: colors.border,
        marginLeft: -8,
        justifyContent: 'center',
        alignItems: 'center',
    },
    moreCoversText: {
        fontSize: 11,
        fontWeight: '600',
        color: colors.textMuted,
    },
    socialRow: {
        marginBottom: spacing.sm,
        gap: spacing.xs,
    },
    socialActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
    },
    socialButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: spacing.sm,
        paddingVertical: 6,
        borderRadius: 16,
        backgroundColor: colors.surfaceElevated,
    },
    socialButtonActive: {
        backgroundColor: colors.primary + '15',
    },
    socialButtonDisabled: {
        opacity: 0.6,
    },
    socialButtonText: {
        fontSize: 12,
        color: colors.textMuted,
        fontWeight: '500',
    },
    socialButtonTextActive: {
        color: colors.primary,
    },
    commentPreview: {
        fontSize: 12,
        color: colors.textSecondary,
    },
    cardFooter: {
        flexDirection: 'row',
        gap: spacing.md,
        paddingTop: spacing.sm,
        borderTopWidth: 1,
        borderTopColor: colors.border,
    },
    // Inline comment styles
    commentPreviewContainer: {
        marginBottom: spacing.sm,
    },
    commentPreviewRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    commentAvatar: {
        width: 20,
        height: 20,
        borderRadius: 10,
        backgroundColor: colors.surfaceElevated,
        justifyContent: 'center',
        alignItems: 'center',
        overflow: 'hidden',
    },
    commentAvatarImage: {
        width: '100%',
        height: '100%',
    },
    commentAvatarText: {
        fontSize: 10,
        fontWeight: '600',
        color: colors.textMuted,
    },
    commentPreview: {
        flex: 1,
        fontSize: 13,
        color: colors.textSecondary,
        lineHeight: 18,
    },
    commentContent: {
        color: colors.textSecondary,
    },
    commentTimestamp: {
        fontSize: 11,
        color: colors.textMuted,
        marginLeft: 4,
    },
    commentUsername: {
        fontWeight: '600',
        color: colors.text,
    },
    inlineCommentRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        marginTop: 4,
    },
    inlineCommentInput: {
        flex: 1,
        fontSize: 13,
        paddingVertical: 4,
        paddingHorizontal: spacing.sm,
        backgroundColor: colors.surfaceElevated,
        borderRadius: 16,
        color: colors.text,
        minHeight: 32,
        maxHeight: 80,
    },
    inlineCommentSend: {
        width: 28,
        height: 28,
        borderRadius: 14,
        backgroundColor: colors.primary,
        justifyContent: 'center',
        alignItems: 'center',
    },
    inlineCommentSendDisabled: {
        opacity: 0.5,
        backgroundColor: colors.textMuted,
    },
    footerStat: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    footerText: {
        fontSize: 12,
        color: colors.textMuted,
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
    emptyButton: {
        marginTop: spacing.lg,
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.sm,
        backgroundColor: colors.primary,
        borderRadius: 20,
    },
    emptyButtonText: {
        color: colors.textInverted,
        fontWeight: '600',
        fontSize: 14,
    },
    errorBanner: {
        backgroundColor: colors.error + '15',
        padding: spacing.sm,
        margin: spacing.md,
        borderRadius: 8,
    },
    errorText: {
        color: colors.error,
        textAlign: 'center',
        fontSize: 14,
    },
    // Inline search styles
    searchInputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.surface,
        borderRadius: 20,
        paddingHorizontal: spacing.sm,
        paddingVertical: 6,
        width: Dimensions.get('window').width * 0.60,  // 45% of screen width
        gap: 6,
        ...shadows.sm,
    },
    searchInput: {
        flex: 1,
        fontSize: 14,
        color: colors.text,
        paddingVertical: 0,
    },
    searchOverlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.3)',
        zIndex: 100,
    },
    searchDropdown: {
        position: 'absolute',
        top: 120,
        left: spacing.md,
        right: spacing.md,
        backgroundColor: colors.surface,
        borderRadius: 12,
        ...shadows.lg,
        maxHeight: 400,
        overflow: 'hidden',
    },
    searchLoadingContainer: {
        padding: spacing.lg,
        alignItems: 'center',
    },
    searchSection: {
        paddingBottom: spacing.sm,
    },
    searchSectionTitle: {
        fontSize: 11,
        fontWeight: '600',
        color: colors.textMuted,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        paddingHorizontal: spacing.md,
        paddingTop: spacing.md,
        paddingBottom: spacing.xs,
    },
    searchResultItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        gap: spacing.sm,
    },
    searchResultAvatar: {
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: colors.primary,
        justifyContent: 'center',
        alignItems: 'center',
    },
    searchResultAvatarText: {
        color: colors.textInverted,
        fontWeight: '600',
        fontSize: 14,
    },
    searchResultCover: {
        width: 36,
        height: 48,
        borderRadius: 4,
        backgroundColor: colors.surfaceElevated,
    },
    searchResultCoverFallback: {
        justifyContent: 'center',
        alignItems: 'center',
    },
    searchResultInfo: {
        flex: 1,
    },
    searchResultTitle: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.text,
    },
    searchResultSubtitle: {
        fontSize: 12,
        color: colors.textMuted,
        marginTop: 1,
    },
    searchEmptyState: {
        alignItems: 'center',
        padding: spacing.lg,
        gap: spacing.sm,
    },
    searchEmptyText: {
        fontSize: 14,
        color: colors.textMuted,
    },
    seeMoreButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingVertical: spacing.md,
        borderTopWidth: 1,
        borderTopColor: colors.border,
    },
    seeMoreText: {
        fontSize: 14,
        fontWeight: '500',
        color: colors.primary,
    },
    // Check-in event styles
    checkinAction: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        marginTop: 2,
    },
    checkinPreview: {
        flexDirection: 'row',
        gap: spacing.md,
        marginBottom: spacing.sm,
    },
    checkinCover: {
        width: 56,
        height: 76,
        borderRadius: 6,
        backgroundColor: colors.surfaceElevated,
    },
    checkinCoverFallback: {
        justifyContent: 'center',
        alignItems: 'center',
    },
    checkinInfo: {
        flex: 1,
        justifyContent: 'center',
    },
    checkinTitle: {
        fontSize: 15,
        fontWeight: '600',
        color: colors.text,
    },
    checkinCreator: {
        fontSize: 13,
        color: colors.textMuted,
        marginTop: 2,
    },
    kindBadge: {
        alignSelf: 'flex-start',
        backgroundColor: colors.primary + '15',
        paddingHorizontal: spacing.sm,
        paddingVertical: 2,
        borderRadius: 10,
        marginTop: 6,
    },
    kindText: {
        fontSize: 11,
        fontWeight: '500',
        color: colors.primary,
        textTransform: 'capitalize',
    },
    checkinNote: {
        fontSize: 14,
        color: colors.textSecondary,
        lineHeight: 20,
        marginBottom: spacing.sm,
        fontStyle: 'italic',
    },
});
