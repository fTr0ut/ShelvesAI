import React, { useCallback, useContext, useMemo, useState } from 'react'
import { ScrollView, StyleSheet, Text, View, TouchableOpacity } from 'react-native'
import FooterNav from '../components/FooterNav'
import { AuthContext } from '../context/AuthContext'
import { apiRequest } from '../services/api'
import { colors, spacing, typography } from '../theme'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import Card from '../components/ui/Card'

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

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <Card style={styles.card}>
          <Text style={styles.sectionLabel}>Shelf Details</Text>

          <Input
            label="Shelf Name"
            placeholder="e.g. My Favorite Books"
            value={form.name}
            onChangeText={(value) => setForm((prev) => ({ ...prev, name: value }))}
            editable={!saving}
            autoCapitalize="words"
          />

          <Input
            label="Type"
            placeholder="e.g. Books, Vinyl, Games"
            value={form.type}
            onChangeText={(value) => setForm((prev) => ({ ...prev, type: value }))}
            editable={!saving}
            autoCapitalize="words"
          />

          <Input
            label="Description"
            placeholder="Optional description..."
            value={form.description}
            onChangeText={(value) => setForm((prev) => ({ ...prev, description: value }))}
            editable={!saving}
            multiline
            numberOfLines={3}
            style={{ minHeight: 80, textAlignVertical: 'top' }}
          />
        </Card>

        <Card style={styles.card}>
          <Text style={styles.sectionLabel}>Visibility</Text>
          <View style={styles.visibilityRow}>
            {VISIBILITY_OPTIONS.map((option) => {
              const selected = option.value === form.visibility
              return (
                <Button
                  key={option.value}
                  title={option.label}
                  variant={selected ? 'secondary' : 'outline'}
                  size="sm"
                  onPress={() => setForm((prev) => ({ ...prev, visibility: option.value }))}
                  disabled={saving}
                  style={{ flex: 1 }}
                />
              )
            })}
          </View>
          <Text style={styles.helper}>Currently visible to: {visibilityLabel}</Text>
        </Card>

        <Button
          title={saving ? 'Creating...' : 'Create Shelf'}
          onPress={handleCreate}
          disabled={saving}
          loading={saving}
          variant="primary"
          style={styles.createButton}
        />
      </ScrollView>

      <FooterNav navigation={navigation} active="shelves" />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.md,
    paddingBottom: 40,
    gap: spacing.md,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 28,
    fontFamily: typography.bold,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 14,
    fontFamily: typography.regular,
    marginTop: -8,
  },
  errorBox: {
    backgroundColor: 'rgba(255, 69, 58, 0.1)',
    padding: spacing.sm,
    borderRadius: 8,
  },
  errorText: {
    color: colors.danger,
    textAlign: 'center',
    fontSize: 14,
  },
  card: {
    gap: spacing.md,
    padding: spacing.md,
  },
  sectionLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
    fontFamily: typography.bold,
    marginBottom: 4,
  },
  visibilityRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  helper: {
    color: colors.textTertiary,
    fontSize: 12,
    marginTop: 4,
  },
  createButton: {
    marginTop: spacing.sm,
  },
})
