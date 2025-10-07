import React, { createContext, useCallback, useEffect, useMemo, useState } from 'react'
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { Appearance, Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as WebBrowser from 'expo-web-browser'
import Constants from 'expo-constants'
import LoginScreen from './screens/LoginScreen'
import PlasmicHomeScreen from './screens/PlasmicHomeScreen'
import SocialFeedScreen from './screens/SocialFeedScreen'
import FeedDetailScreen from './screens/FeedDetailScreen'
import ShelvesScreen from './screens/ShelvesScreen'
import ShelfDetailScreen from './screens/ShelfDetailScreen'
import ShelfCreateScreen from './screens/ShelfCreateScreen'
import ShelfEditScreen from './screens/ShelfEditScreen'
import FriendSearchScreen from './screens/FriendSearchScreen'
import UsernameSetupScreen from './screens/UsernameSetupScreen'
import CollectableDetailScreen from './screens/CollectableDetailScreen'
import AccountScreen from './screens/AccountScreen'
import ManualEditScreen from './screens/ManualEditScreen'
import { getPlasmicDefaults } from './plasmic/plasmic-init'

WebBrowser.maybeCompleteAuthSession()

export const AuthContext = createContext({
  token: '',
  setToken: () => {},
  apiBase: '',
  auth0: null,
  needsOnboarding: false,
  setNeedsOnboarding: () => {},
  plasmicOptIn: false,
  setPlasmicOptIn: () => {},
  plasmicConfig: { component: 'CollectorMobileAppLayout', pagePath: '', host: '', webViewUrl: '' },
})

const Stack = createNativeStackNavigator()

const TOKEN_STORAGE_KEY = 'token'
const PLASMIC_OPT_IN_KEY = 'plasmic_opt_in'

function getExtraConfig() {
  const fromExpoConfig = Constants?.expoConfig?.extra
  if (fromExpoConfig) return fromExpoConfig
  const fromManifest = Constants?.manifest?.extra
  if (fromManifest) return fromManifest
  const fromManifest2 = Constants?.manifest2?.extra
  if (fromManifest2) return fromManifest2
  return {}
}

function guessApiBase() {
  const extra = getExtraConfig()
  const extraBase = extra?.API_BASE
  if (extraBase && extraBase !== 'http://localhost:5001') return extraBase
  const hostUri = Constants?.expoConfig?.hostUri || ''
  const host = hostUri.split(':')[0]
  if (host) return `http://${host}:5001`
  if (Platform.OS === 'android') return 'http://10.0.2.2:5001' // Android emulator
  return 'http://localhost:5001'
}

export default function App() {
  const colorScheme = Appearance.getColorScheme()
  const [token, setToken] = useState('')
  const [ready, setReady] = useState(false)
  const [needsOnboarding, setNeedsOnboarding] = useState(false)
  const [plasmicOptIn, setPlasmicOptInState] = useState(false)
  const apiBase = useMemo(() => guessApiBase(), [])
  const extra = useMemo(() => getExtraConfig(), [])
  const plasmicConfig = useMemo(() => getPlasmicDefaults(), [])
  const scheme = useMemo(() => extra?.auth0?.scheme || Constants?.expoConfig?.scheme || 'shelvesai', [extra])
  const auth0 = useMemo(() => {
    const conf = extra?.auth0 || {}
    const rawDomain = `${conf.domain || ''}`.trim()
    const clientId = `${conf.clientId || ''}`.trim()
    if (!rawDomain || !clientId) return null
    const normalizedDomain = rawDomain.startsWith('http')
      ? rawDomain.replace(/^https?:\/\//, '').replace(/\/+$/, '')
      : rawDomain.replace(/\/+$/, '')
    return {
      domain: normalizedDomain,
      clientId,
      audience: conf.audience || '',
      scheme,
      useProxy: conf.useProxy ?? true,
    }
  }, [extra, scheme])

  useEffect(() => {
    (async () => {
      try {
        const [storedToken, storedOptIn] = await Promise.all([
          AsyncStorage.getItem(TOKEN_STORAGE_KEY),
          AsyncStorage.getItem(PLASMIC_OPT_IN_KEY),
        ])
        if (storedToken) {
          setToken(storedToken)
        }
        if (storedOptIn !== null) {
          setPlasmicOptInState(storedOptIn === 'true')
        }
      } finally {
        setReady(true)
      }
    })()
  }, [])
  useEffect(() => {
    if (!token) {
      setNeedsOnboarding(false)
      return
    }

    let cancelled = false

    const checkProfile = async () => {
      try {
        const res = await fetch(`${apiBase}/api/account`, {
          headers: {
            Authorization: `Bearer ${token}`
          }
        })
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled) {
          const missing = !data?.user?.username
          setNeedsOnboarding(missing)
        }
      } catch (err) {
        // ignore errors and keep existing onboarding state
      }
    }

    checkProfile()

    return () => {
      cancelled = true
    }
  }, [apiBase, token])

  const setPlasmicOptIn = useCallback((value) => {
    setPlasmicOptInState(value)
    AsyncStorage.setItem(PLASMIC_OPT_IN_KEY, value ? 'true' : 'false').catch((err) => {
      console.warn('Failed to persist Plasmic opt-in flag', err)
    })
  }, [])

  const authValue = useMemo(() => ({
    token,
    setToken,
    apiBase,
    auth0,
    needsOnboarding,
    setNeedsOnboarding,
    plasmicOptIn,
    setPlasmicOptIn,
    plasmicConfig,
  }), [token, apiBase, auth0, needsOnboarding, plasmicOptIn, setPlasmicOptIn, plasmicConfig])

  if (!ready) return null

  return (
    <AuthContext.Provider value={authValue}>
      <NavigationContainer theme={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <Stack.Navigator>
          {!token ? (
            <>
              <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
            </>
          ) : needsOnboarding ? (
            <>
              <Stack.Screen name="UsernameSetup" component={UsernameSetupScreen} options={{ title: 'Choose Username' }} />
              <Stack.Screen name="Account" component={AccountScreen} options={{ title: 'Complete Profile' }} />
            </>
          ) : (
            <>
              {plasmicOptIn ? (
                <>
                  <Stack.Screen name="PlasmicApp" component={PlasmicHomeScreen} options={{ headerShown: false }} />
                  <Stack.Screen name="Feed" component={SocialFeedScreen} options={{ title: 'Feed' }} />
                </>
              ) : (
                <Stack.Screen name="Feed" component={SocialFeedScreen} options={{ title: 'Feed' }} />
              )}
              <Stack.Screen name="FeedDetail" component={FeedDetailScreen} options={({ route }) => ({ title: route.params?.title || 'Feed Details' })} />
              <Stack.Screen name="FriendSearch" component={FriendSearchScreen} options={{ title: 'Find Friends' }} />
              <Stack.Screen name="Shelves" component={ShelvesScreen} options={{ title: 'Shelves' }} />
              <Stack.Screen name="ShelfCreate" component={ShelfCreateScreen} options={{ title: 'New Shelf' }} />
              <Stack.Screen name="ShelfCreateScreen" component={ShelfCreateScreen} options={{ title: 'New Shelf' }} />
              <Stack.Screen name="ShelfDetail" component={ShelfDetailScreen} options={({ route }) => ({ title: route.params?.title || 'Shelf' })} />
              <Stack.Screen name="ShelfEdit" component={ShelfEditScreen} options={({ route }) => ({ title: route.params?.initialName ? `Edit ${route.params.initialName}` : 'Edit Shelf' })} />
              <Stack.Screen name="CollectableDetail" component={CollectableDetailScreen} options={({ route }) => ({ title: route.params?.title || 'Collectable' })} />
              <Stack.Screen name="Account" component={AccountScreen} options={{ title: 'Account' }} />
              <Stack.Screen name="ManualEdit" component={ManualEditScreen} options={{ title: 'Edit Metadat' }} />
            </>
          )}
        </Stack.Navigator>
      </NavigationContainer>
    </AuthContext.Provider>
  )
}

