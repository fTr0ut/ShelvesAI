import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, Switch, StyleSheet, ScrollView, ActivityIndicator } from 'react-native'
import FooterNav from '../components/FooterNav'
import { AuthContext } from '../App'
import { apiRequest, clearToken } from '../services/api'
import useAuthDebug from '../hooks/useAuthDebug'
import { Button } from 'react-native'

export default function AccountScreen({ navigation }) {
  const { token, setToken, apiBase, setNeedsOnboarding } = useContext(AuthContext)
  const [friendships, setFriendships] = useState([])
  const [friendsLoading, setFriendsLoading] = useState(true)
  const [friendError, setFriendError] = useState("")
  const [friendMessage, setFriendMessage] = useState("")
  const [friendBusy, setFriendBusy] = useState({})
  const [user, setUser] = useState(null)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const { clearAuthCache } = useAuthDebug()

 

  useEffect(() => {
    (async () => {
      try {
        const data = await apiRequest({ apiBase, path: '/api/account', token })
        setUser(data.user)
      } catch (e) {
        setErr(e.message)
      }
    })()
  }, [apiBase, token])

  const loadFriendships = useCallback(async () => {
    if (!token) {
      setFriendships([])
      setFriendsLoading(false)
      return
    }

    setFriendsLoading(true)
    setFriendError('')
    setFriendMessage('')
    try {
      const data = await apiRequest({ apiBase, path: '/api/friends', token })
      setFriendships(Array.isArray(data.friendships) ? data.friendships : [])
    } catch (e) {
      setFriendError(e.message)
      setFriendships([])
    } finally {
      setFriendsLoading(false)
      setFriendBusy({})
    }
  }, [apiBase, token])

  useEffect(() => {
    loadFriendships()
  }, [loadFriendships])

  const incomingRequests = useMemo(() => friendships.filter((f) => f.status === 'pending' && !f.isRequester), [friendships])
  const outgoingRequests = useMemo(() => friendships.filter((f) => f.status === 'pending' && f.isRequester), [friendships])

  const getPeer = useCallback((entry) => {
    if (!entry) return {}
    return entry[entry.isRequester ? 'addressee' : 'requester'] || {}
  }, [])

  const logout = useCallback(async () => {
    try {
      setMsg('')
      setErr('')
      await clearToken()
      setNeedsOnboarding(false)
      setToken('')
    } catch (e) {
      setErr(e.message || 'Failed to log out')
    }
  }, [setToken, setErr, setMsg, setNeedsOnboarding])

  const handleFriendRespond = useCallback(async (friendshipId, action) => {
    if (!friendshipId || !action) return
    setFriendBusy((prev) => ({ ...prev, [friendshipId]: true }))
    setFriendMessage('')
    try {
      await apiRequest({
        apiBase,
        path: '/api/friends/respond',
        method: 'POST',
        token,
        body: { friendshipId, action },
      })
      if (action === 'accept') {
        setFriendMessage('Friend request accepted.')
      } else if (action === 'reject') {
        setFriendMessage('Friend request dismissed.')
      } else if (action === 'cancel') {
        setFriendMessage('Friend request cancelled.')
      }
      await loadFriendships()
    } catch (e) {
      setFriendError(e.message)
    } finally {
      setFriendBusy((prev) => ({ ...prev, [friendshipId]: false }))
    }
  }, [apiBase, token, loadFriendships])

  const update = async () => {
    try {
      setMsg('')
      setErr('')
      const data = await apiRequest({ apiBase, path: '/api/account', method: 'PUT', token, body: user })
      setUser(data.user)
      setMsg('Saved')
    } catch (e) {
      setErr(e.message)
    }
  }

  return (
    <View style={styles.screen}>
      {!user ? (
        <View style={styles.centered}><Text style={styles.muted}>Loading�</Text></View>
      ) : (
        <ScrollView style={styles.container} contentContainerStyle={styles.content}>
          <Text style={styles.title}>Account & Settings</Text>
          {!!msg && <Text style={styles.success}>{msg}</Text>}
          {!!err && <Text style={styles.error}>{err}</Text>}
          <View style={styles.card}>
            <Text style={styles.section}>Profile</Text>
            <Row label={'Username'}><TextInput style={styles.username} value={user.username || ''} editable={false} /></Row>
            <Row label='First Name'><TextInput style={styles.input} value={user.firstName || ''} onChangeText={(v) => setUser({ ...user, firstName: v })} /></Row>
            <Row label='Last Name'><TextInput style={styles.input} value={user.lastName || ''} onChangeText={(v) => setUser({ ...user, lastName: v })} /></Row>
            <Row label='Phone'><TextInput style={styles.input} value={user.phoneNumber || ''} onChangeText={(v) => setUser({ ...user, phoneNumber: v })} /></Row>
            <Row label='Country'><TextInput style={styles.input} value={user.country || ''} onChangeText={(v) => setUser({ ...user, country: v })} /></Row>
            <Row label='City'><TextInput style={styles.input} value={user.city || ''} onChangeText={(v) => setUser({ ...user, city: v })} /></Row>
            <Row label='State'><TextInput style={styles.input} value={user.state || ''} onChangeText={(v) => setUser({ ...user, state: v })} /></Row>
            <Row label='Private'>
              <Switch value={!!user.isPrivate} onValueChange={(v) => setUser({ ...user, isPrivate: v })} />
            </Row>
            <TouchableOpacity style={[styles.button, styles.primary]} onPress={update}><Text style={styles.buttonText}>Save</Text></TouchableOpacity>
            <TouchableOpacity style={[styles.button, styles.logout]} onPress={logout}><Text style={styles.logoutText}>Log out</Text></TouchableOpacity>
          </View>
          <View style={styles.requestCard}>
            <Text style={styles.section}>Friend Requests</Text>
            {friendError ? <Text style={styles.error}>{friendError}</Text> : null}
            {friendMessage ? <Text style={styles.success}>{friendMessage}</Text> : null}
            {friendsLoading ? (
              <View style={styles.pendingLoading}>
                <ActivityIndicator color="#5a8efc" size="small" />
                <Text style={styles.muted}>Loading requests...</Text>
              </View>
            ) : !incomingRequests.length && !outgoingRequests.length ? (
              <Text style={styles.muted}>No pending requests.</Text>
            ) : (
              <>
                {incomingRequests.length ? (
                  <>
                    <Text style={styles.subSection}>Waiting for your response</Text>
                    {incomingRequests.map((item) => {
                      const peer = getPeer(item)
                      const displayName = peer?.name || peer?.username || 'Collector'
                      const usernameLabel = peer?.username ? `@${peer.username}` : ''
                      const busy = !!friendBusy[item.id]
                      return (
                        <View key={item.id} style={styles.requestRow}>
                          <View style={styles.requestInfo}>
                            <Text style={styles.requestName}>{displayName}</Text>
                            {usernameLabel ? <Text style={styles.requestUsername}>{usernameLabel}</Text> : null}
                            <Text style={styles.requestHint}>sent you a friend request</Text>
                          </View>
                          <View style={styles.requestActions}>
                            <TouchableOpacity
                              style={[styles.requestButton, styles.requestButtonPrimary, busy && styles.requestButtonDisabled]}
                              onPress={() => handleFriendRespond(item.id, 'accept')}
                              disabled={busy}
                            >
                              {busy ? (
                                <ActivityIndicator color="#0b0f14" size="small" />
                              ) : (
                                <Text style={styles.requestButtonTextPrimary}>Accept</Text>
                              )}
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[styles.requestButton, styles.requestButtonSecondary, busy && styles.requestButtonDisabled]}
                              onPress={() => handleFriendRespond(item.id, 'reject')}
                              disabled={busy}
                            >
                              {busy ? (
                                <ActivityIndicator color="#7ca6ff" size="small" />
                              ) : (
                                <Text style={styles.requestButtonTextSecondary}>Dismiss</Text>
                              )}
                            </TouchableOpacity>
                          </View>
                        </View>
                      )
                    })}
                  </>
                ) : null}

                {outgoingRequests.length ? (
                  <>
                    <Text style={styles.subSection}>Requests you've sent</Text>
                    {outgoingRequests.map((item) => {
                      const peer = getPeer(item)
                      const displayName = peer?.name || peer?.username || 'Collector'
                      const usernameLabel = peer?.username ? `@${peer.username}` : ''
                      const busy = !!friendBusy[item.id]
                      return (
                        <View key={item.id} style={styles.requestRow}>
                          <View style={styles.requestInfo}>
                            <Text style={styles.requestName}>{displayName}</Text>
                            {usernameLabel ? <Text style={styles.requestUsername}>{usernameLabel}</Text> : null}
                            <Text style={styles.requestHint}>awaiting their response</Text>
                          </View>
                          <View style={styles.requestActions}>
                            <TouchableOpacity
                              style={[styles.requestButton, styles.requestButtonSecondary, busy && styles.requestButtonDisabled]}
                              onPress={() => handleFriendRespond(item.id, 'cancel')}
                              disabled={busy}
                            >
                              {busy ? (
                                <ActivityIndicator color="#7ca6ff" size="small" />
                              ) : (
                                <Text style={styles.requestButtonTextSecondary}>Cancel</Text>
                              )}
                            </TouchableOpacity>
                          </View>
                        </View>
                      )
                    })}
                  </>
                ) : null}
              </>
            )}
          </View>
        </ScrollView>
      )}
      <FooterNav navigation={navigation} active='account' />
    </View>
  )
}

