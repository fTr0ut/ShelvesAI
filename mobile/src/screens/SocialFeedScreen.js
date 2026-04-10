import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AccountSlideMenu, useGlobalSearch, GlobalSearchInput, GlobalSearchOverlay, MentionSuggestions } from '../components/ui';
import { useMentionInput } from '../hooks/useMentionInput';
import { ENABLE_PROFILE_IN_TAB_BAR } from '../config/featureFlags';
import NewsFeed from '../components/news/NewsFeed';
import NewsSection from '../components/news/NewsSection';
import QuickCheckInModal from '../components/news/QuickCheckInModal';
import { AuthContext } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { apiRequest, getValidToken } from '../services/api';
import { subscribeCheckInPosted } from '../services/checkInEvents';
import { toggleLike, addComment } from '../services/feedApi';
import { dismissNewsItem } from '../services/newsApi';
import { getShareableEventId, shareEntityLink } from '../services/shareLinks';
import { resolveCollectableCoverUrl, resolveManualCoverUrl } from '../utils/coverUrl';
import useBottomFooterLayout from '../navigation/useBottomFooterLayout';
import {
    buildAddedItemDetailParams,
    buildOwnerPhotoThumbnailUri,
    formatAddedEventHeader,
    getAddedItemDetails,
    getAddedPreviewItems,
    hasAddedItemDetailTarget,
    isAddedEventType,
    resolveAddedEventCount,
} from '../utils/feedAddedEvent';

const checkInBadge = require('../../assets/checkin_badge.png');

const FILTERS = [
    { key: 'all', label: 'All' },
    { key: 'friends', label: 'Friends' },
    { key: 'news', label: 'Discover' },
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

function formatAbsoluteDateTime(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    });
}

function getReviewedUpdatedLabel(item = {}, eventEntry = null) {
    const payload = item?.payload || null;
    const eventPayload = eventEntry?.payload || null;
    const published = item?.reviewPublishedAt
        || payload?.reviewPublishedAt
        || payload?.review_published_at
        || eventEntry?.reviewPublishedAt
        || eventPayload?.reviewPublishedAt
        || eventPayload?.review_published_at
        || eventEntry?.createdAt
        || eventEntry?.shelf?.createdAt
        || null;
    const updated = item?.reviewUpdatedAt
        || payload?.reviewUpdatedAt
        || payload?.review_updated_at
        || eventEntry?.reviewUpdatedAt
        || eventPayload?.reviewUpdatedAt
        || eventPayload?.review_updated_at
        || eventEntry?.updatedAt
        || eventEntry?.shelf?.updatedAt
        || null;
    if (!published || !updated) return null;
    const publishedTs = new Date(published).getTime();
    const updatedTs = new Date(updated).getTime();
    if (!Number.isFinite(publishedTs) || !Number.isFinite(updatedTs)) return null;
    if (updatedTs <= publishedTs) return null;
    const formatted = formatAbsoluteDateTime(updated);
    return formatted ? `Updated on ${formatted}` : null;
}

