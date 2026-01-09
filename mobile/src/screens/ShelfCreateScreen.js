import React, { useCallback, useContext, useMemo, useState } from 'react'
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import FooterNav from '../components/FooterNav'
import { AuthContext } from '../context/AuthContext'
import { apiRequest } from '../services/api'

const VISIBILITY_OPTIONS = [
  { value: 'private', label: 'Private' },
  { value: 'friends', label: 'Friends' },
  { value: 'public', label: 'Public' },
]

const INITIAL_FORM = {
  name: '',
  type: '',
  description: '',
  visibility: 'private',
}

export default function ShelfCreateScreen({ navigation }) {
  const { token, apiBase } = useContext(AuthContext)
  const [form, setForm] = useState(INITIAL_FORM)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const visibilityLabel = useMemo(() => {
    const match = VISIBILITY_OPTIONS.find((opt) => opt.value === form.visibility)
    return match?.label ?? ''
  }, [form.visibility])

  const handleCreate = useCallback(async () => {
    const trimmedName = form.name.trim()
    if (!trimmedName) {
      setError('Please enter a shelf name.')
      return
    }

    try {
      setSaving(true)
      setError('')
      const payload = {
        name: trimmedName,
        type: form.type.trim(),
        description: form.description.trim(),
        visibility: form.visibility,
      }
      const data = await apiRequest({ apiBase, path: '/api/shelves', method: 'POST', token, body: payload })
      setForm(INITIAL_FORM)
      navigation.replace('ShelfDetail', { id: data.shelf._id, title: data.shelf.name })
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }, [apiBase, form, navigation, token])

  return (
    <View style={styles.screen}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.title}>Create Shelf</Text>
        <Text style={styles.subtitle}>Organize a new collection to start tracking your items.</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Shelf Details</Text>

          <TextInput
            style={styles.input}
            placeholder="Shelf name"
            placeholderTextColor="#55657a"
            value={form.name}
            onChangeText={(value) => setForm((prev) => ({ ...prev, name: value }))}
            editable={!saving}
            autoCapitalize="words"
          />

          <TextInput
            style={styles.input}
            placeholder="Type (e.g., Books, Vinyl)"
            placeholderTextColor="#55657a"
            value={form.type}
            onChangeText={(value) => setForm((prev) => ({ ...prev, type: value }))}
            editable={!saving}
            autoCapitalize="words"
          />

          <TextInput
            style={[styles.input, styles.multiline]}
            placeholder="Description"
            placeholderTextColor="#55657a"
            value={form.description}
            onChangeText={(value) => setForm((prev) => ({ ...prev, description: value }))}
            editable={!saving}
            multiline
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Visibility</Text>
          <View style={styles.visibilityRow}>
            {VISIBILITY_OPTIONS.map((option) => {
              const selected = option.value === form.visibility
              return (
                <TouchableOpacity
                  key={option.value}
                  style={[styles.chip, selected && styles.chipActive]}
                  onPress={() => setForm((prev) => ({ ...prev, visibility: option.value }))}
                  disabled={saving}
                >
                  <Text style={styles.chipText}>{option.label}</Text>
                </TouchableOpacity>
              )
            })}
          </View>
          <Text style={styles.helper}>Currently visible to: {visibilityLabel || '-'}</Text>
        </View>

        <TouchableOpacity style={[styles.button, saving && styles.buttonDisabled]} onPress={handleCreate} disabled={saving}>
          <Text style={styles.buttonText}>{saving ? 'Creating...' : 'Create Shelf'}</Text>
        </TouchableOpacity>
      </ScrollView>

      <FooterNav navigation={navigation} active="shelves" />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0b0f14' },
  container: { flex: 1, backgroundColor: '#0b0f14' },
  content: { padding: 16, paddingBottom: 40, gap: 16 },
  title: { color: '#e6edf3', fontSize: 24, fontWeight: '700' },
  subtitle: { color: '#9aa6b2', fontSize: 14 },
  error: { color: '#ff9aa3' },
  card: { backgroundColor: '#0e1522', borderColor: '#223043', borderWidth: 1, borderRadius: 12, padding: 16, gap: 12 },
  sectionLabel: { color: '#9aa6b2', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6 },
  input: { backgroundColor: '#0b1320', color: '#e6edf3', borderColor: '#223043', borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  visibilityRow: { flexDirection: 'row', gap: 8 },
  chip: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 999, borderWidth: 1, borderColor: '#223043', backgroundColor: '#0b1320' },
  chipActive: { borderColor: '#5a8efc', backgroundColor: '#15223a' },
  chipText: { color: '#e6edf3', fontSize: 12, fontWeight: '600' },
  helper: { color: '#55657a', fontSize: 12 },
  button: { alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderRadius: 10, backgroundColor: '#5a8efc' },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: '#0b0f14', fontWeight: '700' },
})