function Row({ label, children }) {
  return (
    <View style={rowStyles.row}>
      <Text style={rowStyles.label}>{label}</Text>
      <View style={{ flex: 1 }}>{children}</View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0b0f14' },
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  centered: { flex: 1, backgroundColor: '#0b0f14', alignItems: 'center', justifyContent: 'center' },
  title: { color: '#e6edf3', fontSize: 22, fontWeight: '700', marginBottom: 8 },
  section: { color: '#9aa6b2', marginBottom: 8 },
  card: { backgroundColor: '#0e1522', borderColor: '#223043', borderWidth: 1, borderRadius: 12, padding: 12 },
  input: { backgroundColor: '#0b1320', color: '#e6edf3', borderColor: '#223043', borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  button: { paddingVertical: 10, borderRadius: 10, alignItems: 'center', marginTop: 12 },
  primary: { backgroundColor: '#5a8efc' },
  logout: { backgroundColor: 'transparent', borderColor: '#5a8efc', borderWidth: 1 },
  buttonText: { color: '#0b0f14', fontWeight: '700' },
  logoutText: { color: '#5a8efc', fontWeight: '700' },
  requestCard: { backgroundColor: '#0e1522', borderColor: '#223043', borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 16, gap: 12 },
  pendingLoading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  subSection: { color: '#9aa6b2', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6 },
  requestRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  requestInfo: { flex: 1, gap: 2 },
  requestName: { color: '#e6edf3', fontSize: 16, fontWeight: '600' },
  requestUsername: { color: '#7ca6ff', fontSize: 12 },
  requestHint: { color: '#55657a', fontSize: 12 },
  requestActions: { flexDirection: 'row', gap: 8 },
  requestButton: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  requestButtonPrimary: { backgroundColor: '#5a8efc' },
  requestButtonSecondary: { borderWidth: 1, borderColor: '#223043', backgroundColor: '#0b1320' },
  requestButtonDisabled: { opacity: 0.6 },
  requestButtonTextPrimary: { color: '#0b0f14', fontWeight: '600' },
  requestButtonTextSecondary: { color: '#7ca6ff', fontWeight: '600' },
  muted: { color: '#9aa6b2' },
  error: { color: '#ff9aa3', marginBottom: 6 },
  success: { color: '#a5e3bf', marginBottom: 6 },
  username: { fontFamily: 'monospace', color: '#e6edf3' },
})

const rowStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  label: { width: 92, color: '#9aa6b2' },
})

