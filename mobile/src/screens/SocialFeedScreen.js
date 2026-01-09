import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AuthContext } from '../context/AuthContext';
import { apiRequest } from '../services/api';
import { colors, spacing, typography } from '../theme';
import Input from '../components/ui/Input';
import Card from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import EmptyState from '../components/ui/EmptyState';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'friends', label: 'Friends' },
  { key: 'public', label: 'Public' },
];

// --- Helpers (kept from original to ensure data compatibility) ---

function attachScope(entries, scope) {
  return (Array.isArray(entries) ? entries : []).map((entry) => ({ ...entry, __origin: scope }));
}

function normalizeDate(value) {
  const date = value ? new Date(value) : null;
  const time = date && !Number.isNaN(date.valueOf()) ? date.getTime() : 0;
  return time;
}

function normalizeCandidate(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const normalized = normalizeCandidate(item);
      if (normalized) return normalized;
    }
    return '';
  }
  if (typeof value === 'object') {
    const fields = ['fullName', 'displayName', 'name', 'title', 'label', 'value', 'text'];
    for (const field of fields) {
      if (value[field] != null) {
        const normalized = normalizeCandidate(value[field]);
        if (normalized) return normalized;
      }
    }
  }
  return '';
}

function formatFeedItemPreview(entry) {
  if (!entry) return { title: 'Untitled item', summary: '' };
  const collectable =
    entry.collectable ||
    entry.item ||
    entry.collectableSnapshot ||
    entry.collectableItem ||
    null;
  const manual =
    entry.manual ||
    entry.manualItem ||
    entry.manualSnapshot ||
    (entry.item && entry.item.manual) ||
    null;

  const titleCandidates = [
    collectable?.title,
    collectable?.name,
    collectable?.displayTitle,
    collectable?.displayName,
    collectable?.metadata?.title,
    manual?.title,
    manual?.name,
    entry?.title,
    entry?.name,
  ];

  let title = '';
  for (const candidate of titleCandidates) {
    title = normalizeCandidate(candidate);
    if (title) break;
  }
  if (!title) title = 'Untitled item';

  const details = [];
  const addDetail = (value) => {
    const text = normalizeCandidate(value);
    if (!text) return;
    const lower = text.toLowerCase();
    if (details.some((existing) => existing.toLowerCase() === lower)) return;
    details.push(text);
  };

  addDetail(collectable?.primaryCreator);
  addDetail(collectable?.author);
  addDetail(collectable?.creators);
  addDetail(manual?.primaryCreator);
  addDetail(manual?.author);
  addDetail(collectable?.format);
  addDetail(manual?.format);
  addDetail(manual?.type);
  addDetail(collectable?.publisher);
  addDetail(manual?.publisher);
  addDetail(collectable?.year);
  addDetail(manual?.year);

  const summary = details.slice(0, 3).join(' | ');

  return { title, summary };
}

// --- Component ---

