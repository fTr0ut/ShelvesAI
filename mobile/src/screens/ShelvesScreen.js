import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { AuthContext } from '../App'
import FooterNav from '../components/FooterNav'
import { apiRequest } from '../services/api'

const VISIBILITY_OPTIONS = [
  { value: 'private', label: 'Private' },
  { value: 'friends', label: 'Friends' },
  { value: 'public', label: 'Public' },
]

const SORT_OPTIONS = [
  { value: 'alpha-asc', label: 'A to Z' },
  { value: 'alpha-desc', label: 'Z to A' },
  { value: 'created-desc', label: 'Date Created' },
]

const COLUMN_COUNT = 3
const NEW_TILE_ID = '__new__'

export default function ShelvesScreen({ navigation }) {
  const { token, apiBase } = useContext(AuthContext)
  const [shelves, setShelves] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [sortMode, setSortMode] = useState('alpha-asc')

  const loadShelves = useCallback(async () => {
    try {
      setLoading(true)
      const data = await apiRequest({ apiBase, path: '/api/shelves', token })
      setShelves(Array.isArray(data.shelves) ? data.shelves : [])
      setError('')
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [apiBase, token])

  useEffect(() => {
    loadShelves()
  }, [loadShelves])

  const sortedShelves = useMemo(() => {
    const list = Array.isArray(shelves) ? [...shelves] : []
    const compareName = (a, b) => String(a?.name || '').localeCompare(String(b?.name || ''))
    const compareDate = (a, b) => new Date(b?.createdAt || 0) - new Date(a?.createdAt || 0)

    switch (sortMode) {
      case 'alpha-asc':
        return list.sort(compareName)
      case 'alpha-desc':
        return list.sort((a, b) => compareName(b, a))
      case 'created-desc':
        return list.sort(compareDate)
      default:
        return list.sort(compareName)
    }
  }, [shelves, sortMode])

  const gridData = useMemo(() => {
    const base = Array.isArray(sortedShelves) ? sortedShelves : []
    const newTile = { _id: NEW_TILE_ID, isNew: true }
    return base.length ? [...base, newTile] : [newTile]
  }, [sortedShelves])

  const visibilityLabelFor = (value) => VISIBILITY_OPTIONS.find((opt) => opt.value === value)?.label || value

  const handleOpenShelf = useCallback(
    (shelf) => {
      navigation.navigate('ShelfDetail', { id: shelf._id, title: shelf.name })
    },
    [navigation],
  )

  const handleCreateShelf = useCallback(() => {
    navigation.navigate('ShelfCreate')
  }, [navigation])

  const renderShelfTile = ({ item }) => {
    if (item.isNew) {
      return (
        <TouchableOpacity style={[styles.tile, styles.newTile]} onPress={handleCreateShelf} activeOpacity={0.85}>
          <Text style={styles.newTileLabel}>NEW</Text>
          <Text style={styles.newTileHint}>Create Shelf</Text>
        </TouchableOpacity>
      )
    }

    const createdLabel = item.createdAt ? new Date(item.createdAt).toLocaleDateString() : ''

    return (
      <TouchableOpacity style={styles.tile} onPress={() => handleOpenShelf(item)} activeOpacity={0.8}>
        <Text style={styles.tileTitle}>{item.name || 'Untitled Shelf'}</Text>
        <View style={styles.tileMetaRow}>
          <Text style={styles.pill}>{item.type || 'Unsorted'}</Text>
          <Text style={[styles.pill, styles.pillSecondary]}>{visibilityLabelFor(item.visibility)}</Text>
        </View>
        {item.description ? (
          <Text style={styles.tileDescription} numberOfLines={2}>
            {item.description}
          </Text>
        ) : null}
        <View style={styles.tileFooter}>
          {createdLabel ? <Text style={styles.tileTimestamp}>{createdLabel}</Text> : <View />}
        </View>
      </TouchableOpacity>
    )
  }

  const renderLoading = () => (
    <View style={styles.loadingState}>
      <ActivityIndicator color="#5a8efc" size="large" />
      <Text style={styles.muted}>Loading shelves...</Text>
    </View>
  )

  return (
    <View style={styles.screen}>
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>My Shelves</Text>
        </View>

        {!!error && <Text style={styles.error}>{error}</Text>}

        <View style={styles.sectionHeader}>
          <Text style={styles.section}>Shelves</Text>
          {sortedShelves.length ? (
            <TouchableOpacity onPress={handleCreateShelf}>
              <Text style={styles.link}>New Shelf</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {sortedShelves.length ? (
          <View style={styles.sortRow}>
            {SORT_OPTIONS.map((opt) => {
              const selected = sortMode === opt.value
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.sortChip, selected && styles.sortChipActive]}
                  onPress={() => setSortMode(opt.value)}
                >
                  <Text style={[styles.sortChipText, selected && styles.sortChipTextActive]}>{opt.label}</Text>
                </TouchableOpacity>
              )
            })}
          </View>
        ) : null}

        {loading ? (
          renderLoading()
        ) : (
          <FlatList
            data={gridData}
            keyExtractor={(item) => item._id}
            renderItem={renderShelfTile}
            numColumns={COLUMN_COUNT}
            columnWrapperStyle={gridData.length > 1 ? styles.columnWrapper : undefined}
            contentContainerStyle={gridData.length > 1 ? styles.gridContent : styles.gridEmpty}
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>

      <FooterNav navigation={navigation} active="shelves" />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0b0f14' },
  container: { flex: 1, padding: 16 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  title: { color: '#e6edf3', fontSize: 22, fontWeight: '700' },
  link: { color: '#7ca6ff', fontSize: 14 },
  section: { color: '#9aa6b2', textTransform: 'uppercase', fontSize: 12, letterSpacing: 0.5 },
  error: { color: '#ff9aa3', marginBottom: 6 },
  muted: { color: '#9aa6b2', marginTop: 12 },
  sortRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  sortChip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: '#223043', backgroundColor: '#0b1320' },
  sortChipActive: { borderColor: '#5a8efc', backgroundColor: '#15223a' },
  sortChipText: { color: '#9aa6b2', fontSize: 12 },
  sortChipTextActive: { color: '#7ca6ff' },
  columnWrapper: { gap: 12, marginBottom: 12 },
  gridContent: { paddingBottom: 100 },
  gridEmpty: { flexGrow: 1, justifyContent: 'center', paddingBottom: 100 },
  tile: { flex: 1, backgroundColor: '#0e1522', borderColor: '#223043', borderWidth: 1, borderRadius: 12, padding: 12, minHeight: 120, justifyContent: 'space-between' },
  tileTitle: { color: '#e6edf3', fontSize: 16, fontWeight: '600' },
  tileMetaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  pill: { color: '#9aa6b2', borderColor: '#223043', borderWidth: 1, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  pillSecondary: { borderColor: '#34445d' },
  tileDescription: { color: '#9aa6b2', fontSize: 12, marginTop: 6 },
  tileFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 },
  tileTimestamp: { color: '#55657a', fontSize: 11 },
  newTile: { alignItems: 'center', justifyContent: 'center', borderStyle: 'dashed', borderColor: '#5a8efc', borderWidth: 1.5, backgroundColor: '#0b1320' },
  newTileLabel: { color: '#5a8efc', fontSize: 22, fontWeight: '700', letterSpacing: 1 },
  newTileHint: { color: '#9aa6b2', marginTop: 4, fontSize: 12 },
  loadingState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 40 },
})
