import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, Switch, StyleSheet, ScrollView, ActivityIndicator } from 'react-native'
import Constants from 'expo-constants'
import * as WebBrowser from 'expo-web-browser'
import { makeRedirectUri } from 'expo-auth-session'
import FooterNav from '../components/FooterNav'
import { AuthContext } from '../App'
import { apiRequest, clearToken } from '../services/api'
import useAuthDebug from '../hooks/useAuthDebug'


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
  const [steamStatus, setSteamStatus] = useState(null)
  const [steamLoading, setSteamLoading] = useState(true)
  const [steamMessage, setSteamMessage] = useState('')
  const [steamError, setSteamError] = useState('')
  const [steamBusy, setSteamBusy] = useState(false)

  const extraConfig = useMemo(() => getExtraConfig(), [])
  const scheme = useMemo(() => extraConfig?.auth0?.scheme || Constants?.expoConfig?.scheme || 'shelvesai', [extraConfig])
  const isExpoGo = Constants?.executionEnvironment === 'expo'
  const steamReturnUrl = useMemo(() => {
    const config = { scheme, path: 'steam-link' }
    if (isExpoGo) {
      config.useProxy = true
    }
    return makeRedirectUri(config)
  }, [scheme, isExpoGo])
  const steamClientReturnTo = useMemo(() => `${scheme}://steam-link`, [scheme])

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

  const loadSteamStatus = useCallback(async () => {
    if (!token) {
      setSteamStatus(null)
      setSteamLoading(false)
      return
    }

    setSteamLoading(true)
    setSteamError('')
    try {
      const data = await apiRequest({ apiBase, path: '/api/steam/status', token })
      setSteamStatus(data.steam || null)
    } catch (e) {
      setSteamError(e.message)
      setSteamStatus(null)
    } finally {
      setSteamLoading(false)
    }
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

  useEffect(() => {
    loadSteamStatus()
  }, [loadSteamStatus])

  const incomingRequests = useMemo(() => friendships.filter((f) => f.status === 'pending' && !f.isRequester), [friendships])
  const outgoingRequests = useMemo(() => friendships.filter((f) => f.status === 'pending' && f.isRequester), [friendships])

  const getPeer = useCallback((entry) => {
    if (!entry) return {}
    return entry[entry.isRequester ? 'addressee' : 'requester'] || {}
  }, [])

  const handleRefreshSteam = useCallback(() => {
    setSteamError('')
    setSteamMessage('')
    loadSteamStatus()
  }, [loadSteamStatus])

  const handleLinkSteam = useCallback(async () => {
    if (steamBusy || !token) return
    setSteamBusy(true)
    setSteamError('')
    setSteamMessage('')
    try {
      const requestedReturnUrl = (() => {
        if (!isExpoGo) return steamReturnUrl
        try {
          const url = new URL(steamReturnUrl)
          url.searchParams.set('client_return_to', steamClientReturnTo)
          return url.toString()
        } catch (err) {
          return steamReturnUrl
        }
      })()
      const start = await apiRequest({ apiBase, path: '/api/steam/link/start', method: 'POST', token, body: { returnUrl: requestedReturnUrl } })
      if (!start?.redirectUrl) {
        throw new Error('Steam sign-in is unavailable right now')
      }

      const authReturnTo = start?.requestedReturnTo || start?.returnTo || requestedReturnUrl
      const result = await WebBrowser.openAuthSessionAsync(start.redirectUrl, authReturnTo)
      if (result.type === 'cancel' || result.type === 'dismiss') {
        setSteamMessage('Steam linking was cancelled.')
        return
      }
      if (result.type !== 'success' || !result.url) {
        throw new Error('Steam sign-in did not complete')
      }

      const { params, state } = parseSteamCallbackUrl(result.url)
      const finalState = state || start.state
      if (!finalState) {
        throw new Error('Steam response was missing state')
      }
      if (!params || !Object.keys(params).length) {
        throw new Error('Steam response was missing data')
      }

      await apiRequest({
        apiBase,
        path: '/api/steam/link/complete',
        method: 'POST',
        token,
        body: { state: finalState, params },
      })
      await loadSteamStatus()
      setSteamMessage('Steam account linked!')
    } catch (e) {
      setSteamError(e.message || 'Failed to link Steam')
    } finally {
      setSteamBusy(false)
    }
  }, [steamBusy, token, steamReturnUrl, steamClientReturnTo, isExpoGo, apiBase, loadSteamStatus])

  const handleUnlinkSteam = useCallback(async () => {
    if (steamBusy || !token) return
    setSteamBusy(true)
    setSteamError('')
    setSteamMessage('')
    try {
      await apiRequest({ apiBase, path: '/api/steam/link', method: 'DELETE', token })
      await loadSteamStatus()
      setSteamMessage('Steam account disconnected.')
    } catch (e) {
      setSteamError(e.message || 'Failed to disconnect Steam')
    } finally {
      setSteamBusy(false)
    }
  }, [steamBusy, token, apiBase, loadSteamStatus])

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
      <TouchableOpacity style={styles.fixedLogoutButton} onPress={logout} activeOpacity={0.85}>
        <Text style={styles.fixedLogoutText}>Log out</Text>
      </TouchableOpacity>
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
          <View style={styles.card}>
            <Text style={styles.section}>Steam</Text>
            {steamError ? <Text style={styles.error}>{steamError}</Text> : null}
            {steamMessage ? <Text style={styles.success}>{steamMessage}</Text> : null}
            {steamLoading ? (
              <View style={styles.pendingLoading}>
                <ActivityIndicator color="#5a8efc" size="small" />
                <Text style={styles.muted}>Checking Steam status...</Text>
              </View>
            ) : steamStatus?.steamId ? (
              <>
                <Text style={styles.steamIntro}>Linked as</Text>
                <Text style={styles.steamPersona}>{steamStatus.personaName || 'Steam user'}</Text>
                <Text style={styles.steamMeta}>{steamStatus.profileUrl || `SteamID: ${steamStatus.steamId}`}</Text>
                {steamStatus.totalGames ? (
                  <Text style={styles.steamMeta}>Library size: {steamStatus.totalGames}</Text>
                ) : null}
                {steamStatus.lastImportedAt ? (
                  <Text style={styles.steamMeta}>Last import: {formatTimestamp(steamStatus.lastImportedAt)}</Text>
                ) : null}
                <TouchableOpacity
                  style={[styles.button, styles.logout, steamBusy && styles.buttonDisabled]}
                  onPress={handleUnlinkSteam}
                  disabled={steamBusy}
                >
                  {steamBusy ? (
                    <ActivityIndicator color="#5a8efc" size="small" />
                  ) : (
                    <Text style={styles.logoutText}>Disconnect Steam</Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.button, styles.logout]}
                  onPress={handleRefreshSteam}
                  disabled={steamBusy}
                >
                  {steamBusy ? (
                    <ActivityIndicator color="#5a8efc" size="small" />
                  ) : (
                    <Text style={styles.logoutText}>Refresh status</Text>
                  )}
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={styles.steamIntro}>Connect your Steam account to pull your library into a shelf when you're ready.</Text>
                <TouchableOpacity
                  style={[styles.button, styles.primary, steamBusy && styles.buttonDisabled]}
                  onPress={handleLinkSteam}
                  disabled={steamBusy}
                >
                  {steamBusy ? (
                    <ActivityIndicator color="#0b0f14" size="small" />
                  ) : (
                    <Text style={styles.buttonText}>Link Steam</Text>
                  )}
                </TouchableOpacity>
                <Text style={styles.steamHint}>We'll open Steam in your browser for a secure sign-in. You can unlink at any time.</Text>
              </>
            )}
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

function getExtraConfig() {
  const fromExpoConfig = Constants?.expoConfig?.extra
  if (fromExpoConfig) return fromExpoConfig
  const fromManifest = Constants?.manifest?.extra
  if (fromManifest) return fromManifest
  const fromManifest2 = Constants?.manifest2?.extra
  if (fromManifest2) return fromManifest2
  return {}
}

function parseSteamCallbackUrl(urlString) {
  if (!urlString) return { params: {}, state: '' }
  try {
    const parsed = new URL(urlString)
    const segments = []
    if (parsed.search && parsed.search.length > 1) {
      segments.push(parsed.search.slice(1))
    }
    if (parsed.hash && parsed.hash.length > 1) {
      const hash = parsed.hash.slice(1)
      const idx = hash.indexOf('?')
      const resolved = idx >= 0 ? hash.slice(idx + 1) : hash
      if (resolved) segments.push(resolved)
    }
    const params = {}
    let stateValue = ''
    segments.forEach((segment) => {
      const qs = new URLSearchParams(segment)
      qs.forEach((value, key) => {
        appendParam(params, key, value)
        if (key === 'state' && !stateValue) {
          stateValue = value
        }
      })
    })
    return { params, state: stateValue }
  } catch (err) {
    return { params: {}, state: '' }
  }
}

function appendParam(target, key, value) {
  if (Object.prototype.hasOwnProperty.call(target, key)) {
    const existing = target[key]
    if (Array.isArray(existing)) {
      target[key] = [...existing, value]
    } else {
      target[key] = [existing, value]
    }
  } else {
    target[key] = value
  }
}

function formatTimestamp(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  const yyyy = date.getFullYear()
  const mm = pad(date.getMonth() + 1)
  const dd = pad(date.getDate())
  const hh = pad(date.getHours())
  const min = pad(date.getMinutes())
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`
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
  fixedLogoutButton: { position: 'absolute', top: 16, right: 16, backgroundColor: '#162235', borderColor: '#223043', borderWidth: 1, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, zIndex: 50 },
  fixedLogoutText: { color: '#e6edf3', fontWeight: '600' },
  steamIntro: { color: '#9aa6b2', marginTop: 4, marginBottom: 6 },
  steamPersona: { color: '#e6edf3', fontSize: 16, fontWeight: '700' },
  steamMeta: { color: '#55657a', fontSize: 12, marginTop: 2 },
  steamHint: { color: '#55657a', fontSize: 12, marginTop: 12 },
  buttonDisabled: { opacity: 0.6 },
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



