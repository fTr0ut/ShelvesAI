import React, { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { Appearance, KeyboardAvoidingView, Platform, View } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import Constants from 'expo-constants'
import {
  useFonts,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter'
import * as SplashScreen from 'expo-splash-screen'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import LoginScreen from './screens/LoginScreen'
import ForgotPasswordScreen from './screens/ForgotPasswordScreen'
import ResetPasswordScreen from './screens/ResetPasswordScreen'
import SocialFeedScreen from './screens/SocialFeedScreen'
import FeedDetailScreen from './screens/FeedDetailScreen'
import ShelvesScreen from './screens/ShelvesScreen'
import ShelfDetailScreen from './screens/ShelfDetailScreen'
import ShelfCreateScreen from './screens/ShelfCreateScreen'
import ShelfEditScreen from './screens/ShelfEditScreen'
import ShelfSelectScreen from './screens/ShelfSelectScreen'
import ItemSearchScreen from './screens/ItemSearchScreen'
import FriendSearchScreen from './screens/FriendSearchScreen'
import UsernameSetupScreen from './screens/UsernameSetupScreen'
import OnboardingPagerScreen from './screens/OnboardingPagerScreen'
import OnboardingProfileRequiredScreen from './screens/OnboardingProfileRequiredScreen'
import OnboardingProfileOptionalScreen from './screens/OnboardingProfileOptionalScreen'
import CollectableDetailScreen from './screens/CollectableDetailScreen'
import MarketValueSourcesScreen from './screens/MarketValueSourcesScreen'
import AccountScreen from './screens/AccountScreen'
import ManualEditScreen from './screens/ManualEditScreen'
import AboutScreen from './screens/AboutScreen'
import ProfileScreen from './screens/ProfileScreen'
import ProfileEditScreen from './screens/ProfileEditScreen'
import WishlistsScreen from './screens/WishlistsScreen'
import WishlistScreen from './screens/WishlistScreen'
import WishlistCreateScreen from './screens/WishlistCreateScreen'
import FriendsListScreen from './screens/FriendsListScreen'
import FavoritesScreen from './screens/FavoritesScreen'
import ListCreateScreen from './screens/ListCreateScreen'
import ListDetailScreen from './screens/ListDetailScreen'
import UnmatchedScreen from './screens/UnmatchedScreen'
import NotificationScreen from './screens/NotificationScreen'
import NotificationSettingsScreen from './screens/NotificationSettingsScreen'
import BottomTabNavigator from './navigation/BottomTabNavigator'
import CheckInScreen from './screens/CheckInScreen'
import linkingConfig from './navigation/linkingConfig'
import * as Sentry from '@sentry/react-native'

import { AuthContext } from './context/AuthContext'
import { ThemeProvider, useTheme } from './context/ThemeContext'
import { PushProvider } from './context/PushContext'
import { apiRequest, setAuthErrorHandler, setApiBase, getStoredToken, clearToken, getValidToken } from './services/api'
import { ToastProvider } from './context/ToastContext'
import ToastContainer from './components/Toast'
import { isOnboardingRequiredForUser } from './utils/onboarding'
import { shouldAutoRefreshOnboardingConfig } from './utils/onboardingConfig'

const Stack = createNativeStackNavigator()
const PREMIUM_STORAGE_KEY = 'premiumEnabled'

SplashScreen.preventAutoHideAsync()

function getExtraConfig() {
  const fromExpoConfig = Constants?.expoConfig?.extra
  if (fromExpoConfig) return fromExpoConfig
  const fromManifest = Constants?.manifest?.extra
  if (fromManifest) return fromManifest
  const fromManifest2 = Constants?.manifest2?.extra
  if (fromManifest2) return fromManifest2
  return {}
}

const truthyValues = new Set(['1', 'true', 'yes', 'on'])

function isTruthy(value) {
  return typeof value === 'string' && truthyValues.has(value.toLowerCase())
}

function guessApiBaseCandidate() {
  const envUseNgrok = process.env.EXPO_PUBLIC_USE_NGROK
  const envNgrokUrl = process.env.EXPO_PUBLIC_NGROK_URL
  if (isTruthy(envUseNgrok) && envNgrokUrl) {
    return { base: envNgrokUrl, source: 'env_ngrok' }
  }

  const envApiBase = process.env.EXPO_PUBLIC_API_BASE
  if (envApiBase) {
    return { base: envApiBase, source: 'env_api_base' }
  }

  const extra = getExtraConfig()
  const extraUseNgrok = isTruthy(extra?.USE_NGROK)
  const extraNgrokUrl = extra?.NGROK_URL
  if (extraUseNgrok && extraNgrokUrl) {
    return { base: extraNgrokUrl, source: 'extra_ngrok' }
  }

  const extraBase = extra?.API_BASE
  if (extraBase) {
    return { base: extraBase, source: 'extra_api_base' }
  }

  const hostUri = Constants?.expoConfig?.hostUri || ''
  const host = hostUri.split(':')[0]
  if (host) {
    return { base: `http://${host}:5001`, source: 'host_fallback' }
  }

  if (Platform.OS === 'android') {
    return { base: 'http://10.0.2.2:5001', source: 'android_emulator_fallback' }
  }

  return { base: 'http://localhost:5001', source: 'localhost_fallback' }
}

function enforceSecureApiBase(base, source = 'unknown') {
  const normalized = String(base || '').trim()
  if (!normalized) return normalized
  if (!__DEV__ && /^http:\/\//i.test(normalized)) {
    const err = new Error('Production API base must use HTTPS')
    Sentry.captureException(err, {
      tags: {
        area: 'api_config',
        source,
      },
      extra: {
        resolvedApiBase: normalized,
      },
    })
    throw err
  }
  return normalized
}

function resolveApiBase() {
  const { base, source } = guessApiBaseCandidate()
  return {
    apiBase: enforceSecureApiBase(base, source),
    apiBaseSource: source,
  }
}

export default Sentry.wrap(function App() {
  const navigationRef = useRef(null)
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  })

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync()
    }
  }, [fontsLoaded])

  const colorScheme = Appearance.getColorScheme()
  const [token, setToken] = useState('')
  const [ready, setReady] = useState(false)
  const [needsOnboarding, setNeedsOnboarding] = useState(false)
  const [user, setUser] = useState(null)
  const [premiumEnabled, setPremiumEnabledState] = useState(false)
  const [onboardingConfig, setOnboardingConfig] = useState(null)
  const [onboardingConfigLoading, setOnboardingConfigLoading] = useState(false)
  const [onboardingConfigError, setOnboardingConfigError] = useState(null)
  const [visionQuota, setVisionQuota] = useState(null)
  const { apiBase, apiBaseSource } = useMemo(() => resolveApiBase(), [])
  const extra = useMemo(() => getExtraConfig(), [])
  const onboardingConfigRequestIdRef = useRef(0)
  const onboardingConfigAutoRetryRef = useRef(false)

  // Register apiBase with the api service so getValidToken() can call /api/auth/refresh.
  useEffect(() => {
    setApiBase(apiBase)
  }, [apiBase])

  useEffect(() => {
    Sentry.setTag('api_base_source', apiBaseSource)
    Sentry.setContext('api_config', {
      apiBase,
      source: apiBaseSource,
      useNgrok: process.env.EXPO_PUBLIC_USE_NGROK || extra?.USE_NGROK || '',
    })
  }, [apiBase, apiBaseSource, extra])

  useEffect(() => {
    (async () => {
      try {
        const [storedToken, storedPremium] = await Promise.all([
          getStoredToken(),
          AsyncStorage.getItem(PREMIUM_STORAGE_KEY),
        ])
        const validToken = await getValidToken(storedToken)
        if (validToken) {
          setToken(validToken)
        }
        if (storedPremium !== null) {
          setPremiumEnabledState(storedPremium === 'true')
        }
      } finally {
        setReady(true)
      }
    })()
  }, [])

  useEffect(() => {
    if (!user) {
      Sentry.setUser(null)
      return
    }

    Sentry.setUser({
      id: user?.id ? String(user.id) : undefined,
      username: user?.username,
      email: user?.email,
    })
  }, [user])

  // Set up global auth error handler to log out on invalid token
  useEffect(() => {
    setAuthErrorHandler(() => {
      setToken('')
      setUser(null)
      clearToken()
    })
    return () => setAuthErrorHandler(null)
  }, [])

  const refreshOnboardingConfig = useCallback(async () => {
    const requestId = onboardingConfigRequestIdRef.current + 1
    onboardingConfigRequestIdRef.current = requestId
    setOnboardingConfigLoading(true)
    setOnboardingConfigError(null)

    try {
      const data = await apiRequest({ apiBase, path: '/api/config/onboarding' })
      if (onboardingConfigRequestIdRef.current !== requestId) {
        return null
      }
      setOnboardingConfig(data)
      setOnboardingConfigError(null)
      return data
    } catch (err) {
      Sentry.captureException(err, {
        tags: {
          area: 'app_bootstrap',
          endpoint: '/api/config/onboarding',
        },
      })
      if (onboardingConfigRequestIdRef.current !== requestId) {
        return null
      }
      setOnboardingConfigError(err)
      return null
    } finally {
      if (onboardingConfigRequestIdRef.current === requestId) {
        setOnboardingConfigLoading(false)
      }
    }
  }, [apiBase])

  useEffect(() => {
    refreshOnboardingConfig()
  }, [refreshOnboardingConfig])

  const setPremiumEnabled = useCallback(async (value) => {
    setPremiumEnabledState(value)
    try {
      await AsyncStorage.setItem(PREMIUM_STORAGE_KEY, value ? 'true' : 'false')
    } catch (err) {
      console.warn('Failed to save premium flag', err)
    }
  }, [])
  useEffect(() => {
    if (!token) {
      setNeedsOnboarding(false)
      return
    }

    let cancelled = false

    const checkProfile = async () => {
      try {
        const data = await apiRequest({ apiBase, path: '/api/account', token })
        if (!cancelled) {
          setNeedsOnboarding(isOnboardingRequiredForUser(data?.user))
          setUser(data.user || null)
          if (typeof data?.user?.isPremium === 'boolean') {
            setPremiumEnabled(data.user.isPremium)
          }
          if (data?.visionQuota) {
            setVisionQuota(data.visionQuota)
          }
        }
      } catch (err) {
        Sentry.captureException(err, {
          tags: {
            area: 'app_bootstrap',
            endpoint: '/api/account',
          },
        })
      }
    }

    checkProfile()

    return () => {
      cancelled = true
    }
  }, [apiBase, token, setPremiumEnabled])

  useEffect(() => {
    if (!needsOnboarding || onboardingConfig) {
      onboardingConfigAutoRetryRef.current = false
      return
    }

    if (shouldAutoRefreshOnboardingConfig({
      needsOnboarding,
      onboardingConfig,
      onboardingConfigLoading,
      hasAttemptedAutoRetry: onboardingConfigAutoRetryRef.current,
    })) {
      onboardingConfigAutoRetryRef.current = true
      refreshOnboardingConfig()
    }
  }, [needsOnboarding, onboardingConfig, onboardingConfigLoading, refreshOnboardingConfig])

  const authValue = useMemo(() => ({
    token,
    setToken,
    apiBase,
    user,
    setUser,
    needsOnboarding,
    setNeedsOnboarding,
    premiumEnabled,
    setPremiumEnabled,
    onboardingConfig,
    setOnboardingConfig,
    onboardingConfigLoading,
    onboardingConfigError,
    refreshOnboardingConfig,
    visionQuota,
    setVisionQuota,
  }), [
    token,
    apiBase,
    needsOnboarding,
    user,
    premiumEnabled,
    setPremiumEnabled,
    onboardingConfig,
    onboardingConfigLoading,
    onboardingConfigError,
    refreshOnboardingConfig,
    visionQuota,
  ])

  if (!ready || !fontsLoaded) return null

  const AppShell = Platform.OS === 'android' ? KeyboardAvoidingView : View
  const appShellProps = Platform.OS === 'android' ? { behavior: 'height' } : {}

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <ToastProvider>
          <AuthContext.Provider value={authValue}>
            <PushProvider navigationRef={navigationRef}>
              <AppShell
                style={{ flex: 1 }}
                {...appShellProps}
              >
                <AppNavigator token={token} needsOnboarding={needsOnboarding} navigationRef={navigationRef} />
                <ToastContainer />
              </AppShell>
            </PushProvider>
          </AuthContext.Provider>
        </ToastProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  )
});

