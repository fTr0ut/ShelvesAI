import React, { useCallback, useContext, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AuthContext } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { apiRequest } from '../services/api';

const VISIBILITY_OPTIONS = [
  { value: 'private', label: 'Private', icon: 'lock-closed' },
  { value: 'friends', label: 'Friends', icon: 'people' },
  { value: 'public', label: 'Public', icon: 'globe' },
];

const SHELF_TYPES = [
  { value: 'books', label: 'Books', icon: 'book' },
  { value: 'movies', label: 'Movies', icon: 'film' },
  { value: 'games', label: 'Games', icon: 'game-controller' },
  { value: 'music', label: 'Music', icon: 'musical-notes' },
  { value: 'vinyl', label: 'Vinyl', icon: 'disc' },
  { value: 'other', label: 'Other', icon: 'library' },
];

export default function ShelfCreateScreen({ navigation }) {
  const { token, apiBase } = useContext(AuthContext);
  const { colors, spacing, typography, shadows, radius, isDark } = useTheme();

  const [name, setName] = useState('');
  const [type, setType] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState('private');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const styles = createStyles({ colors, spacing, typography, shadows, radius });

  const handleCreate = useCallback(async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Please enter a shelf name');
      return;
    }

    try {
      setSaving(true);
      setError('');
      const payload = {
        name: trimmedName,
        type: type || 'other',
        description: description.trim(),
        visibility,
      };
      const data = await apiRequest({ apiBase, path: '/api/shelves', method: 'POST', token, body: payload });
      navigation.replace('ShelfDetail', { id: data.shelf._id, title: data.shelf.name });
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }, [apiBase, name, type, description, visibility, navigation, token]);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.container}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>New Shelf</Text>
            <View style={{ width: 40 }} />
          </View>

          {/* Error */}
          {error ? (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={18} color={colors.error} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {/* Name Input */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Name</Text>
            <TextInput
              style={styles.input}
              placeholder="My Collection"
              placeholderTextColor={colors.textMuted}
              value={name}
              onChangeText={setName}
              editable={!saving}
              autoFocus
            />
          </View>

          {/* Type Selection */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Type</Text>
            <View style={styles.chipGrid}>
              {SHELF_TYPES.map(opt => (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.chip, type === opt.value && styles.chipActive]}
                  onPress={() => setType(opt.value)}
                  disabled={saving}
                >
                  <Ionicons
                    name={opt.icon}
                    size={16}
                    color={type === opt.value ? colors.textInverted : colors.textSecondary}
                  />
                  <Text style={[styles.chipText, type === opt.value && styles.chipTextActive]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Description */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Description <Text style={styles.optional}>(optional)</Text></Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="What's in this collection?"
              placeholderTextColor={colors.textMuted}
              value={description}
              onChangeText={setDescription}
              editable={!saving}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
          </View>

          {/* Visibility */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Visibility</Text>
            <View style={styles.visibilityRow}>
              {VISIBILITY_OPTIONS.map(opt => (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.visibilityOption, visibility === opt.value && styles.visibilityActive]}
                  onPress={() => setVisibility(opt.value)}
                  disabled={saving}
                >
                  <Ionicons
                    name={opt.icon}
                    size={20}
                    color={visibility === opt.value ? colors.primary : colors.textMuted}
                  />
                  <Text style={[styles.visibilityText, visibility === opt.value && styles.visibilityTextActive]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </ScrollView>

        {/* Fixed Create Button */}
        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.createButton, saving && styles.createButtonDisabled]}
            onPress={handleCreate}
            disabled={saving || !name.trim()}
          >
            {saving ? (
              <Text style={styles.createButtonText}>Creating...</Text>
            ) : (
              <>
                <Ionicons name="add-circle" size={20} color={colors.textInverted} />
                <Text style={styles.createButtonText}>Create Shelf</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const createStyles = ({ colors, spacing, typography, shadows, radius }) => StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    flex: 1,
  },
  content: {
    padding: spacing.md,
    paddingBottom: 100,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.error + '15',
    padding: spacing.sm,
    borderRadius: radius.md,
    marginBottom: spacing.md,
  },
  errorText: {
    color: colors.error,
    fontSize: 14,
    flex: 1,
  },
  inputGroup: {
    marginBottom: spacing.lg,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  optional: {
    fontWeight: '400',
    color: colors.textMuted,
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 16,
    color: colors.text,
    ...shadows.sm,
  },
  textArea: {
    minHeight: 100,
    paddingTop: spacing.md,
  },
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  chipTextActive: {
    color: colors.textInverted,
    fontWeight: '500',
  },
  visibilityRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  visibilityOption: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: 'transparent',
    ...shadows.sm,
  },
  visibilityActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + '10',
  },
  visibilityText: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 4,
  },
  visibilityTextActive: {
    color: colors.primary,
    fontWeight: '500',
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: spacing.md,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  createButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    ...shadows.md,
  },
  createButtonDisabled: {
    opacity: 0.6,
  },
  createButtonText: {
    color: colors.textInverted,
    fontSize: 16,
    fontWeight: '600',
  },
});
