import React, { useCallback, useContext, useMemo, useState } from 'react'
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { AuthContext } from '../context/AuthContext'
import { apiRequest } from '../services/api'

const MIN_LENGTH = 3

export default function UsernameSetupScreen({ navigation }) {
  const { apiBase, token, setNeedsOnboarding } = useContext(AuthContext)
  const [username, setUsername] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const canSubmit = useMemo(() => username.trim().length >= MIN_LENGTH, [username])

  const submit = useCallback(async () => {
    const trimmed = username.trim()
    if (trimmed.length < MIN_LENGTH) {
      setError(`Username must be at least ${MIN_LENGTH} characters.`)
      return
    }
    if (!/^[a-z0-9._-]+$/i.test(trimmed)) {
      setError('Usernames can only include letters, numbers, dots, hyphens, and underscores.')
      return
    }

    try {
      setSaving(true)
      setError('')
      await apiRequest({ apiBase, path: '/api/username', method: 'POST', token, body: { username: trimmed } })
      setNeedsOnboarding(false)
      navigation.reset({ index: 0, routes: [{ name: 'Account' }] })
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }, [apiBase, navigation, setNeedsOnboarding, token, username])

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.select({ ios: 'padding', android: undefined })}
    >
      <View style={styles.container}>
        <Text style={styles.title}>Choose your username</Text>
        <Text style={styles.subtitle}>
          Pick a handle for friends to find you. You can change this later from your profile.
        </Text>

        <View style={styles.card}>
          <Text style={styles.label}>Username</Text>
          <TextInput
            style={styles.input}
            value={username}
            onChangeText={(value) => {
              if (error) setError('')
              setUsername(value)
            }}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="e.g. collectorsam"
            placeholderTextColor="#55657a"
            editable={!saving}
            returnKeyType="done"
            onSubmitEditing={submit}
          />
          <Text style={styles.helper}>At least {MIN_LENGTH} characters, letters and numbers only.</Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <TouchableOpacity
            style={[styles.button, (!canSubmit || saving) && styles.buttonDisabled]}
            onPress={submit}
            disabled={!canSubmit || saving}
          >
            <Text style={styles.buttonText}>{saving ? 'Saving...' : 'Continue'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0b0f14' },
  container: { flex: 1, padding: 24, gap: 16, justifyContent: 'center' },
  title: { color: '#e6edf3', fontSize: 28, fontWeight: '700' },
  subtitle: { color: '#9aa6b2', fontSize: 14, lineHeight: 20 },
  card: { backgroundColor: '#0e1522', borderRadius: 14, borderWidth: 1, borderColor: '#223043', padding: 20, gap: 12 },
  label: { color: '#9aa6b2', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6 },
  input: {
    backgroundColor: '#0b1320',
    color: '#e6edf3',
    borderColor: '#223043',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  helper: { color: '#55657a', fontSize: 12 },
  error: { color: '#ff9aa3', fontSize: 13 },
  button: {
    backgroundColor: '#5a8efc',
    borderRadius: 10,
    alignItems: 'center',
    paddingVertical: 12,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#0b0f14', fontWeight: '700', fontSize: 16 },
})
