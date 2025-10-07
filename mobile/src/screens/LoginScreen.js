import React, { useContext, useEffect, useMemo, useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, StatusBar, Switch } from 'react-native'
import { makeRedirectUri, ResponseType, useAuthRequest } from 'expo-auth-session'
import { AuthContext } from '../App'
import { apiRequest, saveToken, exchangeAuth0Token } from '../services/api'

function Auth0LoginButton({ config, loading, onAccessToken, onError }) {
  const redirectUri = useMemo(() => makeRedirectUri({ scheme: config.scheme || 'shelvesai' }), [config.scheme])
  const discovery = useMemo(() => {
    const base = config.domain.startsWith('http') ? config.domain : `https://${config.domain}`
    return {
      authorizationEndpoint: `${base}/authorize`,
      tokenEndpoint: `${base}/oauth/token`,
      revocationEndpoint: `${base}/oauth/revoke`,
    }
  }, [config.domain])
  const extraParams = useMemo(() => (config.audience ? { audience: config.audience } : undefined), [config.audience])

  const [request, response, promptAsync] = useAuthRequest(
    {
      clientId: config.clientId,
      responseType: ResponseType.Token,
      redirectUri,
      scopes: ['openid', 'profile', 'email'],
      extraParams,
    },
    discovery
  )
  console.log('Auth redirectUri:', redirectUri)
  useEffect(() => {
    if (response?.type === 'success') {
      const accessToken = response.authentication?.accessToken || response.params?.access_token
      if (!accessToken) {
        onError?.('Auth0 returned no access token')
        return
      }
      onAccessToken?.(accessToken)
    } else if (response?.type === 'error') {
      onError?.(response.error?.message || 'Auth0 sign-in failed')
    }
  }, [response, onAccessToken, onError])

  return (
    <TouchableOpacity
      style={[styles.button, styles.auth0Button, (loading || !request) && styles.disabledButton]}
      onPress={() => promptAsync({ useProxy: config.useProxy })}
      disabled={loading || !request}
    >
      <Text style={styles.auth0Text}>{loading ? 'Connecting...' : 'Continue with Auth0'}</Text>
    </TouchableOpacity>
  )
}

export default function LoginScreen() {
  const { setToken, apiBase, auth0, setNeedsOnboarding, plasmicOptIn, setPlasmicOptIn } = useContext(AuthContext)
  const [mode, setMode] = useState('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [authLoading, setAuthLoading] = useState(false)

  const submit = async () => {
    try {
      setMessage('')
      if (mode === 'login') {
        const data = await apiRequest({ apiBase, path: '/api/login', method: 'POST', body: { username, password } })
        await saveToken(data.token)
        setNeedsOnboarding(false)
        setToken(data.token)
      } else {
        await apiRequest({ apiBase, path: '/api/register', method: 'POST', body: { username, password } })
        setMessage('Registration successful. You can now log in.')
        setMode('login')
      }
    } catch (e) {
      setMessage(e.message)
    }
  }

  const handleAuth0Token = async (accessToken) => {
    try {
      setAuthLoading(true)
      setMessage('Signing in with Auth0...')
      const data = await exchangeAuth0Token({ apiBase, accessToken })
      await saveToken(data.token)
      setToken(data.token)
      setNeedsOnboarding(!!data.needsUsername)
      if (data.needsUsername) {
      setMessage('Welcome! Choose a username to finish setup.')
      } else {
      setMessage('Logged in with Auth0.')
      }
    } catch (e) {
      setMessage(e.message)
    } finally {
      setAuthLoading(false)
    }
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <Text style={styles.title}>Shelves.AI</Text>
      <Text style={styles.subtitle}>Share your collections</Text>
      <View style={styles.switchRow}>
        <TouchableOpacity onPress={() => setMode('login')} style={[styles.switchBtn, mode === 'login' && styles.switchActive]}>
          <Text style={styles.switchText}>Login</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setMode('register')} style={[styles.switchBtn, mode === 'register' && styles.switchActive]}>
          <Text style={styles.switchText}>Register</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.card}>
        <TextInput placeholder="Username" placeholderTextColor="#9aa6b2" value={username} onChangeText={setUsername} style={styles.input} autoCapitalize="none" />
        <TextInput placeholder="Password" placeholderTextColor="#9aa6b2" value={password} onChangeText={setPassword} style={styles.input} secureTextEntry />
        <TouchableOpacity style={[styles.button, styles.primary]} onPress={submit}>
          <Text style={styles.buttonText}>{mode === 'login' ? 'Login' : 'Create Account'}</Text>
        </TouchableOpacity>
        {auth0 && (
          <>
            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or</Text>
              <View style={styles.dividerLine} />
            </View>
            <Auth0LoginButton
              config={auth0}
              loading={authLoading}
              onAccessToken={handleAuth0Token}
              onError={(err) => setMessage(err)}
            />
          </>
        )}
        <View style={styles.optInRow}>
          <View style={styles.optInCopy}>
            <Text style={styles.optInTitle}>Preview the Plasmic experience</Text>
            <Text style={styles.optInSubtitle}>Loads the experimental UI from Plasmic Studio after login.</Text>
          </View>
          <Switch
            value={plasmicOptIn}
            onValueChange={setPlasmicOptIn}
            thumbColor={plasmicOptIn ? '#5a8efc' : '#e6edf3'}
            trackColor={{ false: '#1e2b3d', true: '#5a8efc' }}
            ios_backgroundColor='#1e2b3d'
          />
        </View>
        {!!message && <Text style={styles.message}>{message}</Text>}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0f14', padding: 24, justifyContent: 'center' },
  title: { fontSize: 28, fontWeight: '700', color: '#e6edf3', textAlign: 'center' },
  subtitle: { fontSize: 14, color: '#9aa6b2', textAlign: 'center', marginBottom: 16 },
  switchRow: { flexDirection: 'row', alignSelf: 'center', borderWidth: 1, borderColor: '#223043', borderRadius: 12, overflow: 'hidden', marginBottom: 12 },
  switchBtn: { paddingVertical: 10, paddingHorizontal: 16, backgroundColor: '#0d1726' },
  switchActive: { backgroundColor: '#162235' },
  switchText: { color: '#e6edf3' },
  card: { backgroundColor: '#0e1522', borderColor: '#223043', borderWidth: 1, borderRadius: 14, padding: 16 },
  input: { backgroundColor: '#0b1320', color: '#e6edf3', borderColor: '#223043', borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 10 },
  button: { paddingVertical: 12, borderRadius: 10, alignItems: 'center', marginTop: 4 },
  primary: { backgroundColor: '#5a8efc' },
  buttonText: { color: '#0b0f14', fontWeight: '700' },
  message: { color: '#a5e3bf', marginTop: 10, textAlign: 'center' },
  auth0Button: { backgroundColor: '#ffffff', marginTop: 12 },
  auth0Text: { color: '#0b0f14', fontWeight: '700' },
  disabledButton: { opacity: 0.6 },
  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: 12 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#1e2b3d' },
  dividerText: { color: '#9aa6b2', marginHorizontal: 8 },
  optInRow: {
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: '#0b1320',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#223043',
    flexDirection: 'row',
    alignItems: 'center',
  },
  optInCopy: { flex: 1, marginRight: 12 },
  optInTitle: { color: '#e6edf3', fontWeight: '600', fontSize: 15 },
  optInSubtitle: { color: '#9aa6b2', fontSize: 12, marginTop: 4 },
})
