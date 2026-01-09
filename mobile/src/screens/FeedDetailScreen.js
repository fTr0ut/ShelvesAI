import React, { useContext, useMemo } from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AuthContext } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { apiRequest } from '../services/api';

export default function FeedDetailScreen({ route, navigation }) {
  const { entry } = route.params || {};
  const { token, apiBase } = useContext(AuthContext);
  const { colors, spacing, typography, shadows, radius, isDark } = useTheme();

  const styles = useMemo(() => createStyles({ colors, spacing, typography, shadows, radius }), [colors, spacing, typography, shadows, radius]);

  const { shelf, owner, items } = entry || {};
  const displayName = owner?.name || owner?.username || 'Someone';

  const getItemTitle = (item) => {
    const c = item?.collectable || item?.collectableSnapshot;
    const m = item?.manual || item?.manualSnapshot;
    return c?.title || m?.title || item?.title || 'Untitled';
  };

  const renderItem = ({ item, index }) => (
    <View style={styles.itemRow}>
      <Text style={styles.itemNumber}>{index + 1}</Text>
      <View style={styles.itemContent}>
        <Text style={styles.itemTitle} numberOfLines={1}>{getItemTitle(item)}</Text>
      </View>
    </View>
  );

  return (
    <View style={styles.screen}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Activity</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* User Info */}
      <View style={styles.userSection}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{displayName.charAt(0).toUpperCase()}</Text>
        </View>
        <View>
          <Text style={styles.userName}>{displayName}</Text>
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
            onPress={() => navigation.navigate('ShelfDetail', { id: shelf?.id, title: shelf?.name })}
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
      <Text style={styles.sectionTitle}>Items in this shelf</Text>
      <FlatList
        data={items || []}
        keyExtractor={(item, idx) => item._id || `item-${idx}`}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <Text style={styles.emptyText}>No items to display</Text>
        }
      />
    </View>
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
  emptyText: {
    fontSize: 14,
    color: colors.textMuted,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingTop: spacing.lg,
  },
});
