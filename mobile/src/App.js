import React, { createContext, useCallback, useEffect, useMemo, useState } from 'react'
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { Appearance, KeyboardAvoidingView, Platform } from 'react-native'
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
import BottomTabNavigator from './navigation/BottomTabNavigator'
import CheckInScreen from './screens/CheckInScreen'
import linkingConfig from './navigation/linkingConfig'


import { AuthContext } from './context/AuthContext'
import { ThemeProvider, useTheme } from './context/ThemeContext'
import { apiRequest, setAuthErrorHandler } from './services/api'
import { ToastProvider } from './context/ToastContext'
import ToastContainer from './components/Toast'

const Stack = createNativeStackNavigator()
const TOKEN_STORAGE_KEY = 'token'
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

function guessApiBase() {
  const envApiBase = process.env.EXPO_PUBLIC_API_BASE
  if (envApiBase) return envApiBase

  const envUseNgrok = process.env.EXPO_PUBLIC_USE_NGROK
  const envNgrokUrl = process.env.EXPO_PUBLIC_NGROK_URL
  if (isTruthy(envUseNgrok) && envNgrokUrl) return envNgrokUrl

  const extra = getExtraConfig()
  const extraUseNgrok = isTruthy(extra?.USE_NGROK)
  const extraNgrokUrl = extra?.NGROK_URL
  if (extraUseNgrok && extraNgrokUrl) return extraNgrokUrl

  const extraBase = extra?.API_BASE
  if (extraBase) return extraBase
  const hostUri = Constants?.expoConfig?.hostUri || ''
  const host = hostUri.split(':')[0]
  if (host) return `http://${host}:5001`
  if (Platform.OS === 'android') return 'http://10.0.2.2:5001' // Android emulator
  return 'http://localhost:5001'
}

export default function App() {
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
  const apiBase = useMemo(() => guessApiBase(), [])
  const extra = useMemo(() => getExtraConfig(), [])

  useEffect(() => {
    (async () => {
      try {
        const [storedToken, storedPremium] = await Promise.all([
          AsyncStorage.getItem(TOKEN_STORAGE_KEY),
          AsyncStorage.getItem(PREMIUM_STORAGE_KEY),
        ])
        if (storedToken) {
          setToken(storedToken)
        }
        if (storedPremium !== null) {
          setPremiumEnabledState(storedPremium === 'true')
        }
      } finally {
        setReady(true)
      }
    })()
  }, [])

  // Set up global auth error handler to log out on invalid token
  useEffect(() => {
    setAuthErrorHandler(() => {
      setToken('')
      setUser(null)
      AsyncStorage.removeItem(TOKEN_STORAGE_KEY)
    })
    return () => setAuthErrorHandler(null)
  }, [])

  useEffect(() => {
    let cancelled = false

    const loadOnboardingConfig = async () => {
      try {
        const data = await apiRequest({ apiBase, path: '/api/config/onboarding' })
        if (!cancelled) {
          setOnboardingConfig(data)
        }
      } catch (err) {
        if (!cancelled) {
          setOnboardingConfig(null)
        }
      }
    }

    loadOnboardingConfig()

    return () => {
      cancelled = true
    }
  }, [apiBase])

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
        const res = await fetch(`${apiBase}/api/account`, {
          headers: {
            Authorization: `Bearer ${token}`
          }
        })
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled) {
          const missingRequired = !data?.user?.email || !data?.user?.firstName || !data?.user?.city || !data?.user?.state
          const onboardingCompleted = !!data?.user?.onboardingCompleted
          setNeedsOnboarding(!onboardingCompleted || missingRequired)
          setUser(data.user || null)
          if (typeof data?.user?.isPremium === 'boolean') {
            setPremiumEnabled(data.user.isPremium)
          }
        }
      } catch (err) {
        // ignore errors and keep existing onboarding state
      }
    }

    checkProfile()

    return () => {
      cancelled = true
    }
  }, [apiBase, token, setPremiumEnabled])

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
  }), [token, apiBase, needsOnboarding, user, premiumEnabled, setPremiumEnabled, onboardingConfig])

  if (!ready || !fontsLoaded) return null

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <ToastProvider>
          <AuthContext.Provider value={authValue}>
            <KeyboardAvoidingView
              style={{ flex: 1 }}
              behavior={Platform.OS === 'android' ? 'height' : undefined}
            >
              <AppNavigator token={token} needsOnboarding={needsOnboarding} />
              <ToastContainer />
            </KeyboardAvoidingView>
          </AuthContext.Provider>
        </ToastProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  )
}

// Separate component to use theme context
function AppNavigator({ token, needsOnboarding }) {
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
    <NavigationContainer theme={navTheme} linking={linkingConfig}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!token ? (
          <Stack.Screen name="Login" component={LoginScreen} />
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
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  )
}

