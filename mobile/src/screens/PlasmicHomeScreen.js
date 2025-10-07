import React, { useContext, useMemo } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { WebView } from 'react-native-webview'
import { AuthContext } from '../App'

function appendQueryParams(baseUrl, params) {
  if (!baseUrl) {
    return ''
  }
  const queryPairs = Object.entries(params)
    .filter(([, value]) => typeof value === 'string' && value)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
  if (!queryPairs.length) {
    return baseUrl
  }
  const separator = baseUrl.includes('?') ? '&' : '?'
  return `${baseUrl}${separator}${queryPairs.join('&')}`
}

const renderLoading = () => (
  <View style={styles.centered}>
    <ActivityIndicator size="large" />
  </View>
)

export default function PlasmicHomeScreen() {
  const { token, apiBase, plasmicOptIn, plasmicConfig } = useContext(AuthContext)
  const webViewUrl = plasmicConfig?.webViewUrl || ''

  const launchUrl = useMemo(
    () => appendQueryParams(webViewUrl, { token, apiBase }),
    [webViewUrl, token, apiBase]
  )

  const injectedJavaScript = useMemo(() => {
    const scripts = []
    if (token) {
      scripts.push(`try { localStorage.setItem('token', ${JSON.stringify(token)}); } catch (e) {}`)
    }
    if (apiBase) {
      scripts.push(`try { localStorage.setItem('apiBase', ${JSON.stringify(apiBase)}); } catch (e) {}`)
    }
    if (!scripts.length) {
      return 'true;'
    }
    return `(function(){${scripts.join('')}})();true;`
  }, [token, apiBase])

  if (!plasmicOptIn) {
    return (
      <View style={styles.centered}>
        <Text style={styles.message}>Enable the Plasmic preview from the login screen to see the new experience.</Text>
      </View>
    )
  }

  if (!webViewUrl) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>Missing Plasmic WebView URL.</Text>
        <Text style={styles.message}>Add extra.plasmic.webViewUrl to mobile/app.json to point at your hosted experience.</Text>
      </View>
    )
  }

  return (
    <WebView
      source={{ uri: launchUrl }}
      originWhitelist={['*']}
      startInLoadingState
      renderLoading={renderLoading}
      injectedJavaScript={injectedJavaScript}
      javaScriptEnabled
      domStorageEnabled
      pullToRefreshEnabled
      allowsInlineMediaPlayback
    />
  )
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#0b0f14',
  },
  message: {
    color: '#9aa6b2',
    textAlign: 'center',
    fontSize: 16,
    marginTop: 8,
  },
  error: {
    color: '#ff6b6b',
    fontWeight: '600',
    textAlign: 'center',
    fontSize: 16,
  },
})