export default function SocialFeedScreen({ navigation }) {
  const { token, apiBase } = useContext(AuthContext);
  const [publicEntries, setPublicEntries] = useState([]);
  const [friendEntries, setFriendEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [activeFilter, setActiveFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');

  const load = useCallback(
    async (opts = {}) => {
      if (!token) {
        setPublicEntries([]);
        setFriendEntries([]);
        setLoading(false);
        setRefreshing(false);
        return;
      }
      if (!opts.silent) setLoading(true);

      const requests = await Promise.allSettled([
        apiRequest({ apiBase, path: '/api/feed?scope=global', token }),
        apiRequest({ apiBase, path: '/api/feed?scope=friends', token }),
      ]);

      const [globalResult, friendsResult] = requests;
      const messages = [];

      if (globalResult.status === 'fulfilled') {
        setPublicEntries(globalResult.value.entries || []);
      } else {
        messages.push('Unable to load public activity.');
      }

      if (friendsResult.status === 'fulfilled') {
        setFriendEntries(friendsResult.value.entries || []);
      } else {
        messages.push('Unable to load friends activity.');
      }

      setError(messages.join(' '));
      setLoading(false);
      setRefreshing(false);
    },
    [apiBase, token]
  );

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = () => {
    setRefreshing(true);
    load({ silent: true });
  };

  const combinedEntries = useMemo(() => {
    const decorated = [
      ...attachScope(publicEntries, 'public'),
      ...attachScope(friendEntries, 'friends'),
    ];

    let filtered = decorated;

    if (activeFilter !== 'all') {
      filtered = filtered.filter((entry) => entry.__origin === activeFilter);
    }

    const term = searchTerm.trim().toLowerCase();
    if (term) {
      filtered = filtered.filter((entry) => {
        const shelfName = (entry.shelf?.name || '').toLowerCase();
        const ownerName = (entry.owner?.name || '').toLowerCase();
        const ownerUsername = (entry.owner?.username || '').toLowerCase();
        return shelfName.includes(term) || ownerName.includes(term) || ownerUsername.includes(term);
      });
    }

    return filtered
      .slice()
      .sort((a, b) => normalizeDate(b.shelf?.updatedAt) - normalizeDate(a.shelf?.updatedAt));
  }, [publicEntries, friendEntries, activeFilter, searchTerm]);

  const renderItem = ({ item }) => {
    const { shelf, owner, items, __origin } = item;
    const createdLabel = shelf?.updatedAt ? new Date(shelf.updatedAt).toLocaleDateString() : '';
    const originLabel = __origin === 'friends' ? 'Friends' : 'Public';
    const originVariant = __origin === 'friends' ? 'success' : 'primary';

    return (
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={() =>
          navigation.navigate('Shelves', {
            screen: 'ShelfDetail', // Navigate effectively to shelf detail, might need adjusting based on navigator nesting
            params: {
              id: shelf?.id,
              title: shelf?.name,
            }
          })
        }
      >
        <Card style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.userInfo}>
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarText}>{(owner?.name || owner?.username || '?')?.charAt(0).toUpperCase()}</Text>
              </View>
              <View>
                <Text style={styles.userName}>{owner?.name || owner?.username || 'Unknown User'}</Text>
                <Text style={styles.userLocation}>
                  {[owner?.city, owner?.state, owner?.country].filter(Boolean).join(', ') || 'No location'}
                </Text>
              </View>
            </View>
            <Badge variant={originVariant} label={originLabel} size="sm" />
          </View>

          <View style={styles.shelfInfo}>
            <Text style={styles.shelfTitle}>{shelf?.name || 'Untitled Shelf'}</Text>
            <Badge variant="secondary" label={shelf?.type || 'Collection'} size="sm" style={{ alignSelf: 'flex-start' }} />
          </View>

          {shelf?.description ? (
            <Text style={styles.description} numberOfLines={2}>{shelf.description}</Text>
          ) : null}

          <View style={styles.divider} />

          <View style={styles.itemsList}>
            {items?.length ? (
              <>
                {items.slice(0, 3).map((entry, idx) => {
                  const { title, summary } = formatFeedItemPreview(entry);
                  return (
                    <View key={idx} style={styles.itemRow}>
                      <Ionicons name="ellipse" size={6} color={colors.primary} style={{ marginTop: 6 }} />
                      <Text style={styles.itemText} numberOfLines={1}>
                        <Text style={styles.itemTitle}>{title}</Text>
                        {summary ? <Text style={styles.itemSummary}>{` — ${summary}`}</Text> : null}
                      </Text>
                    </View>
                  )
                })}
                {shelf?.itemCount > items.length && (
                  <Text style={styles.moreItems}>+ {shelf.itemCount - items.length} more items</Text>
                )}
              </>
            ) : (
              <Text style={styles.emptyItemsText}>No items added yet.</Text>
            )}
          </View>

          <View style={styles.cardFooter}>
            <Text style={styles.timestamp}>{createdLabel}</Text>
          </View>
        </Card>
      </TouchableOpacity>
    );
  };

  const renderEmpty = () => {
    if (loading) return null; // handled by initial load

    let message = "No activity yet.";
    if (searchTerm) message = "No results found.";
    else if (activeFilter === 'friends') message = "No activity from friends.";

    return (
      <EmptyState
        icon={<Ionicons name="newspaper-outline" size={48} color={colors.textMuted} />}
        title="Your feed is empty"
        description={message}
        actionLabel={activeFilter === 'friends' ? "Find Friends" : undefined}
        onAction={activeFilter === 'friends' ? () => navigation.navigate('FriendSearch') : undefined}
      />
    );
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Social Feed</Text>
        <Button
          variant="ghost"
          title="Find Friends"
          size="sm"
          icon="people"
          onPress={() => navigation.navigate('FriendSearch')}
        />
      </View>

      <View style={styles.searchContainer}>
        <Input
          placeholder="Search shelves or collectors..."
          value={searchTerm}
          onChangeText={setSearchTerm}
          icon="search"
        />
      </View>

      <View style={styles.filtersContainer}>
        {FILTERS.map((filter) => {
          const isActive = activeFilter === filter.key;
          return (
            <TouchableOpacity
              key={filter.key}
              onPress={() => setActiveFilter(filter.key)}
              style={[
                styles.filterChip,
                isActive && styles.filterChipActive
              ]}
            >
              <Text style={[styles.filterText, isActive && styles.filterTextActive]}>
                {filter.label}
              </Text>
            </TouchableOpacity>
          )
        })}
      </View>

      {error ? (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {loading && !refreshing ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={combinedEntries}
          keyExtractor={(item, idx) => (item?.shelf?.id ? `${item.shelf.id}-${item.__origin}` : `entry-${idx}`)}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListEmptyComponent={renderEmpty}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    paddingTop: 16, // Assuming safe area handled by wrapper or simple padding
  },
  header: {
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    fontSize: 28,
    fontFamily: typography.bold,
    color: colors.textPrimary,
  },
  searchContainer: {
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  filtersContainer: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  filterChip: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: colors.surfaceHighlight,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterText: {
    fontSize: 14,
    fontFamily: typography.medium,
    color: colors.textSecondary,
  },
  filterTextActive: {
    color: '#fff',
  },
  listContent: {
    padding: spacing.md,
    paddingTop: 0,
    paddingBottom: 40,
  },
  card: {
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.sm,
  },
  userInfo: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
  },
  avatarPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  userName: {
    fontSize: 16,
    fontFamily: typography.bold,
    color: colors.textPrimary,
  },
  userLocation: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  shelfInfo: {
    marginBottom: 8,
    gap: 4,
  },
  shelfTitle: {
    fontSize: 18,
    fontFamily: typography.bold,
    color: colors.textPrimary,
  },
  description: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.sm,
  },
  itemsList: {
    gap: 6,
    marginBottom: spacing.sm,
  },
  itemRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
  },
  itemText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  itemTitle: {
    color: colors.textPrimary,
    fontFamily: typography.medium,
  },
  itemSummary: {
    color: colors.textSecondary,
  },
  emptyItemsText: {
    fontStyle: 'italic',
    color: colors.textSecondary,
    fontSize: 13,
  },
  moreItems: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 2,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: spacing.xs,
  },
  timestamp: {
    fontSize: 12,
    color: colors.textTertiary,
  },
  errorContainer: {
    padding: spacing.md,
    backgroundColor: 'rgba(255, 69, 58, 0.1)',
    margin: spacing.md,
    borderRadius: 8,
  },
  errorText: {
    color: colors.danger,
    textAlign: 'center',
  },
  loadingContainer: {
    padding: spacing.xl,
    alignItems: 'center',
  },
});