// --- Component ---
export default function SocialFeedScreen({ navigation, route }) {
    const { token, apiBase, user } = useContext(AuthContext);
    const { colors, spacing, typography, shadows, isDark } = useTheme();

    const [entries, setEntries] = useState([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState('');
    const [activeFilter, setActiveFilter] = useState('all');
    const [pendingLikes, setPendingLikes] = useState({});
    const [pendingShares, setPendingShares] = useState({});
    const [unreadCount, setUnreadCount] = useState(0);

    const isMountedRef = useRef(true);
    const search = useGlobalSearch(navigation);

    // Account menu state
    const [isMenuOpen, setIsMenuOpen] = useState(false);

    // Inline comment state
    const [commentTexts, setCommentTexts] = useState({});
    const [pendingComments, setPendingComments] = useState({});
    const [activeMentionTargetId, setActiveMentionTargetId] = useState(null);
    const mention = useMentionInput();
    const [pendingNewsDismissals, setPendingNewsDismissals] = useState({});
    const [truncatedReviewNotes, setTruncatedReviewNotes] = useState({});
    const [imageAuthToken, setImageAuthToken] = useState(null);
    const [addedThumbFailures, setAddedThumbFailures] = useState({});

    // Check-in modal state for news recommendations
    const [checkInModalVisible, setCheckInModalVisible] = useState(false);
    const [selectedNewsItem, setSelectedNewsItem] = useState(null);

    // Personalization refresh rate limiting (only refresh once per minute)
    const [lastPersonalizationRefresh, setLastPersonalizationRefresh] = useState(null);
    const PERSONALIZATION_RATE_LIMIT_MS = 60 * 1000; // 1 minute

    const handleNewsCheckIn = useCallback((newsItem) => {
        setSelectedNewsItem(newsItem);
        setCheckInModalVisible(true);
    }, []);

    const handleCloseCheckIn = useCallback(() => {
        setCheckInModalVisible(false);
        setSelectedNewsItem(null);
    }, []);

    const setPendingNewsDismiss = useCallback((newsItemId, isPending) => {
        if (!newsItemId) return;
        setPendingNewsDismissals((prev) => {
            const next = { ...prev };
            if (isPending) {
                next[newsItemId] = true;
            } else {
                delete next[newsItemId];
            }
            return next;
        });
    }, []);

    // Unmount guard: set isMountedRef to false on unmount
    useEffect(() => {
        return () => { isMountedRef.current = false; };
    }, []);

    useEffect(() => {
        let isActive = true;
        if (!token) {
            setImageAuthToken(null);
            return () => { isActive = false; };
        }
        (async () => {
            try {
                const resolved = await getValidToken(token, apiBase);
                if (isActive) setImageAuthToken(resolved || token);
            } catch (_err) {
                if (isActive) setImageAuthToken(token);
            }
        })();
        return () => { isActive = false; };
    }, [apiBase, token]);

    const load = useCallback(async (opts = {}) => {
        const { silent, forceRefreshPersonalizations } = opts;
        if (!token) {
            setEntries([]);
            setLoading(false);
            return;
        }
        if (!silent) setLoading(true);

        // Map tab key to backend scope
        let scope = 'global';
        if (activeFilter === 'friends') scope = 'friends';
        else if (activeFilter === 'all') scope = 'all';

        try {
            // Add refreshPersonalizations flag when rate limit allows
            let path = `/api/feed?scope=${scope}`;
            if (forceRefreshPersonalizations) {
                path += '&refreshPersonalizations=1';
            }
            const result = await apiRequest({ apiBase, path, token });
            if (!isMountedRef.current) return;
            // Filter out shelf.created events as requested (legacy logic preserved)
            const filtered = (result.entries || []).filter(e => e.eventType !== 'shelf.created');
            setEntries(filtered);
            setError('');
        } catch (err) {
            console.error('Feed load error:', err);
            if (!isMountedRef.current) return;
            setError('Unable to load feed');
        } finally {
            if (isMountedRef.current) {
                setLoading(false);
                setRefreshing(false);
            }
        }
    }, [apiBase, token, activeFilter]);

    const handleDismissNewsItem = useCallback(async (newsItem) => {
        const targetId = Number.parseInt(newsItem?.id, 10);
        if (!token || !Number.isFinite(targetId) || pendingNewsDismissals[targetId]) return;

        setEntries((prevEntries) => prevEntries
            .map((entry) => {
                if (!entry || entry.eventType !== 'news.recommendation') return entry;
                const entryItems = Array.isArray(entry.items) ? entry.items : [];
                const filteredItems = entryItems.filter((item) => Number.parseInt(item?.id, 10) !== targetId);
                if (!filteredItems.length) return null;
                return { ...entry, items: filteredItems, eventItemCount: filteredItems.length };
            })
            .filter(Boolean));

        setPendingNewsDismiss(targetId, true);
        try {
            await dismissNewsItem({ apiBase, token, newsItemId: targetId });
        } catch (err) {
            console.error('Dismiss news item error:', err);
        } finally {
            if (!isMountedRef.current) return;
            setPendingNewsDismiss(targetId, false);
            if (activeFilter === 'all') {
                load({ silent: true, forceRefreshPersonalizations: true });
            }
        }
    }, [activeFilter, apiBase, load, pendingNewsDismissals, setPendingNewsDismiss, token]);

    useEffect(() => { load(); }, [load]);

    const loadUnreadCount = useCallback(async () => {
        if (!token) {
            setUnreadCount(0);
            return;
        }
        try {
            const result = await apiRequest({ apiBase, path: '/api/notifications/unread-count', token });
            if (!isMountedRef.current) return;
            const count = result?.unreadCount ?? result?.count ?? 0;
            setUnreadCount(Number(count) || 0);
        } catch (err) {
            if (!isMountedRef.current) return;
            setUnreadCount(0);
        }
    }, [apiBase, token]);

    useEffect(() => { loadUnreadCount(); }, [loadUnreadCount]);

    useEffect(() => {
        const unsubscribe = navigation.addListener('focus', loadUnreadCount);
        return unsubscribe;
    }, [navigation, loadUnreadCount]);

    // Listen for tab press reset
    const lastResetTabRef = useRef(null);
    const feedListRef = useRef(null);
    const pendingCheckInRefreshRef = useRef(false);
    useEffect(() => {
        const resetTabTimestamp = route.params?.resetTab;
        if (resetTabTimestamp && resetTabTimestamp !== lastResetTabRef.current) {
            lastResetTabRef.current = resetTabTimestamp;
            if (activeFilter === 'all') {
                // Scroll to top and refresh
                feedListRef.current?.scrollToOffset?.({ offset: 0, animated: true });
                onRefresh();
            } else {
                setActiveFilter('all');
            }
        }
    }, [route.params?.resetTab, activeFilter, onRefresh]);

    const onRefresh = useCallback(() => {
        setRefreshing(true);

        // Check if we should refresh personalizations (rate-limited to once per minute)
        const now = Date.now();
        const canRefreshPersonalizations =
            activeFilter === 'all' &&
            (!lastPersonalizationRefresh ||
                now - lastPersonalizationRefresh >= PERSONALIZATION_RATE_LIMIT_MS);

        if (canRefreshPersonalizations) {
            setLastPersonalizationRefresh(now);
        }

        load({ silent: true, forceRefreshPersonalizations: canRefreshPersonalizations });
        loadUnreadCount();
    }, [activeFilter, lastPersonalizationRefresh, load, loadUnreadCount]);

    useEffect(() => {
        const unsubscribe = subscribeCheckInPosted((payload = {}) => {
            if (payload.originTab !== 'Home') return;
            pendingCheckInRefreshRef.current = true;

            if (!navigation.isFocused()) return;
            if (activeFilter !== 'all') {
                setActiveFilter('all');
                return;
            }
            pendingCheckInRefreshRef.current = false;
            feedListRef.current?.scrollToOffset?.({ offset: 0, animated: true });
            onRefresh();
        });
        return unsubscribe;
    }, [activeFilter, navigation, onRefresh]);

    useEffect(() => {
        const unsubscribe = navigation.addListener('focus', () => {
            if (!pendingCheckInRefreshRef.current) return;
            if (activeFilter !== 'all') {
                setActiveFilter('all');
                return;
            }
            pendingCheckInRefreshRef.current = false;
            feedListRef.current?.scrollToOffset?.({ offset: 0, animated: true });
            onRefresh();
        });
        return unsubscribe;
    }, [activeFilter, navigation, onRefresh]);

    useEffect(() => {
        if (!pendingCheckInRefreshRef.current) return;
        if (activeFilter !== 'all') return;
        if (!navigation.isFocused()) return;
        pendingCheckInRefreshRef.current = false;
        feedListRef.current?.scrollToOffset?.({ offset: 0, animated: true });
        onRefresh();
    }, [activeFilter, navigation, onRefresh]);

    // Debounced search handler
    const styles = useMemo(() => createStyles({ colors, spacing, typography, shadows }), [colors, spacing, typography, shadows]);
    const { contentBottomPadding } = useBottomFooterLayout();
    const feedListBottomPadding = contentBottomPadding(spacing.md);

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

    const setPendingShare = useCallback((targetId, isPending) => {
        if (!targetId) return;
        setPendingShares((prev) => {
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

        // Capture previous values from current entries state at the moment of the
        // optimistic update, not from the closure-captured `entry` parameter, to
        // avoid stale state when multiple rapid likes occur.
        let previous = { hasLiked: false, likeCount: 0 };
        let optimisticLiked = false;
        let optimisticCount = 0;

        setEntries((prevEntries) => {
            const current = prevEntries.find((e) => (e?.aggregateId || e?.id) === targetId);
            previous = {
                hasLiked: !!current?.hasLiked,
                likeCount: current?.likeCount || 0,
            };
            optimisticLiked = !previous.hasLiked;
            optimisticCount = Math.max(0, previous.likeCount + (optimisticLiked ? 1 : -1));
            return prevEntries.map((e) => {
                const eId = e?.aggregateId || e?.id;
                if (eId !== targetId) return e;
                return { ...e, hasLiked: optimisticLiked, likeCount: optimisticCount };
            });
        });
        setPendingLike(targetId, true);

        try {
            const response = await toggleLike({ apiBase, token, eventId: targetId });
            if (!isMountedRef.current) return;
            const resolvedLiked = typeof response?.liked === 'boolean' ? response.liked : optimisticLiked;
            const resolvedCount = typeof response?.likeCount === 'number' ? response.likeCount : optimisticCount;
            updateEntrySocial(targetId, { hasLiked: resolvedLiked, likeCount: resolvedCount });
        } catch (err) {
            if (!isMountedRef.current) return;
            updateEntrySocial(targetId, previous);
        } finally {
            if (isMountedRef.current) {
                setPendingLike(targetId, false);
            }
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

            if (!isMountedRef.current) return;

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
            if (isMountedRef.current) {
                setPendingComments(prev => {
                    const next = { ...prev };
                    delete next[targetId];
                    return next;
                });
            }
        }
    }, [apiBase, token, commentTexts, pendingComments, updateEntrySocial, user]);

    const handleShareEntry = useCallback(async (entry) => {
        const eventId = getShareableEventId(entry);
        if (!eventId || pendingShares[eventId]) return;
        setPendingShare(eventId, true);
        try {
            const ownerName = entry?.owner?.username || entry?.owner?.name || 'Someone';
            const shelfName = entry?.shelf?.name || 'ShelvesAI';
            await shareEntityLink({
                apiBase,
                kind: 'events',
                id: eventId,
                title: `${ownerName} - ${shelfName}`,
                slugSource: `${ownerName} ${shelfName}`,
            });
        } catch (_err) {
            if (isMountedRef.current) {
                Alert.alert('Unable to share', 'Please try again.');
            }
        } finally {
            if (isMountedRef.current) {
                setPendingShare(eventId, false);
            }
        }
    }, [apiBase, pendingShares, setPendingShare]);

    const renderSocialActions = (entry) => {
        const targetId = entry?.aggregateId || entry?.id;
        const shareId = getShareableEventId(entry);
        const hasLiked = !!entry?.hasLiked;
        const likeCount = entry?.likeCount || 0;
        const commentCount = entry?.commentCount || 0;
        const topComment = entry?.topComment || null;
        const likeLabel = likeCount > 0 ? `${likeCount} Like${likeCount === 1 ? '' : 's'}` : 'Like';
        const commentLabel = commentCount > 0 ? `${commentCount} Comment${commentCount === 1 ? '' : 's'}` : 'Comment';
        const isPending = !!(targetId && pendingLikes[targetId]);
        const isSharePending = !!(shareId && pendingShares[shareId]);

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
                    <TouchableOpacity
                        style={[
                            styles.socialButton,
                            (isSharePending || !shareId) && styles.socialButtonDisabled,
                        ]}
                        onPress={() => handleShareEntry(entry)}
                        disabled={isSharePending || !shareId}
                    >
                        {isSharePending ? (
                            <ActivityIndicator size="small" color={colors.textMuted} />
                        ) : (
                            <Ionicons name="share-social-outline" size={16} color={colors.textMuted} />
                        )}
                        <Text style={styles.socialButtonText}>Share</Text>
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
                <View style={[styles.inlineCommentRow, { position: 'relative', zIndex: activeMentionTargetId === targetId ? 999 : 0 }]}>
                    {activeMentionTargetId === targetId && (
                        <MentionSuggestions
                            suggestions={mention.suggestions}
                            visible={mention.showSuggestions}
                            onSelect={(friend) => {
                                const currentText = commentTexts[targetId] || '';
                                const newText = mention.selectMention(friend, currentText);
                                setCommentTexts(prev => ({ ...prev, [targetId]: newText }));
                            }}
                            loading={mention.loading}
                        />
                    )}
                    <TextInput
                        style={styles.inlineCommentInput}
                        placeholder="Add a comment..."
                        placeholderTextColor={colors.textMuted}
                        value={commentText}
                        onChangeText={(text) => {
                            setCommentTexts(prev => ({ ...prev, [targetId]: text }));
                            setActiveMentionTargetId(targetId);
                            mention.handleTextChange(text);
                        }}
                        onSelectionChange={mention.handleSelectionChange}
                        selectionColor={colors.primary}
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
        const isCheckinRated = eventType === 'checkin.rated';
        const isNewsRecommendation = eventType === 'news.recommendation';
        const isReviewedEvent = eventType === 'reviewed';
        const timeAgo = formatRelativeTime((isCheckIn || isCheckinRated) ? item.createdAt : shelf?.updatedAt);
        const displayName = isNewsRecommendation ? 'Discover' : (owner?.name || owner?.username || 'Someone');
        const initial = displayName.charAt(0).toUpperCase();

        let avatarSource = null;
        if (owner?.profileMediaUrl) {
            avatarSource = { uri: owner.profileMediaUrl };
        } else if (owner?.profileMediaPath) {
            avatarSource = { uri: `${apiBase}/media/${owner.profileMediaPath}` };
        } else if (owner?.picture) {
            avatarSource = { uri: owner.picture };
        }

        const handlePress = () => {
            if (isNewsRecommendation) {
                setActiveFilter('news');
                return;
            }
            if (isCheckIn) {
                // Check-in events now navigate to FeedDetail (event details)
                // The item preview inside handles navigation to the collectable
                navigation.navigate('FeedDetail', { entry: item });
            } else if (eventType === 'item.rated') {
                // Rating events navigate to FeedDetail to show all rated items
                navigation.navigate('FeedDetail', { entry: item });
            } else if (isReviewedEvent) {
                navigation.navigate('FeedDetail', { entry: item });
            } else if (eventType && (eventType.includes('added') || eventType.includes('removed'))) {
                navigation.navigate('FeedDetail', { entry: item });
            } else {
                navigation.navigate('ShelfDetail', { id: shelf?.id, title: shelf?.name });
            }
        };

        const isRatingEvent = eventType === 'item.rated';
        const isRatingLikeEvent = isRatingEvent || isReviewedEvent;

        if (isNewsRecommendation) {
            // Extract category and itemType from metadata or first item
            const groupKey = item?.metadata?.groupKey || '';
            const [category, itemType] = groupKey.split(':');
            const newsItems = items || [];
            const sectionTitle = item?.displayHints?.sectionTitle || 'Discover picks';
            const newsTime = formatRelativeTime(item.createdAt);

            // Render as event-card framed slider matching other feed entries
            return (
                <View style={styles.feedCard}>
                    {/* Header matching other feed cards */}
                    <View style={styles.cardHeader}>
                        <View style={[styles.avatar, styles.newsAvatar]}>
                            <Ionicons name="newspaper-outline" size={20} color={colors.primary} />
                        </View>
                        <View style={styles.headerContent}>
                            <View style={styles.headerTop}>
                                <Text style={styles.username}>{displayName}</Text>
                                <Text style={styles.timestamp}>{newsTime}</Text>
                            </View>
                            <Text style={styles.shelfAction}>{sectionTitle}</Text>
                        </View>
                    </View>

                    {/* Horizontal slider with news cards */}
                    <NewsSection
                        category={category || newsItems[0]?.category}
                        itemType={itemType || newsItems[0]?.itemType}
                        items={newsItems}
                        onCheckIn={handleNewsCheckIn}
                        onDismiss={handleDismissNewsItem}
                        hideHeader={true}
                    />
                </View>
            );
        }

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

            // Get manual from entry for check-ins
            const manual = item.manual || item.manualItem || item.manualSnapshot || null;

            // Resolve cover URL with manual fallback
            let collectableCoverUrl = resolveCollectableCoverUrl(collectable, apiBase);
            if (!collectableCoverUrl && manual) {
                collectableCoverUrl = resolveManualCoverUrl(manual, apiBase);
            }

            const handleCheckinCollectablePress = () => {
                if (collectable?.id) {
                    navigation.navigate('CollectableDetail', { item: { collectable }, ownerId: owner?.id });
                }
            };

            return (
                <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={handlePress}
                    style={styles.feedCard}
                >
                    {/* Check-in Badge */}
                    <Image source={checkInBadge} style={styles.checkinBadge} resizeMode="contain" />

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

        // Rating event rendering
        if (isRatingLikeEvent) {
            const ratingItems = items || [];
            const totalRated = item?.eventItemCount || ratingItems.length || 0;

            // Helper to render star rating
            const renderStars = (rating) => {
                const fullStars = Math.floor(rating);
                const hasHalf = rating % 1 >= 0.5;
                const stars = [];
                for (let i = 0; i < 5; i++) {
                    if (i < fullStars) {
                        stars.push(<Ionicons key={i} name="star" size={12} color="#FFD700" />);
                    } else if (i === fullStars && hasHalf) {
                        stars.push(<Ionicons key={i} name="star-half" size={12} color="#FFD700" />);
                    } else {
                        stars.push(<Ionicons key={i} name="star-outline" size={12} color="#FFD700" />);
                    }
                }
                return <View style={{ flexDirection: 'row' }}>{stars}</View>;
            };

            // Get cover items with ratings
            const ratingPreviews = ratingItems.slice(0, 3).map(e => {
                let coverUrl = resolveCollectableCoverUrl(e.collectable, apiBase);

                // Fallback to item itself (manual items often have flattened props)
                if (!coverUrl) {
                    coverUrl = resolveCollectableCoverUrl(e, apiBase);
                }

                // Fallback to manual property if present
                if (!coverUrl && e.manual) {
                    coverUrl = resolveManualCoverUrl(e.manual, apiBase);
                }

                // Determine title with multiple fallbacks
                const title = e.collectable?.title || e.title || e.manual?.title || 'Untitled';

                const collectableId = e.collectable?.id || e.collectableId || e.collectable_id || null;

                return {
                    title,
                    coverUrl,
                    collectableId,
                    rating: e.rating || 0,
                    notes: e.notes || null,
                    reviewPublishedAt: e.reviewPublishedAt || e?.payload?.reviewPublishedAt || e?.payload?.review_published_at || null,
                    reviewUpdatedAt: e.reviewUpdatedAt || e?.payload?.reviewUpdatedAt || e?.payload?.review_updated_at || null,
                };
            });
            const featuredReviewNote = isReviewedEvent
                ? String(ratingPreviews[0]?.notes || '').trim()
                : '';
            const featuredReview = ratingPreviews[0] || null;
            const featuredReviewRating = Number(featuredReview?.rating);
            const hasFeaturedReviewRating = Number.isFinite(featuredReviewRating) && featuredReviewRating > 0;
            const featuredReviewUpdatedLabel = getReviewedUpdatedLabel(featuredReview || {}, item);
            const hasFeaturedReviewUpdate = !!featuredReviewUpdatedLabel;
            const reviewedCardKey = String(
                item?.eventId
                || item?.id
                || item?.aggregateId
                || `${item?.createdAt || ''}:${featuredReview?.title || ''}`,
            );
            const reviewNoteIsTruncated = !!truncatedReviewNotes[reviewedCardKey];

            if (isReviewedEvent) {
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
                                    <View style={styles.reviewedHeaderMeta}>
                                        <Text style={styles.timestamp}>{timeAgo}</Text>
                                        {hasFeaturedReviewUpdate ? (
                                            <View style={styles.reviewedUpdatedBadge}>
                                                <Text style={styles.reviewedUpdatedBadgeText}>Updated</Text>
                                            </View>
                                        ) : null}
                                    </View>
                                </View>
                                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                    <Ionicons
                                        name="create-outline"
                                        size={14}
                                        color={colors.primary}
                                        style={{ marginRight: 4 }}
                                    />
                                    <Text style={styles.shelfAction}>
                                        reviewed{' '}
                                        <Text style={styles.shelfName}>
                                            {totalRated === 1
                                                ? featuredReview?.title
                                                : `${totalRated} item${totalRated === 1 ? '' : 's'}`}
                                        </Text>
                                    </Text>
                                </View>
                            </View>
                        </View>

                        <View style={styles.reviewedBodyRow}>
                            <TouchableOpacity
                                style={styles.reviewedThumbColumn}
                                activeOpacity={featuredReview?.collectableId ? 0.7 : 1}
                                disabled={!featuredReview?.collectableId}
                                onPress={() => {
                                    if (featuredReview?.collectableId) {
                                        navigation.navigate('CollectableDetail', { collectableId: String(featuredReview.collectableId), ownerId: owner?.id });
                                    }
                                }}
                            >
                                {featuredReview?.coverUrl ? (
                                    <Image
                                        source={{ uri: featuredReview.coverUrl }}
                                        style={styles.coverThumb}
                                        resizeMode="cover"
                                    />
                                ) : (
                                    <View style={[styles.coverThumb, { backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center' }]}>
                                        <Ionicons name="book" size={20} color={colors.primary} />
                                    </View>
                                )}
                                {hasFeaturedReviewRating ? (
                                    <View style={styles.reviewedThumbRating}>
                                        {renderStars(featuredReviewRating)}
                                    </View>
                                ) : null}
                            </TouchableOpacity>
                            <View style={styles.reviewedTextColumn}>
                                {featuredReviewNote ? (
                                    <Text
                                        style={styles.reviewedNoteInline}
                                        numberOfLines={5}
                                        onTextLayout={(event) => {
                                            const lineCount = Array.isArray(event?.nativeEvent?.lines) ? event.nativeEvent.lines.length : 0;
                                            const nextIsTruncated = lineCount > 5;
                                            setTruncatedReviewNotes((prev) => (
                                                prev[reviewedCardKey] === nextIsTruncated
                                                    ? prev
                                                    : { ...prev, [reviewedCardKey]: nextIsTruncated }
                                            ));
                                        }}
                                    >
                                        {featuredReviewNote}
                                    </Text>
                                ) : (
                                    <Text style={styles.reviewedNoteInlineMuted}>
                                        No written review provided.
                                    </Text>
                                )}
                                {featuredReviewNote && reviewNoteIsTruncated ? (
                                    <Text style={styles.reviewedReadMoreHint}>
                                        n/ <Text style={styles.reviewedReadMoreHintItalic}>click to read more</Text>
                                    </Text>
                                ) : null}
                                {totalRated > 1 ? (
                                    <Text style={styles.reviewedMoreItemsText}>
                                        +{totalRated - 1} more reviewed item{totalRated - 1 === 1 ? '' : 's'}
                                    </Text>
                                ) : null}
                            </View>
                        </View>
                        {featuredReviewUpdatedLabel ? (
                            <Text style={styles.reviewedUpdatedOn}>{featuredReviewUpdatedLabel}</Text>
                        ) : null}

                        {renderSocialActions(item)}
                    </TouchableOpacity>
                );
            }

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
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                <Ionicons
                                    name={isReviewedEvent ? 'create-outline' : 'star'}
                                    size={14}
                                    color={isReviewedEvent ? colors.primary : '#FFD700'}
                                    style={{ marginRight: 4 }}
                                />
                                <Text style={styles.shelfAction}>
                                    {isReviewedEvent ? 'reviewed ' : 'rated '}
                                    <Text style={styles.shelfName}>
                                        {totalRated === 1
                                            ? ratingPreviews[0]?.title
                                            : `${totalRated} item${totalRated === 1 ? '' : 's'}`}
                                    </Text>
                                </Text>
                            </View>
                        </View>
                    </View>

                    {/* Rating items with stars */}
                    {ratingPreviews.length > 0 && (
                        <View style={styles.coverRow}>
                            {ratingPreviews.map((ratingItem, idx) => (
                                <TouchableOpacity
                                    key={idx}
                                    style={{ alignItems: 'center', marginRight: 8 }}
                                    activeOpacity={ratingItem.collectableId ? 0.7 : 1}
                                    disabled={!ratingItem.collectableId}
                                    onPress={() => {
                                        if (ratingItem.collectableId) {
                                            navigation.navigate('CollectableDetail', { collectableId: String(ratingItem.collectableId), ownerId: owner?.id });
                                        }
                                    }}
                                >
                                    {ratingItem.coverUrl ? (
                                        <Image
                                            source={{ uri: ratingItem.coverUrl }}
                                            style={styles.coverThumb}
                                            resizeMode="cover"
                                        />
                                    ) : (
                                        <View style={[styles.coverThumb, { backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center' }]}>
                                            <Ionicons name="book" size={20} color={colors.primary} />
                                        </View>
                                    )}
                                    {renderStars(ratingItem.rating)}
                                </TouchableOpacity>
                            ))}
                            {totalRated > ratingPreviews.length && (
                                <View style={styles.moreCoversChip}>
                                    <Text style={styles.moreCoversText}>+{totalRated - ratingPreviews.length}</Text>
                                </View>
                            )}
                        </View>
                    )}

                    {renderSocialActions(item)}
                </TouchableOpacity>
            );
        }

        // Combined check-in + rating event rendering
        if (isCheckinRated) {
            const statusLabels = {
                starting: 'started',
                continuing: 'is continuing',
                completed: 'finished',
            };
            const statusLabel = statusLabels[checkinStatus] || checkinStatus;
            const rating = item.rating || 0;

            // Get manual from entry for check-ins
            const manual = item.manual || item.manualItem || item.manualSnapshot || null;

            // Resolve cover URL with manual fallback
            let collectableCoverUrl = resolveCollectableCoverUrl(collectable, apiBase);
            if (!collectableCoverUrl && manual) {
                collectableCoverUrl = resolveManualCoverUrl(manual, apiBase);
            }

            // Helper to render star rating inline
            const renderInlineStars = (ratingValue, size = 14) => {
                const fullStars = Math.floor(ratingValue);
                const hasHalf = ratingValue % 1 >= 0.5;
                const stars = [];
                for (let i = 0; i < 5; i++) {
                    if (i < fullStars) {
                        stars.push(<Ionicons key={i} name="star" size={size} color="#FFD700" />);
                    } else if (i === fullStars && hasHalf) {
                        stars.push(<Ionicons key={i} name="star-half" size={size} color="#FFD700" />);
                    } else {
                        stars.push(<Ionicons key={i} name="star-outline" size={size} color="#FFD700" />);
                    }
                }
                return <View style={{ flexDirection: 'row' }}>{stars}</View>;
            };

            const handleCheckinRatedPress = () => {
                navigation.navigate('FeedDetail', { entry: item });
            };

            const handleCheckinRatedCollectablePress = () => {
                if (collectable?.id) {
                    navigation.navigate('CollectableDetail', { item: { collectable }, ownerId: owner?.id });
                }
            };

            return (
                <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={handleCheckinRatedPress}
                    style={styles.feedCard}
                >
                    {/* Check-in Badge */}
                    <Image source={checkInBadge} style={styles.checkinBadge} resizeMode="contain" />

                    {/* Header with stars */}
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
                            <View style={styles.checkinRatedAction}>
                                <Text style={styles.shelfAction}>
                                    {statusLabel}{' '}
                                </Text>
                                {renderInlineStars(rating, 12)}
                                <Text style={[styles.shelfAction, { marginLeft: 4 }]}>
                                    <Text style={styles.shelfName}>{collectable?.title || 'something'}</Text>
                                </Text>
                            </View>
                        </View>
                    </View>

                    {/* Collectable preview with rating stars */}
                    <TouchableOpacity
                        style={styles.checkinPreview}
                        onPress={handleCheckinRatedCollectablePress}
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
                            {/* Stars below the item info */}
                            <View style={styles.checkinRatingRow}>
                                {renderInlineStars(rating, 16)}
                            </View>
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
        const isAddedEvent = isAddedEventType(eventType);
        const totalItems = isAddedEvent ? resolveAddedEventCount(item) : (item?.eventItemCount || items?.length || 0);
        const previewItems = getAddedPreviewItems(items || [], apiBase, 3);
        const isOtherShelfAdded = isAddedEvent && String(shelf?.type || '').toLowerCase() === 'other';
        const addedHeaderText = isAddedEvent
            ? formatAddedEventHeader({
                shelf,
                eventItemCount: totalItems,
                items: items || [],
            })
            : null;
        const addedImageHeaders = imageAuthToken
            ? { Authorization: `Bearer ${imageAuthToken}`, 'ngrok-skip-browser-warning': 'true' }
            : null;
        const coverItems = previewItems.filter((preview) => !!preview.coverUrl).slice(0, 3);
        const singleAddedItem = isAddedEvent && totalItems === 1
            ? getAddedItemDetails((items || [])[0] || {}, apiBase)
            : null;
        const getThumbFailureKey = (entryKey, detail, idx) => `${entryKey}:${detail?.itemId || detail?.name || idx}`;
        const getOwnerThumbSource = (entryKey, detail, idx) => {
            if (!addedImageHeaders) return null;
            const thumbUri = buildOwnerPhotoThumbnailUri({
                apiBase,
                shelfId: shelf?.id,
                itemId: detail?.itemId,
            });
            if (!thumbUri) return null;
            const failureKey = getThumbFailureKey(entryKey, detail, idx);
            if (addedThumbFailures[failureKey]) return null;
            return { uri: thumbUri, headers: addedImageHeaders };
        };
        const handleAddedDetailPress = (detail, event) => {
            event?.stopPropagation?.();
            const params = buildAddedItemDetailParams(detail, owner?.id);
            if (params) {
                navigation.navigate('CollectableDetail', params);
            }
        };
        const stopNestedPress = (event) => {
            event?.stopPropagation?.();
        };

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
                            {isAddedEvent ? (
                                addedHeaderText
                            ) : (
                                <>
                                    {actionText}{' '}
                                    <Text style={styles.shelfName}>{shelf?.name || 'a shelf'}</Text>
                                </>
                            )}
                        </Text>
                    </View>
                </View>

                {singleAddedItem ? (
                    <View style={styles.singleAddedRow}>
                        {(() => {
                            const entryKey = item?.aggregateId || item?.id || item?.createdAt || 'entry';
                            const ownerSource = getOwnerThumbSource(entryKey, singleAddedItem, 0);
                            const standardSource = singleAddedItem.coverUrl ? { uri: singleAddedItem.coverUrl } : null;
                            const imageSource = standardSource || ownerSource;
                            const hasDetailTarget = hasAddedItemDetailTarget(singleAddedItem);
                            if (!imageSource) {
                                return (
                                    <View style={[styles.coverThumb, styles.singleAddedThumb]}>
                                        <Ionicons name="book-outline" size={20} color={colors.textMuted} />
                                    </View>
                                );
                            }
                            return (
                                <TouchableOpacity
                                    activeOpacity={hasDetailTarget ? 0.7 : 1}
                                    disabled={!hasDetailTarget}
                                    onPress={(event) => handleAddedDetailPress(singleAddedItem, event)}
                                    onPressIn={stopNestedPress}
                                >
                                    <Image
                                        source={imageSource}
                                        style={[styles.coverThumb, styles.singleAddedThumb]}
                                        resizeMode="cover"
                                        onError={() => {
                                            if (!ownerSource) return;
                                            const failureKey = getThumbFailureKey(entryKey, singleAddedItem, 0);
                                            setAddedThumbFailures((prev) => ({ ...prev, [failureKey]: true }));
                                        }}
                                    />
                                </TouchableOpacity>
                            );
                        })()}
                        <View style={styles.singleAddedMeta}>
                            <TouchableOpacity
                                activeOpacity={hasAddedItemDetailTarget(singleAddedItem) ? 0.7 : 1}
                                disabled={!hasAddedItemDetailTarget(singleAddedItem)}
                                onPress={(event) => handleAddedDetailPress(singleAddedItem, event)}
                                onPressIn={stopNestedPress}
                            >
                                <Text style={styles.singleAddedTitle} numberOfLines={1}>{singleAddedItem.name}</Text>
                            </TouchableOpacity>
                            <Text style={styles.singleAddedSubtext} numberOfLines={1}>
                                {[singleAddedItem.creator, singleAddedItem.year].filter(Boolean).join(' • ') || ' '}
                            </Text>
                            {singleAddedItem.rating != null && singleAddedItem.rating > 0 && (
                                <View style={{ flexDirection: 'row', marginTop: 2 }}>
                                    {Array.from({ length: 5 }, (_, i) => {
                                        const r = singleAddedItem.rating;
                                        if (i < Math.floor(r)) return <Ionicons key={i} name="star" size={12} color="#FFD700" />;
                                        if (i === Math.floor(r) && r % 1 >= 0.5) return <Ionicons key={i} name="star-half" size={12} color="#FFD700" />;
                                        return <Ionicons key={i} name="star-outline" size={12} color="#FFD700" />;
                                    })}
                                </View>
                            )}
                        </View>
                    </View>
                ) : null}

                {(isAddedEvent && totalItems > 1 && isOtherShelfAdded) ? (
                    <View style={styles.coverRow}>
                        {previewItems.map((preview, idx) => {
                            const entryKey = item?.aggregateId || item?.id || item?.createdAt || 'entry';
                            const ownerSource = getOwnerThumbSource(entryKey, preview, idx);
                            const failureKey = getThumbFailureKey(entryKey, preview, idx);
                            const previewKey = `${entryKey}-${preview.itemId || preview.manualId || preview.name || 'preview'}-${idx}-other-thumb`;
                            if (ownerSource) {
                                return (
                                    <TouchableOpacity
                                        key={previewKey}
                                        activeOpacity={hasAddedItemDetailTarget(preview) ? 0.7 : 1}
                                        disabled={!hasAddedItemDetailTarget(preview)}
                                        onPress={(event) => handleAddedDetailPress(preview, event)}
                                        onPressIn={stopNestedPress}
                                    >
                                        <Image
                                            source={ownerSource}
                                            style={[styles.coverThumb, idx > 0 && { marginLeft: -8 }]}
                                            resizeMode="cover"
                                            onError={() => {
                                                setAddedThumbFailures((prev) => ({ ...prev, [failureKey]: true }));
                                            }}
                                        />
                                    </TouchableOpacity>
                                );
                            }
                            return (
                                <View
                                    key={previewKey}
                                    style={[styles.coverThumb, idx > 0 && { marginLeft: -8 }, styles.otherThumbPlaceholder]}
                                >
                                    <Ionicons name="book-outline" size={18} color={colors.textMuted} />
                                </View>
                            );
                        })}
                        {totalItems > previewItems.length && (
                            <View style={styles.moreCoversChip}>
                                <Text style={styles.moreCoversText}>+{totalItems - previewItems.length}</Text>
                            </View>
                        )}
                    </View>
                ) : null}

                {(isAddedEvent && totalItems > 1 && !isOtherShelfAdded && (coverItems.length > 0 || previewItems.some((p) => !!p.itemId))) && (
                    <View style={styles.coverRow}>
                        {previewItems.slice(0, 3).map((preview, idx) => {
                            const entryKey = item?.aggregateId || item?.id || item?.createdAt || 'entry';
                            const ownerSource = !preview.coverUrl ? getOwnerThumbSource(entryKey, preview, idx) : null;
                            const failureKey = getThumbFailureKey(entryKey, preview, idx);
                            const imageSource = preview.coverUrl
                                ? { uri: preview.coverUrl }
                                : ownerSource;
                            const hasDetailTarget = hasAddedItemDetailTarget(preview);
                            if (!imageSource) {
                                return (
                                    <View
                                        key={`${entryKey}-${preview.itemId || preview.name || idx}-fallback`}
                                        style={[styles.coverThumb, idx > 0 && { marginLeft: -8 }, { backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center' }]}
                                    >
                                        <Ionicons name="book-outline" size={18} color={colors.textMuted} />
                                    </View>
                                );
                            }
                            return (
                                <TouchableOpacity
                                    key={`${entryKey}-${preview.itemId || preview.name || idx}-cover`}
                                    activeOpacity={hasDetailTarget ? 0.7 : 1}
                                    disabled={!hasDetailTarget}
                                    onPress={(event) => handleAddedDetailPress(preview, event)}
                                    onPressIn={stopNestedPress}
                                >
                                    <Image
                                        source={imageSource}
                                        style={[
                                            styles.coverThumb,
                                            idx > 0 && { marginLeft: -8 },
                                        ]}
                                        resizeMode="cover"
                                        onError={() => {
                                            if (!ownerSource) return;
                                            setAddedThumbFailures((prev) => ({ ...prev, [failureKey]: true }));
                                        }}
                                    />
                                </TouchableOpacity>
                            );
                        })}
                        {totalItems > Math.min(previewItems.length, 3) && (
                            <View style={styles.moreCoversChip}>
                                <Text style={styles.moreCoversText}>+{totalItems - Math.min(previewItems.length, 3)}</Text>
                            </View>
                        )}
                    </View>
                )}

                {/* Items preview - text fallback when no covers and no owner photo thumbs */}
                {(isAddedEvent && totalItems > 1 && !isOtherShelfAdded && coverItems.length === 0 && !previewItems.some((p) => !!p.itemId) && previewItems.length > 0) && (
                    <View style={styles.itemsPreview}>
                        {previewItems.map((entry, idx) => (
                            <TouchableOpacity
                                key={idx}
                                style={styles.itemChip}
                                activeOpacity={hasAddedItemDetailTarget(entry) ? 0.7 : 1}
                                disabled={!hasAddedItemDetailTarget(entry)}
                                onPress={(event) => handleAddedDetailPress(entry, event)}
                                onPressIn={stopNestedPress}
                            >
                                <Ionicons name="book" size={12} color={colors.primary} />
                                <Text style={styles.itemTitle} numberOfLines={1}>{entry?.name || 'Untitled'}</Text>
                                {entry?.rating != null && entry.rating > 0 && (
                                    <View style={{ flexDirection: 'row', marginLeft: 4 }}>
                                        {Array.from({ length: 5 }, (_, i) => {
                                            const r = entry.rating;
                                            if (i < Math.floor(r)) return <Ionicons key={i} name="star" size={10} color="#FFD700" />;
                                            if (i === Math.floor(r) && r % 1 >= 0.5) return <Ionicons key={i} name="star-half" size={10} color="#FFD700" />;
                                            return <Ionicons key={i} name="star-outline" size={10} color="#FFD700" />;
                                        })}
                                    </View>
                                )}
                            </TouchableOpacity>
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

    // Conditional content renderer
    const renderContent = () => {
        if (activeFilter === 'news') {
            return <NewsFeed />;
        }

        // Default Feed List
        return (
            <FlatList
                ref={feedListRef}
                data={entries}
                renderItem={renderItem}
                keyExtractor={(item) => item?.aggregateId || item?.id || Math.random().toString()}
                contentContainerStyle={[styles.listContent, { paddingBottom: feedListBottomPadding }]}
                showsVerticalScrollIndicator={false}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={onRefresh}
                        tintColor={colors.primary}
                        colors={[colors.primary]}
                    />
                }
                ItemSeparatorComponent={() => <View style={styles.separator} />}
                ListHeaderComponent={
                    <View style={styles.headerSpacer} />
                }
                ListFooterComponent={
                    loading ? (
                        <ActivityIndicator style={styles.loader} color={colors.primary} />
                    ) : entries.length === 0 ? (
                        renderEmpty()
                    ) : (
                        <View style={{ height: spacing.sm }} />
                    )
                }
            />
        );
    };

    return (
        <SafeAreaView style={styles.screen} edges={['top']}>
            <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />

            {/* Header with global search */}
            <View style={styles.header}>
                <GlobalSearchInput search={search} />
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
                    {!ENABLE_PROFILE_IN_TAB_BAR && (
                        <TouchableOpacity onPress={() => setIsMenuOpen(true)} style={styles.headerButton}>
                            <Ionicons name="person-circle-outline" size={26} color={colors.text} />
                        </TouchableOpacity>
                    )}
                </View>
            </View>

            {/* Body: sub-header, filters, content — wrapped so overlay covers this area */}
            <View style={styles.body}>
                {/* Sub-header: Feed title */}
                <View style={styles.subHeader}>
                    <Text style={styles.headerTitle}>Feed</Text>
                </View>

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

                {/* Content Body */}
                {renderContent()}

                {/* Search overlay — absolutely positioned over body */}
                <GlobalSearchOverlay search={search} />
            </View>

            {/* Account Slide Menu */}
            {!ENABLE_PROFILE_IN_TAB_BAR && (
                <AccountSlideMenu
                    isVisible={isMenuOpen}
                    onClose={() => setIsMenuOpen(false)}
                    navigation={navigation}
                    user={user}
                />
            )}

            {/* Quick Check-In Modal for News Items */}
            <QuickCheckInModal
                visible={checkInModalVisible}
                onClose={handleCloseCheckIn}
                onSuccess={() => onRefresh()}
                newsItem={selectedNewsItem}
            />
        </SafeAreaView>
    );
}

const createStyles = ({ colors, spacing, typography, shadows }) => StyleSheet.create({
    screen: {
        flex: 1,
        backgroundColor: colors.background,
    },
    body: {
        flex: 1,
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
    subHeader: {
        paddingHorizontal: spacing.md,
        paddingTop: spacing.sm,
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
    },
    feedCard: {
        backgroundColor: colors.surface,
        borderRadius: 12,
        padding: spacing.lg, // Increased from md
        ...shadows.sm,
    },
    separator: {
        height: spacing.md,
    },
    cardHeader: {
        flexDirection: 'row',
        marginBottom: spacing.md, // Increased from sm
    },
    avatar: {
        width: 48, // Increased from 40
        height: 48, // Increased from 40
        borderRadius: 24,
        backgroundColor: colors.primary,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: spacing.md, // Increased from sm
        overflow: 'hidden', // Ensure image clips to border radius
    },
    avatarImage: {
        width: '100%',
        height: '100%',
    },
    avatarText: {
        color: colors.textInverted,
        fontSize: 18, // Increased from 16
        fontWeight: '600',
    },
    headerContent: {
        flex: 1,
        justifyContent: 'center', // Added to help align with larger avatar
    },
    headerTop: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 2, // Added spacing
    },
    username: {
        fontSize: 16, // Increased from 15
        fontWeight: '600',
        color: colors.text,
    },
    timestamp: {
        fontSize: 13,
        color: colors.textMuted,
    },
    reviewedHeaderMeta: {
        alignItems: 'flex-end',
    },
    reviewedUpdatedBadge: {
        marginTop: 4,
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 999,
        backgroundColor: colors.primary + '1F',
        borderWidth: 1,
        borderColor: colors.primary + '55',
    },
    reviewedUpdatedBadgeText: {
        fontSize: 10,
        fontWeight: '700',
        color: colors.primary,
        textTransform: 'uppercase',
        letterSpacing: 0.3,
    },
    shelfAction: {
        fontSize: 15, // Increased from 14
        color: colors.textSecondary,
        marginTop: 2,
    },
    shelfName: {
        fontWeight: '600',
        color: colors.text,
    },
    singleAddedRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: spacing.md,
    },
    singleAddedThumb: {
        width: 64,
        height: 90,
        borderRadius: 8,
        marginRight: spacing.md,
    },
    singleAddedMeta: {
        flex: 1,
    },
    singleAddedTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.text,
        marginBottom: 4,
    },
    singleAddedSubtext: {
        fontSize: 13,
        color: colors.textMuted,
    },
    description: {
        fontSize: 15, // Increased from 14
        color: colors.textSecondary,
        lineHeight: 22, // Increased form 20
        marginBottom: spacing.md, // Increased from sm
    },
    itemsPreview: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: spacing.sm, // Increased from xs
        marginBottom: spacing.md, // Increased from sm
    },
    itemChip: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.surfaceElevated,
        paddingHorizontal: spacing.md, // Increased from sm
        paddingVertical: 6, // Increased from 4
        borderRadius: 18, // Increased from 16
        gap: 6,
    },
    itemTitle: {
        fontSize: 13, // Increased from 12
        color: colors.textSecondary,
        maxWidth: 140, // Increased from 120
    },
    moreItems: {
        fontSize: 13, // Increased from 12
        color: colors.primary,
        fontWeight: '500',
        alignSelf: 'center',
    },
    coverRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: spacing.md, // Increased from sm
        paddingLeft: 4,
    },
    coverThumb: {
        width: 80, // Increased to match checkin-ish size (was 52)
        height: 112, // Increased to match checkin-ish size (was 75)
        borderRadius: 8, // Increased from 6
        backgroundColor: colors.surfaceElevated,
        borderWidth: 1,
        borderColor: colors.border,
    },
    otherThumbPlaceholder: {
        justifyContent: 'center',
        alignItems: 'center',
    },
    newsAvatar: {
        backgroundColor: colors.surfaceElevated,
    },
    moreCoversChip: {
        width: 80, // Matched coverThumb
        height: 112, // Matched coverThumb
        borderRadius: 8, // Increased from 6
        backgroundColor: colors.surfaceElevated,
        borderWidth: 1,
        borderColor: colors.border,
        marginLeft: -12,
        justifyContent: 'center',
        alignItems: 'center',
    },
    moreCoversText: {
        fontSize: 13, // Increased from 11
        fontWeight: '600',
        color: colors.textMuted,
    },
    reviewedBodyRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        marginBottom: spacing.md,
    },
    reviewedThumbColumn: {
        alignItems: 'center',
        marginRight: spacing.md,
    },
    reviewedThumbRating: {
        marginTop: spacing.xs,
    },
    reviewedTextColumn: {
        flex: 1,
        minHeight: 112,
        justifyContent: 'flex-start',
        alignItems: 'center',
        paddingTop: 0,
    },
    reviewedNoteInline: {
        fontSize: 14,
        color: colors.textSecondary,
        lineHeight: 20,
        textAlign: 'center',
    },
    reviewedNoteInlineMuted: {
        fontSize: 13,
        color: colors.textMuted,
        textAlign: 'center',
    },
    reviewedMoreItemsText: {
        marginTop: spacing.sm,
        fontSize: 12,
        color: colors.textMuted,
        textAlign: 'center',
    },
    reviewedReadMoreHint: {
        marginTop: spacing.xs,
        fontSize: 11,
        color: colors.textMuted,
        textAlign: 'center',
    },
    reviewedReadMoreHintItalic: {
        fontStyle: 'italic',
    },
    reviewedUpdatedOn: {
        alignSelf: 'flex-end',
        marginTop: spacing.xs,
        marginBottom: spacing.xs,
        fontSize: 11,
        color: colors.textMuted,
    },
    socialRow: {
        marginBottom: spacing.sm,
        gap: spacing.sm, // Increased from xs
    },
    socialActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md, // Increased from sm
    },
    socialButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8, // Increased from 6
        paddingHorizontal: spacing.md, // Increased from sm
        paddingVertical: 8, // Increased from 6
        borderRadius: 20, // Increased from 16
        backgroundColor: colors.surfaceElevated,
    },
    socialButtonActive: {
        backgroundColor: colors.primary + '15',
    },
    socialButtonDisabled: {
        opacity: 0.6,
    },
    socialButtonText: {
        fontSize: 13, // Increased from 12
        color: colors.textMuted,
        fontWeight: '500',
    },
    socialButtonTextActive: {
        color: colors.primary,
    },
    commentPreview: {
        fontSize: 13, // Increased from 12
        color: colors.textSecondary,
    },
    cardFooter: {
        flexDirection: 'row',
        gap: spacing.lg, // Increased from md
        paddingTop: spacing.md, // Increased from sm
        borderTopWidth: 1,
        borderTopColor: colors.border,
    },
    // Inline comment styles
    commentPreviewContainer: {
        marginBottom: spacing.md, // Increased from sm
    },
    commentPreviewRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10, // Increased from 8
    },
    commentAvatar: {
        width: 24, // Increased from 20
        height: 24, // Increased from 20
        borderRadius: 12,
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
        fontSize: 11, // Increased from 10
        fontWeight: '600',
        color: colors.textMuted,
    },
    commentPreview: {
        flex: 1,
        fontSize: 14, // Increased from 13
        color: colors.textSecondary,
        lineHeight: 20, // Increased from 18
    },
    commentContent: {
        color: colors.textSecondary,
    },
    commentTimestamp: {
        fontSize: 12, // Increased from 11
        color: colors.textMuted,
        marginLeft: 6,
    },
    commentUsername: {
        fontWeight: '600',
        color: colors.text,
    },
    inlineCommentRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md, // Increased from sm
        marginTop: 6, // Increased from 4
    },
    inlineCommentInput: {
        flex: 1,
        fontSize: 14, // Increased from 13
        paddingVertical: 6, // Increased from 4
        paddingHorizontal: spacing.md, // Increased from sm
        backgroundColor: colors.surfaceElevated,
        borderRadius: 20, // Increased from 16
        color: colors.text,
        minHeight: 36, // Increased from 32
        maxHeight: 90, // Increased from 80
    },
    inlineCommentSend: {
        width: 32, // Increased from 28
        height: 32, // Increased from 28
        borderRadius: 16,
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
        gap: 6, // Increased from 4
    },
    footerText: {
        fontSize: 13, // Increased from 12
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
        padding: spacing.md, // Increased from sm
        margin: spacing.md,
        borderRadius: 8,
    },
    errorText: {
        color: colors.error,
        textAlign: 'center',
        fontSize: 14,
    },
    // Check-in event styles
    checkinAction: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6, // Increased from 4
        marginTop: 4, // Increased from 2
    },
    checkinBadge: {
        position: 'absolute',
        top: -10, // Adjusted
        right: 0,
        width: 200, // Increased from 180
        height: 66, // Increased from 60
        zIndex: 10,
        borderRadius: 14,
        backgroundColor: 'transparent',
    },
    checkinPreview: {
        flexDirection: 'row',
        gap: spacing.md,
        marginBottom: spacing.md, // Increased from sm
    },
    checkinCover: {
        width: 88, // Increased from 56
        height: 120, // Increased from 76
        borderRadius: 8, // Increased from 6
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
        fontSize: 18, // Increased from 15
        fontWeight: '600',
        color: colors.text,
        marginBottom: 4,
    },
    checkinCreator: {
        fontSize: 14, // Increased from 13
        color: colors.textMuted,
        marginTop: 2,
    },
    kindBadge: {
        alignSelf: 'flex-start',
        backgroundColor: colors.primary + '15',
        paddingHorizontal: spacing.md, // Increased from sm
        paddingVertical: 4, // Increased from 2
        borderRadius: 12, // Increased from 10
        marginTop: 8, // Increased from 6
    },
    kindText: {
        fontSize: 12, // Increased from 11
        fontWeight: '500',
        color: colors.primary,
        textTransform: 'capitalize',
    },
    checkinNote: {
        fontSize: 15, // Increased from 14
        color: colors.textSecondary,
        lineHeight: 22, // Increased from 20
        marginBottom: spacing.md, // Increased from sm
    },
    // Combined check-in + rating styles
    checkinRatedAction: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        marginTop: 2,
    },
    checkinRatingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 8,
    },
});
