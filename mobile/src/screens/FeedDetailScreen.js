import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import FooterNav from '../components/FooterNav'
import { AuthContext } from '../context/AuthContext'
import { apiRequest } from '../services/api'

function formatDate(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return ''
  return date.toLocaleString()
}

function getItemTitle(entry) {
  if (!entry) return 'Untitled item'
  const collectable = entry.collectable || null
  const manual = entry.manual || null
  return collectable?.name || manual?.name || 'Untitled item'
}

function getItemMeta(entry) {
  if (!entry) return ''
  const collectable = entry.collectable || null
  const manual = entry.manual || null
  const parts = []
  if (collectable) {
    if (collectable.author) parts.push(collectable.author)
    if (collectable.format) parts.push(collectable.format)
    if (collectable.year) parts.push(collectable.year)
  } else if (manual) {
    if (manual.type) parts.push(manual.type)
  }
  return parts.filter(Boolean).join(' • ')
}

export default function FeedDetailScreen({ route, navigation }) {
  const params = route.params || {}
  const initialEntry = params.entry || null
  const initialTitle = params.title
  const paramShelfId = params.shelfId || params.id || initialEntry?.shelf?.id || null

  const { token, apiBase } = useContext(AuthContext)
  const [entry, setEntry] = useState(initialEntry || null)
  const [loading, setLoading] = useState(!initialEntry)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  const resolvedShelfId = useMemo(() => {
    if (entry?.shelf?.id) return entry.shelf.id
    return paramShelfId
  }, [entry, paramShelfId])

  useEffect(() => {
    if (initialEntry?.shelf?.name) {
      navigation.setOptions({ title: initialEntry.shelf.name })
    } else if (initialTitle) {
      navigation.setOptions({ title: initialTitle })
    }
  }, [initialEntry, initialTitle, navigation])

  const load = useCallback(
    async (opts = {}) => {
      if (!token || !resolvedShelfId) {
        setLoading(false)
        setRefreshing(false)
        if (!resolvedShelfId) setError('Feed entry is missing.')
        return
      }

      if (!opts.silent) setLoading(true)
      try {
        const data = await apiRequest({
          apiBase,
          path: `/api/feed/${resolvedShelfId}`,
          token,
        })
        setEntry(data.entry)
        if (data.entry?.shelf?.name) {
          navigation.setOptions({ title: data.entry.shelf.name })
        }
        setError('')
      } catch (err) {
        setError(err.message || 'Unable to load feed details.')
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [apiBase, token, resolvedShelfId, navigation],
  )

  useEffect(() => {
    load()
  }, [load])

  const onRefresh = useCallback(() => {
    setRefreshing(true)
    load({ silent: true })
  }, [load])

  const items = entry?.items || []
  const itemsCount = items.length

  const listHeader = useMemo(() => {
    if (!entry) return null
    const shelf = entry.shelf || {}
    const owner = entry.owner || {}
    const location = [owner.city, owner.state, owner.country].filter(Boolean).join(', ')
    const visibility = (shelf.visibility || 'public').toUpperCase()
    const updated = formatDate(shelf.updatedAt)
    return (
      <View style={styles.headerCard}>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Text style={styles.shelfName}>{shelf.name || 'Shelf'}</Text>
        {shelf.description ? <Text style={styles.shelfDescription}>{shelf.description}</Text> : null}
        <View style={styles.ownerBlock}>
          <Text style={styles.ownerLabel}>Curated by</Text>
          <Text style={styles.ownerName}>{owner.name || owner.username || 'Someone'}</Text>
          {location ? <Text style={styles.ownerMeta}>{location}</Text> : null}
        </View>
        <View style={styles.metaRow}>
          {shelf.type ? <Text style={styles.metaPill}>{shelf.type}</Text> : null}
          <Text style={styles.metaPill}>{`${itemsCount} item${itemsCount === 1 ? '' : 's'}`}</Text>
          <Text style={styles.metaPill}>{visibility}</Text>
        </View>
        {updated ? <Text style={styles.ownerMeta}>Updated {updated}</Text> : null}
        <Text style={styles.sectionTitle}>Collectables</Text>
      </View>
    )
  }, [entry, itemsCount, error])

  const handleOpenCollectable = useCallback(
    (collectable) => {
      if (!collectable?._id) return
      navigation.navigate('CollectableDetail', { id: collectable._id, title: collectable.name })
    },
    [navigation],
  )

  const renderItem = useCallback(
    ({ item }) => {
      const title = getItemTitle(item)
      const meta = getItemMeta(item)
      const manualDescription = item?.manual?.description || ''
      const added = formatDate(item.createdAt)
      const canOpenCollectable = Boolean(item?.collectable?._id)
      const onPress = canOpenCollectable ? () => handleOpenCollectable(item.collectable) : undefined

      return (
        <TouchableOpacity
          style={styles.itemCard}
          activeOpacity={canOpenCollectable ? 0.7 : 1}
          onPress={onPress}
          disabled={!canOpenCollectable}
        >
          <View style={styles.itemTextBlock}>
            <Text style={styles.itemTitle}>{title}</Text>
            {meta ? <Text style={styles.itemMeta}>{meta}</Text> : null}
            {manualDescription ? <Text style={styles.itemMeta}>{manualDescription}</Text> : null}
            {added ? <Text style={styles.itemTimestamp}>Added {added}</Text> : null}
          </View>
          {canOpenCollectable ? <Text style={styles.itemLink}>View</Text> : null}
        </TouchableOpacity>
      )
    },
    [handleOpenCollectable],
  )

  const listEmpty = useMemo(() => {
    if (loading) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator color='#7ca6ff' size='small' />
          <Text style={styles.message}>Loading items...</Text>
        </View>
      )
    }
    return <Text style={styles.message}>No collectables yet.</Text>
  }, [loading])

  let content = null

  if (!entry && loading) {
    content = (
      <View style={styles.centered}>
        <ActivityIndicator color='#7ca6ff' size='small' />
        <Text style={styles.message}>Loading feed details...</Text>
      </View>
    )
  } else if (!entry && error) {
    content = (
      <View style={styles.centered}>
        <Text style={styles.error}>{error}</Text>
        <TouchableOpacity onPress={() => load()} activeOpacity={0.7}>
          <Text style={styles.retry}>Try again</Text>
        </TouchableOpacity>
      </View>
    )
  } else if (entry) {
    content = (
      <FlatList
        data={items}
        keyExtractor={(item, index) => item?.id || `feed-item-${index}`}
        renderItem={renderItem}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={listEmpty}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor='#7ca6ff' />}
      />
    )
  } else {
    content = (
      <View style={styles.centered}>
        <Text style={styles.message}>Feed entry unavailable.</Text>
      </View>
    )
  }

  return (
    <View style={styles.screen}>
      <View style={styles.container}>{content}</View>
      <FooterNav navigation={navigation} active='home' />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0b0f14' },
  container: { flex: 1, padding: 16 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  message: { color: '#9aa6b2', textAlign: 'center' },
  error: { color: '#ff9aa3', textAlign: 'center' },
  retry: { color: '#7ca6ff', fontWeight: '600' },
  listContent: { paddingBottom: 100, gap: 12 },
  headerCard: {
    backgroundColor: '#0e1522',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#223043',
    padding: 16,
    gap: 8,
  },
  shelfName: { color: '#e6edf3', fontSize: 22, fontWeight: '700' },
  shelfDescription: { color: '#9aa6b2' },
  ownerBlock: { gap: 2 },
  ownerLabel: { color: '#55657a', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 },
  ownerName: { color: '#e6edf3', fontWeight: '600' },
  ownerMeta: { color: '#9aa6b2', fontSize: 12 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metaPill: {
    color: '#7ca6ff',
    borderColor: '#223043',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 4,
    fontSize: 12,
  },
  sectionTitle: { color: '#e6edf3', fontSize: 16, fontWeight: '600', marginTop: 4 },
  itemCard: {
    backgroundColor: '#0e1522',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#223043',
    padding: 16,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  itemTextBlock: { flex: 1, gap: 4 },
  itemTitle: { color: '#e6edf3', fontSize: 16, fontWeight: '600' },
  itemMeta: { color: '#9aa6b2', fontSize: 13 },
  itemTimestamp: { color: '#55657a', fontSize: 11 },
  itemLink: { color: '#7ca6ff', fontSize: 13, fontWeight: '500' },
})
