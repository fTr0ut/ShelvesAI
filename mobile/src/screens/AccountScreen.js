import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
  Alert,
} from 'react-native';
import Constants from 'expo-constants';
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';
import { Ionicons } from '@expo/vector-icons';
import { AuthContext } from '../context/AuthContext';
import { apiRequest, clearToken } from '../services/api';
import useAuthDebug from '../hooks/useAuthDebug';
import { colors, spacing, typography } from '../theme';

import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Card from '../components/ui/Card';
import Badge from '../components/ui/Badge';

// --- Helpers ---
function getExtraConfig() {
  const fromExpoConfig = Constants?.expoConfig?.extra;
  if (fromExpoConfig) return fromExpoConfig;
  const fromManifest = Constants?.manifest?.extra;
  if (fromManifest) return fromManifest;
  const fromManifest2 = Constants?.manifest2?.extra;
  if (fromManifest2) return fromManifest2;
  return {};
}

function parseSteamCallbackUrl(urlString) {
  if (!urlString) return { params: {}, state: '' };
  try {
    const parsed = new URL(urlString);
    const segments = [];
    if (parsed.search && parsed.search.length > 1) {
      segments.push(parsed.search.slice(1));
    }
    if (parsed.hash && parsed.hash.length > 1) {
      const hash = parsed.hash.slice(1);
      const idx = hash.indexOf('?');
      const resolved = idx >= 0 ? hash.slice(idx + 1) : hash;
      if (resolved) segments.push(resolved);
    }
    const params = {};
    let stateValue = '';
    segments.forEach((segment) => {
      const qs = new URLSearchParams(segment);
      qs.forEach((value, key) => {
        appendParam(params, key, value);
        if (key === 'state' && !stateValue) {
          stateValue = value;
        }
      });
    });
    return { params, state: stateValue };
  } catch (err) {
    return { params: {}, state: '' };
  }
}

function appendParam(target, key, value) {
  if (Object.prototype.hasOwnProperty.call(target, key)) {
    const existing = target[key];
    if (Array.isArray(existing)) {
      target[key] = [...existing, value];
    } else {
      target[key] = [existing, value];
    }
  } else {
    target[key] = value;
  }
}

function formatTimestamp(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// --- Components ---

function InfoRow({ label, value, children }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      {children ? (
        <View style={styles.infoContent}>{children}</View>
      ) : (
        <Text style={styles.infoValue}>{value || '—'}</Text>
      )}
    </View>
  );
}

