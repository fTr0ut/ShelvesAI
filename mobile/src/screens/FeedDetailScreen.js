import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
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
  const { entry } = route.params || {};
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

  const targetId = entry?.aggregateId || entry?.id || entry?.shelf?.id;

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
          setDetailEntry(response.entry);
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
    setCommentCount(detailEntry?.commentCount || entry?.commentCount || 0);
    setLikeCount(detailEntry?.likeCount || entry?.likeCount || 0);
    setHasLiked(detailEntry?.hasLiked || entry?.hasLiked || false);
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

  const { shelf, owner, items } = detailEntry || entry || {};
  const displayName = owner?.name || owner?.username || 'Someone';
  const isOwner = !!(user?.id && owner?.id && user.id === owner.id);

  let avatarSource = null;
  if (owner?.profileMediaPath) {
    avatarSource = { uri: `${apiBase}/media/${owner.profileMediaPath}` };
  } else if (owner?.picture) {
    avatarSource = { uri: owner.picture };
  }

  const getItemInfo = (item) => {
    const c = item?.collectable || item?.collectableSnapshot;
    const m = item?.manual || item?.manualSnapshot;
    const payload = item?.payload || null;
    const title = c?.title || m?.title || item?.title || payload?.title || payload?.name || 'Unknown item';

    // Extract cover URL with priority: local media path > external URL
    let coverUrl = null;
    if (c?.coverMediaPath && apiBase) {
      coverUrl = `${apiBase}/media/${c.coverMediaPath}`;
    } else if (c?.coverUrl) {
      coverUrl = c.coverUrl;
    }

    return { title, coverUrl };
  };

  const renderItem = ({ item, index }) => {
    const info = getItemInfo(item);
    return (
      <View style={styles.itemRow}>
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
      </View>
    );
  };

  const renderComment = (comment, idx) => {
    const author = comment?.user?.username || comment?.username || 'User';
    return (
      <View key={comment?.id || `comment-${idx}`} style={styles.commentRow}>
        <Text style={styles.commentAuthor}>{author}</Text>
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
      >
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
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

          {/* Shelf Info */}
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

          {/* Items */}
          <Text style={styles.sectionTitle}>Newly added collectibles</Text>
          <View style={styles.itemsListContainer}>
            <ScrollView nestedScrollEnabled={true}>
              {(items || []).length > 0 ? (
                items.map((item, idx) => (
                  <View key={item._id || `item-${idx}`}>
                    {renderItem({ item, index: idx })}
                  </View>
                ))
              ) : (
                <Text style={styles.emptyText}>No items to display</Text>
              )}
            </ScrollView>
          </View>

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
    paddingBottom: spacing.xl,
  },
  commentRow: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.xs,
  },
  commentAuthor: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 2,
  },
  commentContent: {
    fontSize: 13,
    color: colors.textSecondary,
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
});
