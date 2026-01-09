import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, StatusBar } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AuthContext } from '../App';
import { apiRequest } from '../services/api';
import { colors, spacing, typography } from '../theme';
import Card from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import EmptyState from '../components/ui/EmptyState';
import Skeleton from '../components/ui/Skeleton';

const SORT_OPTIONS = [
  { value: 'alpha-asc', label: 'Name (A-Z)' },
  { value: 'created-desc', label: 'Newest' },
];

export default function ShelvesScreen({ navigation }) {
  const { token, apiBase } = useContext(AuthContext);
  const [shelves, setShelves] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [sortMode, setSortMode] = useState('alpha-asc');
  const [viewMode, setViewMode] = useState('grid'); // 'grid' | 'list'
  const [searchQuery, setSearchQuery] = useState('');

  const loadShelves = useCallback(async () => {
    try {
      if (!refreshing) setLoading(true);
      const data = await apiRequest({ apiBase, path: '/api/shelves', token });
      setShelves(Array.isArray(data.shelves) ? data.shelves : []);
      setError('');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [apiBase, token, refreshing]);

  useEffect(() => {
    loadShelves();
  }, []); // Run once on mount

  // Refresh when focusing screen to ensure data is up to date (e.g. after create)
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      loadShelves();
    });
    return unsubscribe;
  }, [navigation, loadShelves]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadShelves();
  }, [loadShelves]);

  const sortedShelves = useMemo(() => {
    let list = Array.isArray(shelves) ? [...shelves] : [];

    // Filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(s => s.name.toLowerCase().includes(q));
    }

    // Sort
    const compareName = (a, b) => String(a?.name || '').localeCompare(String(b?.name || ''));
    const compareDate = (a, b) => new Date(b?.createdAt || 0) - new Date(a?.createdAt || 0);

    if (sortMode === 'alpha-asc') list.sort(compareName);
    else if (sortMode === 'created-desc') list.sort(compareDate);

    return list;
  }, [shelves, sortMode, searchQuery]);

  const handleOpenShelf = (shelf) => {
    navigation.navigate('ShelfDetail', { id: shelf._id, title: shelf.name });
  };

  const getIconForType = (type) => {
    switch (type?.toLowerCase()) {
      case 'books': return 'book';
      case 'movies': return 'videocam';
      case 'games': return 'game-controller';
      case 'music': return 'musical-notes';
      default: return 'library'; // generic
    }
  };

  const renderShelfItem = ({ item }) => {
    const iconName = getIconForType(item.type);
    const countLabel = `${item.itemCount || 0} items`;

    if (viewMode === 'list') {
      return (
        <Card onPress={() => handleOpenShelf(item)} style={styles.listCard}>
          <View style={styles.listRow}>
            <View style={styles.listIcon}>
              <Ionicons name={iconName} size={24} color={colors.primary} />
            </View>
            <View style={styles.listContent}>
              <Text style={styles.itemTitle}>{item.name}</Text>
              <Text style={styles.itemSubtitle}>{countLabel} • {item.visibility}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
          </View>
        </Card>
      );
    }

    // Grid Item
    return (
      <Card onPress={() => handleOpenShelf(item)} style={styles.gridCard} contentStyle={styles.gridContent}>
        <View style={styles.gridHeader}>
          <Ionicons name={iconName} size={32} color={colors.primary} />
          <Badge count={item.itemCount || 0} color={colors.surfaceElevated} style={{ backgroundColor: colors.surfaceElevated }} />
          {/* Wait, Badge text color logic might need tweaking for dark bg? Badge default is primary bg white text. passed surfaceElevated. */}
        </View>
        <View style={styles.gridBody}>
          <Text style={styles.itemTitle} numberOfLines={1}>{item.name}</Text>
          <Text style={styles.itemSubtitle}>{item.type || 'Collection'}</Text>
        </View>
      </Card>
    );
  };

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />

      {/* Header Area */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Text style={styles.pageTitle}>My Shelves ({shelves.length})</Text>
          <TouchableOpacity onPress={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}>
            <Ionicons name={viewMode === 'grid' ? 'list' : 'grid'} size={24} color={colors.text} />
          </TouchableOpacity>
        </View>

        {/* Search & Sort */}
        <View style={styles.controls}>
          <View style={{ flex: 1, marginRight: spacing.sm }}>
            <Input
              placeholder="Search shelves..."
              value={searchQuery}
              onChangeText={setSearchQuery}
              style={{ marginBottom: 0 }}
              leftIcon={<Ionicons name="search" size={18} color={colors.textMuted} />}
            />
          </View>
          {/* Sort Toggle (Simple cycle for now) */}
          <TouchableOpacity
            style={styles.sortButton}
            onPress={() => setSortMode(sortMode === 'alpha-asc' ? 'created-desc' : 'alpha-asc')}
          >
            <Ionicons name="filter" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Content */}
      {loading && !refreshing && shelves.length === 0 ? (
        <View style={styles.loadingContainer}>
          <Skeleton width="100%" height={100} style={{ marginBottom: 16 }} />
          <Skeleton width="100%" height={100} style={{ marginBottom: 16 }} />
          <Skeleton width="100%" height={100} />
        </View>
      ) : sortedShelves.length === 0 ? (
        <EmptyState
          icon={<Ionicons name="library-outline" size={64} color={colors.textMuted} />}
          title="No Shelves Yet"
          description="Create your first shelf to start collecting."
          actionLabel="Create Shelf"
          onAction={() => navigation.navigate('ShelfCreate')}
        />
      ) : (
        <FlatList
          data={sortedShelves}
          keyExtractor={(item) => item._id}
          renderItem={renderShelfItem}
          numColumns={viewMode === 'grid' ? 2 : 1}
          key={viewMode} // Force re-render on mode change
          contentContainerStyle={styles.listContainer}
          columnWrapperStyle={viewMode === 'grid' ? styles.columnWrapper : undefined}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
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
  },
  header: {
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  pageTitle: {
    fontFamily: typography.fontFamily.bold,
    fontSize: typography.sizes['2xl'],
    color: colors.text,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sortButton: {
    width: 56,
    height: 56, // Match input height
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  listContainer: {
    padding: spacing.md,
    paddingBottom: 100, // Space for Fab/Tabs
  },
  columnWrapper: {
    justifyContent: 'space-between',
  },
  // List Styles
  listCard: {
    marginBottom: spacing.md,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  listIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceElevated,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  listContent: {
    flex: 1,
  },
  // Grid Styles
  gridCard: {
    flex: 0.48, // slightly less than 0.5 to allow gap
    marginBottom: spacing.md,
    height: 160,
  },
  gridContent: {
    flex: 1,
    justifyContent: 'space-between',
  },
  gridHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  gridBody: {
    justifyContent: 'flex-end',
  },
  itemTitle: {
    fontFamily: typography.fontFamily.bold,
    fontSize: typography.sizes.md,
    color: colors.text,
    marginBottom: 2,
  },
  itemSubtitle: {
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.sizes.xs,
    color: colors.textSecondary,
  },
  loadingContainer: {
    padding: spacing.md,
  },
});
