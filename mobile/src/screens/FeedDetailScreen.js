import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AuthContext } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { apiRequest } from '../services/api';
import { addComment, getComments, toggleLike } from '../services/feedApi';

export default function FeedDetailScreen({ route, navigation }) {
  const { entry, id, feedId } = route.params || {};
  const { token, apiBase, user } = useContext(AuthContext);
  const { colors, spacing, typography, shadows, radius, isDark } = useTheme();

  const styles = useMemo(() => createStyles({ colors, spacing, typography, shadows, radius }), [colors, spacing, typography, shadows, radius]);

  const [detailEntry, setDetailEntry] = useState(entry || null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [comments, setComments] = useState([]);
  const [commentText, setCommentText] = useState('');
  const [commentLoading, setCommentLoading] = useState(false);
  const [commentCount, setCommentCount] = useState(entry?.commentCount || 0);
  const [likeCount, setLikeCount] = useState(entry?.likeCount || 0);
  const [hasLiked, setHasLiked] = useState(entry?.hasLiked || false);
  const [likePending, setLikePending] = useState(false);

  const scrollViewRef = useRef(null);

  const handleCommentFocus = useCallback(() => {
    // Delay to allow keyboard to start appearing
    setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }, 100);
  }, []);

  const targetId = feedId || id || entry?.aggregateId || entry?.id || entry?.shelf?.id;

  useEffect(() => {
    let isMounted = true;
    const loadDetails = async () => {
      if (!token || !targetId) {
        setLoading(false);
        return;
      }
      try {
        const response = await apiRequest({ apiBase, path: `/api/feed/${targetId}`, token });
        if (isMounted && response?.entry) {
          setDetailEntry((prev) => ({ ...(prev || {}), ...response.entry }));
          setError('');
        }
      } catch (err) {
        if (isMounted) setError('Unable to load activity');
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    loadDetails();
    return () => { isMounted = false; };
  }, [apiBase, token, targetId]);

  useEffect(() => {
    setCommentCount(detailEntry?.commentCount ?? entry?.commentCount ?? 0);
    setLikeCount(detailEntry?.likeCount ?? entry?.likeCount ?? 0);
    setHasLiked(detailEntry?.hasLiked ?? entry?.hasLiked ?? false);
  }, [detailEntry, entry]);

  const loadComments = useCallback(async () => {
    if (!token || !targetId) return;
    try {
      const response = await getComments({ apiBase, token, eventId: targetId });
      const list = response?.comments || response?.items || [];
      setComments(Array.isArray(list) ? list : []);
      if (typeof response?.commentCount === 'number') {
        setCommentCount(response.commentCount);
      }
    } catch (err) {
      setComments([]);
    }
  }, [apiBase, token, targetId]);

  useEffect(() => {
    loadComments();
  }, [loadComments]);

  const handleToggleLike = useCallback(async () => {
    if (!token || !targetId || likePending) return;
    const nextLiked = !hasLiked;
    const nextCount = Math.max(0, likeCount + (nextLiked ? 1 : -1));
    setHasLiked(nextLiked);
    setLikeCount(nextCount);
    setLikePending(true);
    try {
      const response = await toggleLike({ apiBase, token, eventId: targetId });
      if (typeof response?.likeCount === 'number') setLikeCount(response.likeCount);
      if (typeof response?.liked === 'boolean') setHasLiked(response.liked);
    } catch (err) {
      setHasLiked(hasLiked);
      setLikeCount(likeCount);
    } finally {
      setLikePending(false);
    }
  }, [apiBase, token, targetId, hasLiked, likeCount, likePending]);

  const handleAddComment = useCallback(async () => {
    const trimmed = commentText.trim();
    if (!trimmed || !token || !targetId || commentLoading) return;
    setCommentLoading(true);
    try {
      const response = await addComment({ apiBase, token, eventId: targetId, content: trimmed });
      setCommentText('');
      if (response?.comment) {
        setComments((prev) => [response.comment, ...prev]);
      } else {
        await loadComments();
      }
      if (typeof response?.commentCount === 'number') {
        setCommentCount(response.commentCount);
      } else {
        setCommentCount((prev) => prev + 1);
      }
    } catch (err) {
      // ignore for now
    } finally {
      setCommentLoading(false);
    }
  }, [apiBase, token, targetId, commentText, commentLoading, loadComments]);

  const resolvedEntry = detailEntry || entry || {};
  const { shelf, owner, items, eventType, collectable, checkinStatus, note, displayHints, rating } = resolvedEntry;
  const isCheckIn = eventType === 'checkin.activity';
  const isCheckinRated = eventType === 'checkin.rated';

  // Use displayHints with fallback defaults
  const hints = displayHints || {
    showShelfCard: eventType !== 'item.rated',
    sectionTitle: eventType === 'item.rated' ? 'New ratings' : 'Newly added collectibles',
    itemDisplayMode: eventType === 'item.rated' ? 'rated' : 'numbered',
  };
  const displayName = owner?.name || owner?.username || 'Someone';
  const isOwner = !!(user?.id && owner?.id && user.id === owner.id);

  let avatarSource = null;
  if (owner?.profileMediaUrl) {
    avatarSource = { uri: owner.profileMediaUrl };
  } else if (owner?.profileMediaPath) {
    avatarSource = { uri: `${apiBase}/media/${owner.profileMediaPath}` };
  } else if (owner?.picture) {
    avatarSource = { uri: owner.picture };
  }

  const statusLabels = {
    starting: 'Started',
    continuing: 'Continuing',
    completed: 'Finished',
  };
  const statusIcons = {
    starting: 'play-circle-outline',
    continuing: 'refresh-outline',
    completed: 'checkmark-circle-outline',
  };
  const statusFallback = checkinStatus
    ? `${checkinStatus.charAt(0).toUpperCase()}${checkinStatus.slice(1)}`
    : 'Update';
  const statusLabel = statusLabels[checkinStatus] || statusFallback;
  const statusIcon = statusIcons[checkinStatus] || 'checkbox-outline';

  const buildMediaUri = (value) => {
    if (!value) return null;
    if (/^https?:/i.test(value)) return value;
    const trimmed = String(value).replace(/^\/+/, '');
    const resource = trimmed.startsWith('media/') ? trimmed : `media/${trimmed}`;
    if (!apiBase) return `/${resource}`;
    return `${apiBase.replace(/\/+$/, '')}/${resource}`;
  };

  const resolveCollectableCoverUrl = (target) => {
    if (!target) return null;
    // Prefer pre-resolved URL from API (handles S3/CloudFront)
    if (target.coverMediaUrl) {
      return target.coverMediaUrl;
    }
    if (target.coverImageUrl) {
      if (target.coverImageSource === 'external' || /^https?:/i.test(target.coverImageUrl)) {
        return target.coverImageUrl;
      }
      return buildMediaUri(target.coverImageUrl);
    }
    if (target.coverMediaPath) {
      return buildMediaUri(target.coverMediaPath);
    }
    if (target.coverUrl) {
      return /^https?:/i.test(target.coverUrl)
        ? target.coverUrl
        : buildMediaUri(target.coverUrl);
    }
    const images = Array.isArray(target.images) ? target.images : [];
    for (const image of images) {
      const url = image?.urlLarge || image?.urlMedium || image?.urlSmall || image?.url;
      if (url) return url;
    }
    return null;
  };

  const collectableCoverUrl = resolveCollectableCoverUrl(collectable);

  const formatRelativeTime = (dateString) => {
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
  };

  const resolveManualCoverUrl = (manual) => {
    if (!manual) return null;
    if (manual.coverMediaUrl) return manual.coverMediaUrl;
    if (manual.coverMediaPath) return buildMediaUri(manual.coverMediaPath);
    return null;
  };

  const getItemInfo = (item) => {
    const c = item?.collectable || item?.collectableSnapshot;
    const m = item?.manual || item?.manualSnapshot;
    const payload = item?.payload || null;
    const title = c?.title || m?.title || m?.name || item?.title || payload?.title || payload?.name || 'Unknown item';

    // Extract cover URL with priority: collectable cover, then manual cover
    const coverUrl = resolveCollectableCoverUrl(c) || resolveManualCoverUrl(m);

    // Extract rating for rating events
    const rating = item?.rating || payload?.rating || null;

    return { title, coverUrl, rating };
  };

  const renderStars = (rating) => {
    if (!rating) return null;
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
    return <View style={{ flexDirection: 'row', marginLeft: spacing.sm }}>{stars}</View>;
  };

  const renderRatingItem = ({ item, index }) => {
    const info = getItemInfo(item);
    const payloadCollectableId = item?.payload?.collectableId ?? item?.payload?.collectable_id ?? null;
    const directCollectableId = item?.collectableId ?? null;
    const itemCollectableId = item?.collectable?.id ?? item?.collectableSnapshot?.id ?? null;
    const hasDetailTarget = !!(
      payloadCollectableId ||
      directCollectableId ||
      itemCollectableId ||
      item?.collectable ||
      item?.collectableSnapshot ||
      item?.manual ||
      item?.manualSnapshot
    );
    const targetCollectableId = payloadCollectableId ?? directCollectableId ?? itemCollectableId;
    const resolvedCollectableId = targetCollectableId != null ? String(targetCollectableId) : null;

    return (
      <TouchableOpacity
        style={styles.ratingItemRow}
        activeOpacity={hasDetailTarget ? 0.7 : 1}
        disabled={!hasDetailTarget}
        onPress={() => {
          if (hasDetailTarget) {
            if (resolvedCollectableId) {
              navigation.navigate('CollectableDetail', { collectableId: resolvedCollectableId, ownerId: owner?.id });
            } else {
              navigation.navigate('CollectableDetail', { item, ownerId: owner?.id });
            }
          }
        }}
      >
        {info.coverUrl ? (
          <Image
            source={{ uri: info.coverUrl }}
            style={styles.ratingItemCover}
            resizeMode="cover"
          />
        ) : (
          <View style={styles.ratingItemCoverPlaceholder}>
            <Ionicons name="book" size={14} color={colors.textMuted} />
          </View>
        )}
        <View style={styles.ratingItemContent}>
          <Text style={styles.ratingItemTitle} numberOfLines={1}>{info.title}</Text>
        </View>
        {renderStars(info.rating)}
      </TouchableOpacity>
    );
  };

  const renderItem = ({ item, index }) => {
    const info = getItemInfo(item);
    const payloadCollectableId = item?.payload?.collectableId ?? item?.payload?.collectable_id ?? null;
    const directCollectableId = item?.collectableId ?? null;
    const itemCollectableId = item?.collectable?.id ?? item?.collectableSnapshot?.id ?? null;
    const hasDetailTarget = !!(
      payloadCollectableId ||
      directCollectableId ||
      itemCollectableId ||
      item?.collectable ||
      item?.collectableSnapshot ||
      item?.manual ||
      item?.manualSnapshot
    );
    const targetCollectableId = payloadCollectableId ?? directCollectableId ?? itemCollectableId;
    const resolvedCollectableId = targetCollectableId != null ? String(targetCollectableId) : null;
    return (
      <TouchableOpacity
        style={styles.itemRow}
        activeOpacity={hasDetailTarget ? 0.7 : 1}
        disabled={!hasDetailTarget}
        onPress={() => {
          if (hasDetailTarget) {
            if (resolvedCollectableId) {
              navigation.navigate('CollectableDetail', { collectableId: resolvedCollectableId, ownerId: owner?.id });
            } else {
              navigation.navigate('CollectableDetail', { item, ownerId: owner?.id });
            }
          }
        }}
      >
        <Text style={styles.itemNumber}>{index + 1}</Text>
        {info.coverUrl ? (
          <Image
            source={{ uri: info.coverUrl }}
            style={styles.itemCover}
            resizeMode="cover"
          />
        ) : (
          <View style={styles.itemCoverPlaceholder}>
            <Ionicons name="book" size={14} color={colors.textMuted} />
          </View>
        )}
        <View style={styles.itemContent}>
          <Text style={styles.itemTitle} numberOfLines={1}>{info.title}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  const renderComment = (comment, idx) => {
    const author = comment?.user?.username || comment?.username || 'User';
    const picture = comment?.user?.picture || comment?.picture;
    const profilePath = comment?.user?.profileMediaPath || comment?.profileMediaPath;

    let commentAvatarSource = null;
    if (profilePath && apiBase) {
      commentAvatarSource = { uri: `${apiBase}/media/${profilePath}` };
    } else if (picture) {
      commentAvatarSource = { uri: picture };
    }
    const initial = author.charAt(0).toUpperCase();
    const timeAgo = formatRelativeTime(comment?.createdAt);

    const handleProfilePress = () => {
      const username = comment?.user?.username || comment?.username;
      if (username) {
        navigation.navigate('Profile', { username });
      }
    };

    return (
      <View key={comment?.id || `comment-${idx}`} style={styles.commentRow}>
        <View style={styles.commentHeader}>
          <TouchableOpacity onPress={handleProfilePress}>
            <View style={styles.commentAvatar}>
              {commentAvatarSource ? (
                <Image source={commentAvatarSource} style={styles.commentAvatarImage} />
              ) : (
                <Text style={styles.commentAvatarText}>{initial}</Text>
              )}
            </View>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleProfilePress}>
            <Text style={styles.commentAuthor}>{author}</Text>
          </TouchableOpacity>
          <Text style={styles.commentTime}>{timeAgo}</Text>
        </View>
        <Text style={styles.commentContent}>{comment?.content || ''}</Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Activity</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 0}
      >
        <ScrollView
          ref={scrollViewRef}
          contentContainerStyle={{ paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
        >
          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : null}

          {error ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {/* User Info */}
          <View style={styles.userSection}>
            <View style={styles.avatar}>
              {avatarSource ? (
                <Image source={avatarSource} style={styles.avatarImage} />
              ) : (
                <Text style={styles.avatarText}>{displayName.charAt(0).toUpperCase()}</Text>
              )}
            </View>
            <View>
              <TouchableOpacity
                onPress={() => {
                  if (owner?.username) {
                    navigation.navigate('Profile', { username: owner.username });
                  }
                }}
                disabled={!owner?.username}
              >
                <Text style={styles.userName}>{displayName}</Text>
              </TouchableOpacity>
              <Text style={styles.userMeta}>
                {[owner?.city, owner?.country].filter(Boolean).join(', ') || 'Collector'}
              </Text>
            </View>
          </View>

          {(isCheckIn || isCheckinRated) ? (
            <View style={styles.checkinCard}>
              <View style={styles.checkinHeader}>
                <Text style={styles.checkinLabel}>{isCheckinRated ? 'Check-in + Rating' : 'Check-in'}</Text>
                {checkinStatus ? (
                  <View style={styles.checkinStatusBadge}>
                    <Ionicons name={statusIcon} size={14} color={colors.primary} />
                    <Text style={styles.checkinStatusText}>{statusLabel}</Text>
                  </View>
                ) : null}
              </View>
              <TouchableOpacity
                style={styles.checkinBody}
                onPress={() => {
                  if (collectable?.id) {
                    navigation.navigate('CollectableDetail', { item: { collectable }, ownerId: owner?.id });
                  }
                }}
                activeOpacity={collectable?.id ? 0.7 : 1}
                disabled={!collectable?.id}
              >
                {collectableCoverUrl ? (
                  <Image
                    source={{ uri: collectableCoverUrl }}
                    style={styles.checkinCover}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={styles.checkinCoverFallback}>
                    <Ionicons name="book" size={18} color={colors.textMuted} />
                  </View>
                )}
                <View style={styles.checkinInfo}>
                  <Text style={styles.checkinTitle} numberOfLines={2}>
                    {collectable?.title || 'Untitled item'}
                  </Text>
                  {collectable?.primaryCreator ? (
                    <Text style={styles.checkinCreator} numberOfLines={1}>
                      {collectable.primaryCreator}
                    </Text>
                  ) : null}
                  {/* Rating stars for combined check-in + rating */}
                  {isCheckinRated && rating ? (
                    <View style={styles.checkinRatingRow}>
                      {renderStars(rating)}
                    </View>
                  ) : null}
                  {collectable?.kind ? (
                    <View style={styles.checkinKindBadge}>
                      <Text style={styles.checkinKindText}>{collectable.kind}</Text>
                    </View>
                  ) : null}
                </View>
              </TouchableOpacity>
              {note ? (
                <Text style={styles.checkinNote} numberOfLines={4}>
                  {note}
                </Text>
              ) : null}
            </View>
          ) : (
            <>
              {/* Shelf Info - controlled by displayHints */}
              {hints.showShelfCard && shelf && (
                <View style={styles.shelfCard}>
                  <View style={styles.shelfHeader}>
                    <Text style={styles.shelfLabel}>Shelf</Text>
                    <TouchableOpacity
                      onPress={() => navigation.navigate('ShelfDetail', { id: shelf?.id, title: shelf?.name, readOnly: !isOwner })}
                    >
                      <Text style={styles.viewLink}>View →</Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.shelfName}>{shelf?.name || 'Untitled Shelf'}</Text>
                  {shelf?.description ? (
                    <Text style={styles.shelfDescription}>{shelf.description}</Text>
                  ) : null}
                  <View style={styles.shelfMeta}>
                    <View style={styles.metaItem}>
                      <Ionicons name="library-outline" size={14} color={colors.textMuted} />
                      <Text style={styles.metaText}>{shelf?.itemCount || items?.length || 0} items</Text>
                    </View>
                    <View style={styles.metaItem}>
                      <Ionicons name="pricetag-outline" size={14} color={colors.textMuted} />
                      <Text style={styles.metaText}>{shelf?.type || 'Collection'}</Text>
                    </View>
                  </View>
                </View>
              )}

              {/* Dynamic Section Title from displayHints */}
              {hints.sectionTitle && (
                <Text style={styles.sectionTitle}>{hints.sectionTitle}</Text>
              )}

              {/* Items - render based on displayHints.itemDisplayMode */}
              <View style={styles.itemsListContainer}>
                <ScrollView nestedScrollEnabled={true}>
                  {(items || []).length > 0 ? (
                    items.map((item, idx) => (
                      <View key={item._id || `item-${idx}`}>
                        {hints.itemDisplayMode === 'rated'
                          ? renderRatingItem({ item, index: idx })
                          : renderItem({ item, index: idx })
                        }
                      </View>
                    ))
                  ) : (
                    <Text style={styles.emptyText}>No items to display</Text>
                  )}
                </ScrollView>
              </View>
            </>
          )}

          {/* Actions & Comments - Now outside the list */}
          <View style={styles.commentsSection}>
            <View style={styles.socialActions}>
              <TouchableOpacity
                style={[styles.likeButton, hasLiked && styles.likeButtonActive]}
                onPress={handleToggleLike}
                disabled={likePending}
              >
                <Ionicons name={hasLiked ? 'heart' : 'heart-outline'} size={16} color={hasLiked ? colors.primary : colors.textMuted} />
                <Text style={styles.likeText}>{likeCount} Likes</Text>
              </TouchableOpacity>
              <View style={styles.commentCount}>
                <Ionicons name="chatbubble-outline" size={16} color={colors.textMuted} />
                <Text style={styles.commentCountText}>{commentCount} Comments</Text>
              </View>
            </View>

            <Text style={styles.sectionTitle}>Comments</Text>
            {comments.length ? comments.map(renderComment) : (
              <Text style={styles.emptyText}>No comments yet</Text>
            )}

            <View style={styles.commentInputRow}>
              <TextInput
                style={styles.commentInput}
                value={commentText}
                onChangeText={setCommentText}
                placeholder="Add a comment"
                placeholderTextColor={colors.textMuted}
                multiline
                onFocus={handleCommentFocus}
              />
              <TouchableOpacity
                style={[styles.commentSend, commentLoading && styles.commentSendDisabled]}
                onPress={handleAddComment}
                disabled={commentLoading}
              >
                <Ionicons name="send" size={16} color={colors.textInverted} />
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
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
    justifyContent: 'space-between',
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
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
  },
  userSection: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
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
    fontSize: 20,
    fontWeight: '600',
    color: colors.textInverted,
  },
  userName: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.text,
  },
  userMeta: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  shelfCard: {
    backgroundColor: colors.surface,
    marginHorizontal: spacing.md,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.lg,
    ...shadows.sm,
  },
  shelfHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  shelfLabel: {
    fontSize: 12,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  viewLink: {
    fontSize: 13,
    color: colors.primary,
    fontWeight: '500',
  },
  shelfName: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  shelfDescription: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: spacing.sm,
  },
  shelfMeta: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    fontSize: 13,
    color: colors.textMuted,
  },
  checkinCard: {
    backgroundColor: colors.surface,
    marginHorizontal: spacing.md,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.lg,
    ...shadows.sm,
  },
  checkinHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  checkinLabel: {
    fontSize: 12,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  checkinStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary + '15',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 12,
  },
  checkinStatusText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.primary,
  },
  checkinBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  checkinCover: {
    width: 64,
    height: 96,
    borderRadius: 6,
    backgroundColor: colors.surfaceElevated,
  },
  checkinCoverFallback: {
    width: 64,
    height: 96,
    borderRadius: 6,
    backgroundColor: colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkinInfo: {
    flex: 1,
  },
  checkinTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  checkinCreator: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  checkinKindBadge: {
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
    backgroundColor: colors.surfaceElevated,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 10,
  },
  checkinKindText: {
    fontSize: 11,
    color: colors.textMuted,
    textTransform: 'capitalize',
  },
  checkinNote: {
    marginTop: spacing.sm,
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
    fontStyle: 'italic',
  },
  checkinRatingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  listContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: 40,
  },
  socialActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  likeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: 16,
    backgroundColor: colors.surface,
  },
  likeButtonActive: {
    backgroundColor: colors.surfaceElevated || colors.surface,
  },
  likeText: {
    fontSize: 13,
    color: colors.textMuted,
  },
  commentCount: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  commentCountText: {
    fontSize: 13,
    color: colors.textMuted,
  },
  commentsSection: {
    paddingTop: spacing.md,
    paddingBottom: spacing.xl * 2,
    paddingHorizontal: spacing.md,
  },
  commentRow: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.xs,
  },
  commentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  commentAvatar: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.surfaceElevated,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    marginRight: 8,
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
  commentAuthor: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  commentTime: {
    fontSize: 11,
    color: colors.textMuted,
    marginLeft: 8,
  },
  commentContent: {
    fontSize: 13,
    color: colors.textSecondary,
    marginLeft: 28, // Indent content under name (20 avatar + 8 margin)
  },
  commentInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  commentInput: {
    flex: 1,
    minHeight: 40,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: 14,
  },
  commentSend: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  commentSendDisabled: {
    opacity: 0.6,
  },
  loadingContainer: {
    paddingVertical: spacing.xl,
    alignItems: 'center',
  },
  errorBanner: {
    backgroundColor: colors.error + '15',
    padding: spacing.sm,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    borderRadius: radius.md,
  },
  errorText: {
    color: colors.error,
    textAlign: 'center',
    fontSize: 14,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.sm + 2,
    marginBottom: spacing.xs,
  },
  itemNumber: {
    width: 24,
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
  },
  itemContent: {
    flex: 1,
  },
  itemTitle: {
    fontSize: 14,
    color: colors.text,
  },
  itemCover: {
    width: 28,
    height: 42,
    borderRadius: 3,
    backgroundColor: colors.surfaceElevated,
    marginRight: spacing.sm,
  },
  itemCoverPlaceholder: {
    width: 28,
    height: 42,
    borderRadius: 3,
    backgroundColor: colors.surfaceElevated,
    marginRight: spacing.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  itemsListContainer: {
    maxHeight: 300,
  },
  emptyText: {
    fontSize: 14,
    color: colors.textMuted,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingTop: spacing.lg,
  },
  ratingItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.sm + 2,
    marginBottom: spacing.xs,
  },
  ratingItemCover: {
    width: 32,
    height: 48,
    borderRadius: 4,
    backgroundColor: colors.surfaceElevated,
    marginRight: spacing.sm,
  },
  ratingItemCoverPlaceholder: {
    width: 32,
    height: 48,
    borderRadius: 4,
    backgroundColor: colors.surfaceElevated,
    marginRight: spacing.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  ratingItemContent: {
    flex: 1,
  },
  ratingItemTitle: {
    fontSize: 14,
    color: colors.text,
  },
});
