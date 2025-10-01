import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import FooterNav from '../components/FooterNav'
import { AuthContext } from '../App'
import { apiRequest } from '../services/api'
import { FriendSearchSyncProvider } from '../hooks/useFriendSearchSync'

const MIN_QUERY_LENGTH = 2

function normalizeFriendshipStatus({ relation, status, direction }) {
  if (relation === 'friends' || status === 'accepted') return { relation: 'friends', label: 'Friends', actionable: false }
  if (relation === 'outgoing' || (status === 'pending' && direction === 'outgoing')) {
    return { relation: 'outgoing', label: 'Requested', actionable: true }
  }
  if (relation === 'incoming' || (status === 'pending' && direction === 'incoming')) {
    return { relation: 'incoming', label: 'Respond', actionable: true }
  }
  if (relation === 'blocked' || status === 'blocked') return { relation: 'blocked', label: 'Blocked', actionable: false }
  return { relation: 'none', label: 'Add Friend', actionable: true }
}

export default function FriendSearchScreen({ navigation }) {
  const { token, apiBase } = useContext(AuthContext)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [busyMap, setBusyMap] = useState({})

  const setBusyForUser = useCallback((id, value) => {
    setBusyMap((prev) => ({ ...prev, [id]: value }))
  }, [])

  useEffect(() => {
    if (!token) {
      setResults([])
      setLoading(false)
      setError('')
      return
    }

    const trimmed = query.trim()
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setResults([])
      setLoading(false)
      setError('')
      return
    }

    let cancelled = false
    setLoading(true)
    setError('')

    const run = async () => {
      try {
        const data = await apiRequest({
          apiBase,
          path: `/api/friends/search?q=${encodeURIComponent(trimmed)}`,
          token,
        })
        if (!cancelled) {
          setResults(Array.isArray(data.users) ? data.users : [])
          setError('')
        }
      } catch (e) {
        if (!cancelled) {
          if (e?.status === 404) {
            setResults([])
            setError('')
          } else {
            setError(e.message)
            setResults([])
          }
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    const handle = setTimeout(run, 250)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [apiBase, query, token])

  const mutateResult = useCallback((userId, updater) => {
    setResults((prev) => prev.map((item) => (item.id === userId ? updater(item) : item)))
  }, [])

  const handleRequestSuccess = useCallback(
    (userId, data) => {
      const friendship = data?.friendship
      const autoAccepted = data?.autoAccepted || data?.alreadyFriends
      const nextStatus =
        friendship?.status || (autoAccepted ? 'accepted' : 'pending')
      const relation = nextStatus === 'accepted' || autoAccepted ? 'friends' : 'outgoing'

      mutateResult(userId, (prev) => ({
        ...prev,
        relation,
        status: nextStatus,
        direction: relation === 'outgoing' ? 'outgoing' : null,
        friendshipId: friendship ? String(friendship._id || friendship.id || friendship) : prev.friendshipId,
      }))
      setError('')
    },
    [mutateResult, setError],
  )

  const handleRespondSuccess = useCallback(
    ({ userId, action, data }) => {
      if (action === 'accept') {
        const friendship = data?.friendship
        mutateResult(userId, (prev) => ({
          ...prev,
          relation: 'friends',
          status: 'accepted',
          direction: null,
          friendshipId: friendship ? String(friendship._id || friendship.id || friendship) : prev.friendshipId,
        }))
      } else {
        mutateResult(userId, (prev) => ({
          ...prev,
          relation: 'none',
          status: null,
          direction: null,
          friendshipId: null,
        }))
      }
      setError('')
    },
    [mutateResult, setError],
  )

  const handleMutationError = useCallback(
    (message) => {
      setError(message || '')
    },
    [setError],
  )

  const handleSendRequest = useCallback(
    async (user) => {
      const userId = user.id
      setBusyForUser(userId, true)
      try {
        const data = await apiRequest({
          apiBase,
          path: '/api/friends/request',
          method: 'POST',
          token,
          body: { targetUserId: userId },
        })
        handleRequestSuccess(userId, data)
      } catch (e) {
        handleMutationError(e.message)
      } finally {
        setBusyForUser(userId, false)
      }
    },
    [apiBase, handleMutationError, handleRequestSuccess, setBusyForUser, token],
  )

  const handleRespond = useCallback(
    async ({ friendshipId, action, userId }) => {
      if (!friendshipId) return
      setBusyForUser(userId, true)
      try {
        const data = await apiRequest({
          apiBase,
          path: '/api/friends/respond',
          method: 'POST',
          token,
          body: { friendshipId, action },
        })
        handleRespondSuccess({ userId, action, data })
      } catch (e) {
        handleMutationError(e.message)
      } finally {
        setBusyForUser(userId, false)
      }
    },
    [apiBase, handleMutationError, handleRespondSuccess, setBusyForUser, token],
  )

  const renderItem = useCallback(
    ({ item }) => {
      const statusInfo = normalizeFriendshipStatus(item)
      const busy = !!busyMap[item.id]
      const locationLabel = item.location || ''
      const usernameLabel = item.username ? `@${item.username}` : ''

      return (
        <View style={styles.resultCard}>
          <View style={styles.resultDetails}>
            <Text style={styles.resultName}>{item.name || item.username || 'Collector'}</Text>
            {usernameLabel ? <Text style={styles.resultUsername}>{usernameLabel}</Text> : null}
            {locationLabel ? <Text style={styles.resultLocation}>{locationLabel}</Text> : null}
          </View>
          <View style={styles.resultActions}>
            {statusInfo.relation === 'friends' ? (
              <Text style={styles.statusBadge}>Friends</Text>
            ) : statusInfo.relation === 'blocked' ? (
              <Text style={styles.statusBadge}>Blocked</Text>
            ) : statusInfo.relation === 'incoming' ? (
              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={[styles.actionButton, styles.primaryButton, busy && styles.buttonDisabled]}
                  onPress={() => handleRespond({ friendshipId: item.friendshipId, action: 'accept', userId: item.id })}
                  disabled={busy}
                >
                  {busy ? <ActivityIndicator color="#0b0f14" size="small" /> : <Text style={styles.actionTextPrimary}>Accept</Text>}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionButton, styles.secondaryButton, busy && styles.buttonDisabled]}
                  onPress={() => handleRespond({ friendshipId: item.friendshipId, action: 'reject', userId: item.id })}
                  disabled={busy}
                >
                  {busy ? <ActivityIndicator color="#7ca6ff" size="small" /> : <Text style={styles.actionTextSecondary}>Dismiss</Text>}
                </TouchableOpacity>
              </View>
            ) : statusInfo.relation === 'outgoing' ? (
              <View style={styles.actionRow}>
                <Text style={styles.statusBadge}>Requested</Text>
                <TouchableOpacity
                  style={[styles.linkButton, busy && styles.buttonDisabled]}
                  onPress={() => handleRespond({ friendshipId: item.friendshipId, action: 'cancel', userId: item.id })}
                  disabled={busy}
                >
                  {busy ? <ActivityIndicator color="#7ca6ff" size="small" /> : <Text style={styles.linkButtonText}>Cancel</Text>}
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={[styles.actionButton, styles.primaryButton, busy && styles.buttonDisabled]}
                onPress={() => handleSendRequest(item)}
                disabled={busy}
              >
                {busy ? <ActivityIndicator color="#0b0f14" size="small" /> : <Text style={styles.actionTextPrimary}>Add Friend</Text>}
              </TouchableOpacity>
            )}
          </View>
        </View>
      )
    },
    [busyMap, handleRespond, handleSendRequest],
  )

  const listEmpty = useMemo(() => {
    if (query.trim().length < MIN_QUERY_LENGTH) {
      return <Text style={styles.muted}>Search by username or name to find collectors.</Text>
    }
    if (loading) {
      return (
        <View style={styles.emptyState}>
          <ActivityIndicator color="#7ca6ff" size="small" />
          <Text style={styles.muted}>Searching friends...</Text>
        </View>
      )
    }
    if (error) {
      return <Text style={styles.error}>{error}</Text>
    }
    return <Text style={styles.muted}>No collectors found. Try a different search.</Text>
  }, [error, loading, query])

  const friendSyncValue = useMemo(
    () => ({
      setBusyForUser,
      handleRequestSuccess,
      handleRespondSuccess,
      handleMutationError,
    }),
    [handleMutationError, handleRequestSuccess, handleRespondSuccess, setBusyForUser],
  )

  return (
    <FriendSearchSyncProvider value={friendSyncValue}>
      <View style={styles.screen}>
        <View style={styles.container}>
          <Text style={styles.title}>Find Friends</Text>
          <Text style={styles.subtitle}>Search for collectors to build your network.</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search by name or username"
            placeholderTextColor="#55657a"
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
            autoCapitalize="none"
          />
          {error && query.trim().length >= MIN_QUERY_LENGTH ? <Text style={styles.error}>{error}</Text> : null}

          <FlatList
            data={results}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            contentContainerStyle={results.length ? styles.listContent : styles.listEmpty}
            ListEmptyComponent={listEmpty}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          />
        </View>
        <FooterNav navigation={navigation} active="home" />
      </View>
    </FriendSearchSyncProvider>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0b0f14' },
  container: { flex: 1, padding: 16, gap: 12 },
  title: { color: '#e6edf3', fontSize: 24, fontWeight: '700' },
  subtitle: { color: '#9aa6b2', marginBottom: 4 },
  searchInput: {
    backgroundColor: '#0e1522',
    color: '#e6edf3',
    borderColor: '#223043',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  error: { color: '#ff9aa3', marginTop: 4 },
  muted: { color: '#9aa6b2', textAlign: 'center', marginTop: 24 },
  listContent: { paddingBottom: 80, gap: 12 },
  listEmpty: { flexGrow: 1, justifyContent: 'center', paddingBottom: 80 },
  emptyState: { alignItems: 'center', gap: 12 },
  resultCard: {
    backgroundColor: '#0e1522',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#223043',
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 16,
  },
  resultDetails: { flex: 1, gap: 4 },
  resultName: { color: '#e6edf3', fontSize: 16, fontWeight: '600' },
  resultUsername: { color: '#7ca6ff', fontSize: 13 },
  resultLocation: { color: '#9aa6b2', fontSize: 12 },
  resultActions: { justifyContent: 'center', alignItems: 'flex-end', gap: 8, minWidth: 110 },
  actionRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  actionButton: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 96,
  },
  primaryButton: { backgroundColor: '#5a8efc' },
  secondaryButton: { borderWidth: 1, borderColor: '#223043', backgroundColor: '#0b1320' },
  buttonDisabled: { opacity: 0.7 },
  actionTextPrimary: { color: '#0b0f14', fontWeight: '600' },
  actionTextSecondary: { color: '#7ca6ff', fontWeight: '600' },
  statusBadge: { color: '#9aa6b2', fontSize: 12 },
  linkButton: { paddingVertical: 4, paddingHorizontal: 6 },
  linkButtonText: { color: '#7ca6ff', fontSize: 12 },
})
