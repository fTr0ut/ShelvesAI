import React, { useContext, useEffect, useMemo, useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, StatusBar } from 'react-native'
import { AuthContext } from '../App'
import { apiRequest, saveToken } from '../services/api'



export default function LoginScreen() {
  const { setToken, apiBase, setNeedsOnboarding } = useContext(AuthContext)
  const [mode, setMode] = useState('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')

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
  buttonText: { color: '#0b1320', fontWeight: '700' },
  message: { color: '#a5e3bf', marginTop: 10, textAlign: 'center' },
})
