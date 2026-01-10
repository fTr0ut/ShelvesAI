import React, { useCallback, useContext, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
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

export default function ItemSearchScreen({ route, navigation }) {
  const { shelfId, shelfType } = route.params || {};
  const { token, apiBase } = useContext(AuthContext);
  const { colors, spacing, typography, shadows, radius, isDark } = useTheme();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  const [manualTitle, setManualTitle] = useState('');
  const [manualType, setManualType] = useState(shelfType || '');
  const [manualAuthor, setManualAuthor] = useState('');
  const [manualDescription, setManualDescription] = useState('');
  const [manualSaving, setManualSaving] = useState(false);

  const styles = useMemo(
    () => createStyles({ colors, spacing, typography, shadows, radius }),
    [colors, spacing, typography, shadows, radius]
  );

  const handleSearch = useCallback(async () => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setSearched(false);
      return;
    }

    try {
      setSearching(true);
      setSearched(true);
      const data = await apiRequest({
        apiBase,
        path: `/api/shelves/${shelfId}/search?q=${encodeURIComponent(trimmed)}`,
        token,
      });
      setResults(Array.isArray(data?.results) ? data.results : []);
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setSearching(false);
    }
  }, [apiBase, query, shelfId, token]);

  const handleAddCollectable = useCallback(async (collectableId) => {
    if (!collectableId) return;
    try {
      await apiRequest({
        apiBase,
        path: `/api/shelves/${shelfId}/items`,
        method: 'POST',
        token,
        body: { collectableId },
      });
      Alert.alert('Added', 'Item added to your shelf.');
      navigation.goBack();
    } catch (e) {
      Alert.alert('Error', e.message);
    }
  }, [apiBase, shelfId, token, navigation]);

  const handleAddManual = useCallback(async () => {
    const title = manualTitle.trim();
    if (!title) {
      Alert.alert('Error', 'Title is required.');
      return;
    }

    const type = (manualType || shelfType || 'Item').trim();
    try {
      setManualSaving(true);
      await apiRequest({
        apiBase,
        path: `/api/shelves/${shelfId}/manual`,
        method: 'POST',
        token,
        body: {
          name: title,
          type,
          author: manualAuthor.trim() || undefined,
          description: manualDescription.trim() || undefined,
        },
      });
      Alert.alert('Added', 'Manual item added to your shelf.');
      navigation.goBack();
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setManualSaving(false);
    }
  }, [apiBase, shelfId, token, manualTitle, manualType, manualAuthor, manualDescription, shelfType, navigation]);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />
      <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={22} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Add Items</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Search Catalog</Text>
            <View style={styles.searchRow}>
              <Ionicons name="search" size={18} color={colors.textMuted} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search items..."
                placeholderTextColor={colors.textMuted}
                value={query}
                onChangeText={(value) => {
                  setQuery(value);
                  if (!value.trim()) {
                    setResults([]);
                    setSearched(false);
                  }
                }}
                returnKeyType="search"
                onSubmitEditing={handleSearch}
              />
              <TouchableOpacity
                style={[styles.searchButton, searching && styles.searchButtonDisabled]}
                onPress={handleSearch}
                disabled={searching}
              >
                {searching ? (
                  <ActivityIndicator size="small" color={colors.textInverted} />
                ) : (
                  <Text style={styles.searchButtonText}>Go</Text>
                )}
              </TouchableOpacity>
            </View>

            {results.length > 0 ? (
              <View style={styles.resultsList}>
                {results.map((result) => {
                  const collectableId = result?.id ?? result?._id;
                  const title = result?.title || result?.name || 'Untitled';
                  const subtitle = [result?.primaryCreator, result?.year].filter(Boolean).join(' • ');
                  return (
                    <TouchableOpacity
                      key={collectableId}
                      style={styles.resultItem}
                      onPress={() => handleAddCollectable(collectableId)}
                    >
                      <View style={styles.resultText}>
                        <Text style={styles.resultTitle} numberOfLines={1}>{title}</Text>
                        {subtitle ? <Text style={styles.resultSubtitle} numberOfLines={1}>{subtitle}</Text> : null}
                      </View>
                      <Ionicons name="add-circle" size={22} color={colors.primary} />
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : searched ? (
              <View style={styles.emptyState}>
                <Ionicons name="search-outline" size={40} color={colors.textMuted} />
                <Text style={styles.emptyTitle}>No results found</Text>
                <Text style={styles.emptyText}>Try a different search term.</Text>
              </View>
            ) : null}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Manual Entry</Text>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Title</Text>
              <TextInput
                style={styles.input}
                placeholder="Item title"
                placeholderTextColor={colors.textMuted}
                value={manualTitle}
                onChangeText={setManualTitle}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Type</Text>
              <TextInput
                style={styles.input}
                placeholder="Book, Movie, Game..."
                placeholderTextColor={colors.textMuted}
                value={manualType}
                onChangeText={setManualType}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Author / Creator</Text>
              <TextInput
                style={styles.input}
                placeholder="Optional"
                placeholderTextColor={colors.textMuted}
                value={manualAuthor}
                onChangeText={setManualAuthor}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Description</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder="Optional description"
                placeholderTextColor={colors.textMuted}
                value={manualDescription}
                onChangeText={setManualDescription}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />
            </View>

            <TouchableOpacity
              style={[styles.saveButton, manualSaving && styles.saveButtonDisabled]}
              onPress={handleAddManual}
              disabled={manualSaving}
            >
              <Text style={styles.saveButtonText}>{manualSaving ? 'Adding...' : 'Add Manual Item'}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const createStyles = ({ colors, spacing, typography, shadows, radius }) => StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    ...shadows.sm,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
  },
  content: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.sm,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.md,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    height: 42,
    gap: spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: colors.text,
  },
  searchButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
  },
  searchButtonDisabled: {
    opacity: 0.6,
  },
  searchButtonText: {
    color: colors.textInverted,
    fontWeight: '600',
    fontSize: 12,
  },
  resultsList: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  resultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surfaceElevated,
    padding: spacing.md,
    borderRadius: radius.lg,
  },
  resultText: {
    flex: 1,
    marginRight: spacing.sm,
  },
  resultTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  resultSubtitle: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  emptyState: {
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    marginTop: spacing.sm,
  },
  emptyText: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  inputGroup: {
    marginBottom: spacing.sm,
  },
  label: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: 4,
  },
  input: {
    backgroundColor: colors.background,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 15,
    color: colors.text,
  },
  textArea: {
    minHeight: 80,
    paddingTop: spacing.sm,
  },
  saveButton: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    color: colors.textInverted,
    fontWeight: '600',
    fontSize: 15,
  },
});