// Separate component to use theme context
function AppNavigator({ token, needsOnboarding, navigationRef }) {
  const { colors, isDark, typography } = useTheme()
  const baseTheme = isDark ? DarkTheme : DefaultTheme

  const navTheme = {
    ...baseTheme,
    colors: {
      ...baseTheme.colors,
      primary: colors.primary,
      background: colors.background,
      card: colors.surface,
      text: colors.text,
      border: colors.border,
      notification: colors.primary,
    },
    fonts: {
      regular: { fontFamily: typography.regular, fontWeight: 'normal' },
      medium: { fontFamily: typography.medium, fontWeight: '500' },
      bold: { fontFamily: typography.bold, fontWeight: '600' },
      heavy: { fontFamily: typography.bold, fontWeight: '700' },
    },
  }

  return (
    <NavigationContainer ref={navigationRef} theme={navTheme} linking={linkingConfig}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!token ? (
          <>
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
            <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} />
          </>
        ) : needsOnboarding ? (
          <>
            <Stack.Screen name="OnboardingIntro" component={OnboardingPagerScreen} />
            <Stack.Screen name="UsernameSetup" component={UsernameSetupScreen} />
            <Stack.Screen name="OnboardingProfileRequired" component={OnboardingProfileRequiredScreen} />
            <Stack.Screen name="OnboardingProfileOptional" component={OnboardingProfileOptionalScreen} />
          </>
        ) : (
          <>
            <Stack.Screen name="Main" component={BottomTabNavigator} />
            <Stack.Screen name="FeedDetail" component={FeedDetailScreen} />
            <Stack.Screen name="FriendSearch" component={FriendSearchScreen} />
            <Stack.Screen name="ShelfCreate" component={ShelfCreateScreen} />
            <Stack.Screen name="ShelfCreateScreen" component={ShelfCreateScreen} />
            <Stack.Screen name="ShelfSelect" component={ShelfSelectScreen} />
            <Stack.Screen
              name="CheckIn"
              component={CheckInScreen}
              options={{
                presentation: 'transparentModal',
                animation: 'fade',
                contentStyle: { backgroundColor: 'transparent' },
              }}
            />
            <Stack.Screen name="ShelfDetail" component={ShelfDetailScreen} />
            <Stack.Screen name="ShelfEdit" component={ShelfEditScreen} />
            <Stack.Screen name="ItemSearch" component={ItemSearchScreen} />
            <Stack.Screen name="CollectableDetail" component={CollectableDetailScreen} />
            <Stack.Screen name="MarketValueSources" component={MarketValueSourcesScreen} />
            <Stack.Screen name="Account" component={AccountScreen} />
            <Stack.Screen name="ManualEdit" component={ManualEditScreen} />
            <Stack.Screen name="About" component={AboutScreen} />
            <Stack.Screen name="Profile" component={ProfileScreen} />
            <Stack.Screen name="ProfileEdit" component={ProfileEditScreen} />
            <Stack.Screen name="Wishlists" component={WishlistsScreen} />
            <Stack.Screen name="Wishlist" component={WishlistScreen} />
            <Stack.Screen name="WishlistCreate" component={WishlistCreateScreen} />
            <Stack.Screen name="FriendsList" component={FriendsListScreen} />
            <Stack.Screen name="Favorites" component={FavoritesScreen} />
            <Stack.Screen name="ListCreate" component={ListCreateScreen} />
            <Stack.Screen name="ListDetail" component={ListDetailScreen} />
            <Stack.Screen name="Unmatched" component={UnmatchedScreen} />
            <Stack.Screen name="Notifications" component={NotificationScreen} />
            <Stack.Screen name="NotificationSettings" component={NotificationSettingsScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  )
}