export default function AccountScreen({ navigation }) {
  const { token, setToken, apiBase, setNeedsOnboarding } = useContext(AuthContext);
  const [friendships, setFriendships] = useState([]);
  const [friendsLoading, setFriendsLoading] = useState(true);
  const [friendError, setFriendError] = useState('');
  const [friendMessage, setFriendMessage] = useState('');
  const [friendBusy, setFriendBusy] = useState({});
  const [user, setUser] = useState(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const { clearAuthCache } = useAuthDebug();

  // Steam state
  const [steamStatus, setSteamStatus] = useState(null);
  const [steamLoading, setSteamLoading] = useState(true);
  const [steamMessage, setSteamMessage] = useState('');
  const [steamError, setSteamError] = useState('');
  const [steamBusy, setSteamBusy] = useState(false);

  const extraConfig = useMemo(() => getExtraConfig(), []);
  const scheme = useMemo(() => extraConfig?.auth0?.scheme || Constants?.expoConfig?.scheme || 'shelvesai', [extraConfig]);
  const isExpoGo = Constants?.executionEnvironment === 'expo';

  const steamReturnUrl = useMemo(() => {
    const config = { scheme, path: 'steam-link' };
    if (isExpoGo) {
      config.useProxy = true;
    }
    return makeRedirectUri(config);
  }, [scheme, isExpoGo]);

  const steamClientReturnTo = useMemo(() => `${scheme}://steam-link`, [scheme]);

  // Load User
  useEffect(() => {
    (async () => {
      try {
        const data = await apiRequest({ apiBase, path: '/api/account', token });
        setUser(data.user);
      } catch (e) {
        setErr(e.message);
      }
    })();
  }, [apiBase, token]);

  const loadSteamStatus = useCallback(async () => {
    if (!token) {
      setSteamStatus(null);
      setSteamLoading(false);
      return;
    }

    setSteamLoading(true);
    setSteamError('');
    try {
      const data = await apiRequest({ apiBase, path: '/api/steam/status', token });
      setSteamStatus(data.steam || null);
    } catch (e) {
      setSteamError(e.message);
      setSteamStatus(null);
    } finally {
      setSteamLoading(false);
    }
  }, [apiBase, token]);

  const loadFriendships = useCallback(async () => {
    if (!token) {
      setFriendships([]);
      setFriendsLoading(false);
      return;
    }

    setFriendsLoading(true);
    setFriendError('');
    setFriendMessage('');
    try {
      const data = await apiRequest({ apiBase, path: '/api/friends', token });
      setFriendships(Array.isArray(data.friendships) ? data.friendships : []);
    } catch (e) {
      setFriendError(e.message);
      setFriendships([]);
    } finally {
      setFriendsLoading(false);
      setFriendBusy({});
    }
  }, [apiBase, token]);

  useEffect(() => {
    loadFriendships();
  }, [loadFriendships]);

  useEffect(() => {
    loadSteamStatus();
  }, [loadSteamStatus]);

  const incomingRequests = useMemo(() => friendships.filter((f) => f.status === 'pending' && !f.isRequester), [friendships]);
  const outgoingRequests = useMemo(() => friendships.filter((f) => f.status === 'pending' && f.isRequester), [friendships]);

  const getPeer = useCallback((entry) => {
    if (!entry) return {};
    return entry[entry.isRequester ? 'addressee' : 'requester'] || {};
  }, []);

  const handleRefreshSteam = useCallback(() => {
    setSteamError('');
    setSteamMessage('');
    loadSteamStatus();
  }, [loadSteamStatus]);

  const handleLinkSteam = useCallback(async () => {
    if (steamBusy || !token) return;
    setSteamBusy(true);
    setSteamError('');
    setSteamMessage('');
    try {
      const requestedReturnUrl = (() => {
        if (!isExpoGo) return steamReturnUrl;
        try {
          const url = new URL(steamReturnUrl);
          url.searchParams.set('client_return_to', steamClientReturnTo);
          return url.toString();
        } catch (err) {
          return steamReturnUrl;
        }
      })();

      const start = await apiRequest({ apiBase, path: '/api/steam/link/start', method: 'POST', token, body: { returnUrl: requestedReturnUrl } });
      if (!start?.redirectUrl) {
        throw new Error('Steam sign-in is unavailable right now');
      }

      const authReturnTo = start?.requestedReturnTo || start?.returnTo || requestedReturnUrl;
      const result = await WebBrowser.openAuthSessionAsync(start.redirectUrl, authReturnTo);

      if (result.type === 'cancel' || result.type === 'dismiss') {
        setSteamMessage('Steam linking was cancelled.');
        return;
      }
      if (result.type !== 'success' || !result.url) {
        throw new Error('Steam sign-in did not complete');
      }

      const { params, state } = parseSteamCallbackUrl(result.url);
      const finalState = state || start.state;
      if (!finalState) throw new Error('Steam response was missing state');
      if (!params || !Object.keys(params).length) throw new Error('Steam response was missing data');

      await apiRequest({
        apiBase,
        path: '/api/steam/link/complete',
        method: 'POST',
        token,
        body: { state: finalState, params },
      });
      await loadSteamStatus();
      setSteamMessage('Steam account linked!');
    } catch (e) {
      setSteamError(e.message || 'Failed to link Steam');
    } finally {
      setSteamBusy(false);
    }
  }, [steamBusy, token, steamReturnUrl, steamClientReturnTo, isExpoGo, apiBase, loadSteamStatus]);

  const handleUnlinkSteam = useCallback(async () => {
    if (steamBusy || !token) return;
    setSteamBusy(true);
    setSteamError('');
    setSteamMessage('');
    try {
      await apiRequest({ apiBase, path: '/api/steam/link', method: 'DELETE', token });
      await loadSteamStatus();
      setSteamMessage('Steam account disconnected.');
    } catch (e) {
      setSteamError(e.message || 'Failed to disconnect Steam');
    } finally {
      setSteamBusy(false);
    }
  }, [steamBusy, token, apiBase, loadSteamStatus]);

  const logout = useCallback(async () => {
    Alert.alert('Log Out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log Out',
        style: 'destructive',
        onPress: async () => {
          try {
            setMsg('');
            setErr('');
            await clearToken();
            setNeedsOnboarding(false);
            setToken('');
          } catch (e) {
            setErr(e.message || 'Failed to log out');
          }
        }
      }
    ]);
  }, [setToken, setErr, setMsg, setNeedsOnboarding]);

  const handleFriendRespond = useCallback(async (friendshipId, action) => {
    if (!friendshipId || !action) return;
    setFriendBusy((prev) => ({ ...prev, [friendshipId]: true }));
    setFriendMessage('');
    try {
      await apiRequest({
        apiBase,
        path: '/api/friends/respond',
        method: 'POST',
        token,
        body: { friendshipId, action },
      });
      if (action === 'accept') setFriendMessage('Friend request accepted.');
      else if (action === 'reject') setFriendMessage('Friend request dismissed.');
      else if (action === 'cancel') setFriendMessage('Friend request cancelled.');
      await loadFriendships();
    } catch (e) {
      setFriendError(e.message);
    } finally {
      setFriendBusy((prev) => ({ ...prev, [friendshipId]: false }));
    }
  }, [apiBase, token, loadFriendships]);

  const update = async () => {
    try {
      setMsg('');
      setErr('');
      const data = await apiRequest({ apiBase, path: '/api/account', method: 'PUT', token, body: user });
      setUser(data.user);
      Alert.alert('Success', 'Profile updated successfully.');
    } catch (e) {
      setErr(e.message);
    }
  };

  if (!user) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.headerTitle}>Account</Text>

      {/* Messages */}
      {!!msg && <View style={[styles.messageBox, styles.successBox]}><Text style={styles.successText}>{msg}</Text></View>}
      {!!err && <View style={[styles.messageBox, styles.errorBox]}><Text style={styles.errorText}>{err}</Text></View>}

      {/* Profile Section */}
      <Card style={styles.card}>
        <View style={styles.cardHeader}>
          <Ionicons name="person-circle-outline" size={24} color={colors.primary} />
          <Text style={styles.cardTitle}>Profile Settings</Text>
        </View>

        <View style={styles.formGroup}>
          <Input
            label="Username"
            value={user.username || ''}
            editable={false}
            containerStyle={{ opacity: 0.7 }}
          />
          <View style={styles.row}>
            <Input
              label="First Name"
              value={user.firstName || ''}
              onChangeText={(v) => setUser({ ...user, firstName: v })}
              containerStyle={{ flex: 1 }}
            />
            <Input
              label="Last Name"
              value={user.lastName || ''}
              onChangeText={(v) => setUser({ ...user, lastName: v })}
              containerStyle={{ flex: 1 }}
            />
          </View>
          <Input
            label="Phone"
            value={user.phoneNumber || ''}
            onChangeText={(v) => setUser({ ...user, phoneNumber: v })}
            keyboardType="phone-pad"
          />
          <View style={styles.row}>
            <Input
              label="City"
              value={user.city || ''}
              onChangeText={(v) => setUser({ ...user, city: v })}
              containerStyle={{ flex: 1 }}
            />
            <Input
              label="State"
              value={user.state || ''}
              onChangeText={(v) => setUser({ ...user, state: v })}
              containerStyle={{ flex: 1 }}
            />
          </View>
          <Input
            label="Country"
            value={user.country || ''}
            onChangeText={(v) => setUser({ ...user, country: v })}
          />

          <View style={styles.switchRow}>
            <Text style={styles.label}>Private Account</Text>
            <Switch
              value={!!user.isPrivate}
              onValueChange={(v) => setUser({ ...user, isPrivate: v })}
              trackColor={{ false: colors.manualInputBg, true: colors.primary }}
              thumbColor={colors.textPrimary}
            />
          </View>

          <Button title="Save Changes" onPress={update} variant="primary" />
        </View>
      </Card>

      {/* Steam Section */}
      <Card style={styles.card}>
        <View style={styles.cardHeader}>
          <Ionicons name="logo-steam" size={24} color={colors.textPrimary} />
          <Text style={styles.cardTitle}>Steam Integration</Text>
        </View>

        {steamError ? <Text style={styles.fieldError}>{steamError}</Text> : null}
        {steamMessage ? <Text style={styles.fieldSuccess}>{steamMessage}</Text> : null}

        {steamLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginVertical: 20 }} />
        ) : steamStatus?.steamId ? (
          <View style={styles.steamContainer}>
            <InfoRow label="Linked Account" value={steamStatus.personaName || 'Steam User'} />
            <InfoRow label="Library Size" value={steamStatus.totalGames ? `${steamStatus.totalGames} Games` : 'Unknown'} />
            <InfoRow label="Last Import" value={formatTimestamp(steamStatus.lastImportedAt)} />

            <View style={styles.buttonRow}>
              <Button
                title="Refresh"
                variant="secondary"
                size="sm"
                onPress={handleRefreshSteam}
                disabled={steamBusy}
                style={{ flex: 1 }}
              />
              <Button
                title="Disconnect"
                variant="ghost"
                size="sm"
                onPress={handleUnlinkSteam}
                disabled={steamBusy}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        ) : (
          <View style={styles.steamContainer}>
            <Text style={styles.helperText}>
              Link your Steam account to automatically import your game library into ShelvesAI.
            </Text>
            <Button
              title="Connect Steam"
              onPress={handleLinkSteam}
              loading={steamBusy}
              variant="outline"
              icon="logo-steam"
            />
          </View>
        )}
      </Card>

      {/* Friend Requests Section */}
      {(incomingRequests.length > 0 || outgoingRequests.length > 0) && (
        <Card style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="people" size={24} color={colors.textPrimary} />
            <Text style={styles.cardTitle}>Friend Requests</Text>
          </View>

          {friendError ? <Text style={styles.fieldError}>{friendError}</Text> : null}
          {friendMessage ? <Text style={styles.fieldSuccess}>{friendMessage}</Text> : null}

          {friendsLoading && <ActivityIndicator color={colors.primary} />}

          {incomingRequests.length > 0 && (
            <View style={styles.requestGroup}>
              <Text style={styles.groupLabel}>Received</Text>
              {incomingRequests.map(req => {
                const peer = getPeer(req);
                const busy = friendBusy[req.id];
                return (
                  <View key={req.id} style={styles.friendRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.friendName}>{peer.name || peer.username}</Text>
                      <Text style={styles.friendSub}>{peer.username ? `@${peer.username}` : ''}</Text>
                    </View>
                    <View style={styles.actionRow}>
                      <Button title="Accept" size="sm" onPress={() => handleFriendRespond(req.id, 'accept')} loading={busy} />
                      <Button title="Ignore" size="sm" variant="ghost" onPress={() => handleFriendRespond(req.id, 'reject')} disabled={busy} />
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {outgoingRequests.length > 0 && (
            <View style={styles.requestGroup}>
              <Text style={styles.groupLabel}>Sent</Text>
              {outgoingRequests.map(req => {
                const peer = getPeer(req);
                const busy = friendBusy[req.id];
                return (
                  <View key={req.id} style={styles.friendRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.friendName}>{peer.name || peer.username}</Text>
                      <Text style={styles.friendSub}>Pending...</Text>
                    </View>
                    <Button title="Cancel" size="sm" variant="ghost" onPress={() => handleFriendRespond(req.id, 'cancel')} loading={busy} />
                  </View>
                );
              })}
            </View>
          )}
        </Card>
      )}

      <Button
        title="Log Out"
        variant="danger"
        onPress={logout}
        style={styles.logoutButton}
        icon="log-out-outline"
      />

      <Text style={styles.versionText}>ShelvesAI Mobile v1.0.0</Text>

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.md,
    paddingBottom: 40,
    gap: spacing.md,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  headerTitle: {
    fontSize: 28,
    fontFamily: typography.bold,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  card: {
    padding: spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: spacing.sm,
  },
  cardTitle: {
    fontSize: 18,
    fontFamily: typography.bold,
    color: colors.textPrimary,
  },
  formGroup: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: spacing.sm,
  },
  label: {
    fontFamily: typography.medium,
    color: colors.textSecondary,
    fontSize: 14,
  },
  steamContainer: {
    gap: spacing.md,
  },
  helperText: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: spacing.sm,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  infoLabel: {
    color: colors.textSecondary,
  },
  infoValue: {
    color: colors.textPrimary,
    fontFamily: typography.medium,
  },
  infoContent: {
    flex: 1,
    alignItems: 'flex-end',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  requestGroup: {
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  groupLabel: {
    fontSize: 12,
    textTransform: 'uppercase',
    color: colors.textTertiary,
    fontFamily: typography.bold,
    letterSpacing: 1,
  },
  friendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surfaceHighlight,
    padding: spacing.sm,
    borderRadius: 8,
  },
  friendName: {
    color: colors.textPrimary,
    fontFamily: typography.medium,
  },
  friendSub: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  logoutButton: {
    marginTop: spacing.lg,
  },
  versionText: {
    textAlign: 'center',
    color: colors.textTertiary,
    fontSize: 12,
    marginTop: spacing.md,
  },
  messageBox: {
    padding: spacing.sm,
    borderRadius: 8,
    marginBottom: spacing.sm,
  },
  successBox: {
    backgroundColor: 'rgba(52, 199, 89, 0.1)',
  },
  errorBox: {
    backgroundColor: 'rgba(255, 69, 58, 0.1)',
  },
  successText: {
    color: colors.success,
    textAlign: 'center',
  },
  errorText: {
    color: colors.danger,
    textAlign: 'center',
  },
  fieldError: {
    color: colors.danger,
    fontSize: 12,
    marginBottom: 8,
  },
  fieldSuccess: {
    color: colors.success,
    fontSize: 12,
    marginBottom: 8,
  }
});
