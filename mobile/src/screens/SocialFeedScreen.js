import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { AuthContext } from '../App'
import { apiRequest } from '../services/api'
import FooterNav from '../components/FooterNav'

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'friends', label: 'Friends' },
  { key: 'public', label: 'Public' },
]

function attachScope(entries, scope) {
  return (Array.isArray(entries) ? entries : []).map((entry) => ({ ...entry, __origin: scope }))
}

function normalizeDate(value) {
  const date = value ? new Date(value) : null
  const time = date && !Number.isNaN(date.valueOf()) ? date.getTime() : 0
  return time
}

export default function SocialFeedScreen({ navigation }) {
  const { token, apiBase } = useContext(AuthContext)
  const [publicEntries, setPublicEntries] = useState([])
  const [friendEntries, setFriendEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [activeFilter, setActiveFilter] = useState('all')
  const [searchTerm, setSearchTerm] = useState('')

  const load = useCallback(
    async (opts = {}) => {
      if (!token) {
        setPublicEntries([])
        setFriendEntries([])
        setLoading(false)
        setRefreshing(false)
        return
      }
      if (!opts.silent) setLoading(true)

      const requests = await Promise.allSettled([
        apiRequest({ apiBase, path: '/api/feed?scope=global', token }),
        apiRequest({ apiBase, path: '/api/feed?scope=friends', token }),
      ])

      const [globalResult, friendsResult] = requests
      const messages = []

      if (globalResult.status === 'fulfilled') {
        setPublicEntries(globalResult.value.entries || [])
      } else {
        messages.push('Unable to load public activity.')
      }

      if (friendsResult.status === 'fulfilled') {
        setFriendEntries(friendsResult.value.entries || [])
      } else {
        messages.push('Unable to load friends activity.')
      }

      setError(messages.join(' '))
      setLoading(false)
      setRefreshing(false)
    },
    [apiBase, token],
  )

  useEffect(() => {
    load()
  }, [load])

  const onRefresh = () => {
    setRefreshing(true)
    load({ silent: true })
  }
  const openFriendSearch = useCallback(() => {
    navigation.navigate('FriendSearch')
  }, [navigation])

  const combinedEntries = useMemo(() => {
    const decorated = [
      ...attachScope(publicEntries, 'public'),
      ...attachScope(friendEntries, 'friends'),
    ]

    let filtered = decorated

    if (activeFilter !== 'all') {
      filtered = filtered.filter((entry) => entry.__origin === activeFilter)
    }

    const term = searchTerm.trim().toLowerCase()
    if (term) {
      filtered = filtered.filter((entry) => {
        const shelfName = (entry.shelf?.name || '').toLowerCase()
        const ownerName = (entry.owner?.name || '').toLowerCase()
        const ownerUsername = (entry.owner?.username || '').toLowerCase()
        return shelfName.includes(term) || ownerName.includes(term) || ownerUsername.includes(term)
      })
    }

    return filtered
      .slice()
      .sort((a, b) => normalizeDate(b.shelf?.updatedAt) - normalizeDate(a.shelf?.updatedAt))
  }, [publicEntries, friendEntries, activeFilter, searchTerm])

  const renderItem = ({ item }) => {
    const { shelf, owner, items, __origin } = item
    const createdLabel = shelf?.updatedAt ? new Date(shelf.updatedAt).toLocaleString() : ''
    const originLabel = __origin === 'friends' ? 'Friends' : 'Public'

    return (
      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <View>
            <Text style={styles.ownerName}>{owner?.name || owner?.username || 'Someone'}</Text>
            <Text style={styles.ownerLocation}>
              {[owner?.city, owner?.state, owner?.country].filter(Boolean).join(', ') || ''}
            </Text>
          </View>
          <View style={styles.badgeStack}>
            <Text
              style={[
                styles.scopeBadge,
                __origin === 'friends' ? styles.scopeBadgeFriends : styles.scopeBadgePublic,
              ]}
            >
              {originLabel}
            </Text>
            <Text style={styles.tag}>{shelf?.type || 'Collection'}</Text>
          </View>
        </View>
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => navigation.navigate('ShelfDetail', { id: shelf?.id, title: shelf?.name })}
        >
          <Text style={styles.shelfTitle}>{shelf?.name || 'Untitled Shelf'}</Text>
          {shelf?.description ? <Text style={styles.shelfDescription}>{shelf.description}</Text> : null}
        </TouchableOpacity>
        {items?.length ? (
          <View style={styles.itemsPreview}>
            {items.map((entry) => {
              const label = entry.collectable?.name || entry.manual?.name || 'Unknown item'
              return (
                <Text key={entry.id} style={styles.itemLine} numberOfLines={1}>
                  - {label}
                </Text>
              )
            })}
            {shelf?.itemCount > items.length ? (
              <Text style={styles.moreItems}>+ {shelf.itemCount - items.length} more items</Text>
            ) : null}
          </View>
        ) : (
          <Text style={styles.muted}>No items yet</Text>
        )}
        {createdLabel ? <Text style={styles.timestamp}>{createdLabel}</Text> : null}
      </View>
    )
  }

  const renderEmpty = () => {
    if (loading) {
      return (
        <View style={styles.emptyState}>
          <ActivityIndicator color="#7ca6ff" size="small" />
          <Text style={styles.muted}>Loading activity...</Text>
        </View>
      )
    }

    if (searchTerm.trim()) {
      return <Text style={styles.muted}>No results match your search.</Text>
    }

    if (activeFilter === 'friends') {
      return <Text style={styles.muted}>No recent activity from friends yet.</Text>
    }

    return <Text style={styles.muted}>No activity yet. Add friends or start building shelves!</Text>
  }

  return (
    <View style={styles.screen}>
      <View style={styles.container}>
        <View style={styles.headerArea}>
          <Text style={styles.header}>Your Feed</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search shelves or collectors"
            placeholderTextColor="#55657a"
            value={searchTerm}
            onChangeText={setSearchTerm}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <View style={styles.headerActions}>
            <TouchableOpacity
              style={styles.headerLinkButton}
              onPress={openFriendSearch}
              activeOpacity={0.7}
            >
              <Text style={styles.headerLinkText}>Find friends</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.filterRow}>
          {FILTERS.map((filter) => {
            const selected = activeFilter === filter.key
            return (
              <TouchableOpacity
                key={filter.key}
                style={[styles.filterChip, selected && styles.filterChipActive]}
                onPress={() => setActiveFilter(filter.key)}
                activeOpacity={0.7}
              >
                <Text style={[styles.filterText, selected && styles.filterTextActive]}>{filter.label}</Text>
              </TouchableOpacity>
            )
          })}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <FlatList
          data={combinedEntries}
          keyExtractor={(item, idx) => (item?.shelf?.id ? `${item.shelf.id}-${item.__origin}` : `entry-${idx}`)}
          renderItem={renderItem}
          contentContainerStyle={combinedEntries.length ? styles.listContent : styles.listEmpty}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#7ca6ff" />}
          ListEmptyComponent={renderEmpty}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        />
      </View>
      <FooterNav navigation={navigation} active="home" />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0b0f14' },
  container: { flex: 1, padding: 16 },
  headerArea: { gap: 12, marginBottom: 16 },
  header: { color: '#e6edf3', fontSize: 24, fontWeight: '700' },
  searchInput: {
    backgroundColor: '#0e1522',
    color: '#e6edf3',
    borderColor: '#223043',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  headerActions: { flexDirection: 'row', justifyContent: 'flex-end' },
  headerLinkButton: { paddingVertical: 4, paddingHorizontal: 6 },
  headerLinkText: { color: '#7ca6ff', fontSize: 13 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  filterChip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#223043',
    backgroundColor: '#0b1320',
  },
  filterChipActive: { borderColor: '#5a8efc', backgroundColor: '#15223a' },
  filterText: { color: '#9aa6b2', fontSize: 12 },
  filterTextActive: { color: '#7ca6ff', fontWeight: '600' },
  error: { color: '#ff9aa3', marginBottom: 8 },
  listContent: { paddingBottom: 80 },
  listEmpty: { flexGrow: 1, justifyContent: 'center', paddingBottom: 80 },
  card: {
    backgroundColor: '#0e1522',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#223043',
    padding: 14,
    marginBottom: 12,
    gap: 8,
  },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between' },
  badgeStack: { alignItems: 'flex-end', gap: 6 },
  scopeBadge: {
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: 999,
    fontSize: 11,
    fontWeight: '600',
  },
  scopeBadgePublic: {
    color: '#5a8efc',
    borderColor: '#5a8efc',
    borderWidth: 1,
  },
  scopeBadgeFriends: {
    color: '#8bd9ab',
    borderColor: '#3b6c4c',
    borderWidth: 1,
  },
  ownerName: { color: '#e6edf3', fontWeight: '600' },
  ownerLocation: { color: '#9aa6b2', fontSize: 12 },
  tag: {
    color: '#9aa6b2',
    borderColor: '#223043',
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: 999,
    fontSize: 12,
  },
  shelfTitle: { color: '#e6edf3', fontSize: 18, fontWeight: '600' },
  shelfDescription: { color: '#9aa6b2' },
  itemsPreview: { gap: 4 },
  itemLine: { color: '#c0cada', fontSize: 13 },
  moreItems: { color: '#7ca6ff', fontSize: 13, marginTop: 4 },
  muted: { color: '#9aa6b2', textAlign: 'center' },
  timestamp: { color: '#55657a', fontSize: 11, textAlign: 'right' },
  emptyState: { alignItems: 'center', gap: 12 },
})
