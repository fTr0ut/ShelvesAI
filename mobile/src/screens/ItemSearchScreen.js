import React, { useCallback, useContext, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
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



  const [manualTitle, setManualTitle] = useState('');
  const [manualType, setManualType] = useState(shelfType || '');
  const [manualAuthor, setManualAuthor] = useState('');
  const [manualDescription, setManualDescription] = useState('');
  const [manualSaving, setManualSaving] = useState(false);

  // State for suggestion modal
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestionModal, setShowSuggestionModal] = useState(false);

  const styles = useMemo(
    () => createStyles({ colors, spacing, typography, shadows, radius }),
    [colors, spacing, typography, shadows, radius]
  );



  // Actually perform the manual add (called after user decides to add anyway)
  const performManualAdd = useCallback(async () => {
    const title = manualTitle.trim();
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

  // Add a collectable from suggestions
  const addSuggestion = useCallback(async (suggestion) => {
    setShowSuggestionModal(false);
    try {
      setManualSaving(true);
      if (suggestion.id) {
        // Existing collectable in database
        await apiRequest({
          apiBase,
          path: `/api/shelves/${shelfId}/items`,
          method: 'POST',
          token,
          body: { collectableId: suggestion.id },
        });
      } else if (suggestion.fromApi) {
        // API result - create collectable with full metadata
        const fallbackTitle = suggestion.title || suggestion.name || manualTitle.trim();
        const fallbackType = suggestion.kind || suggestion.type || manualType || shelfType || 'Item';
        await apiRequest({
          apiBase,
          path: `/api/shelves/${shelfId}/items/from-api`,
          method: 'POST',
          token,
          body: {
            collectable: {
              ...suggestion,
              title: fallbackTitle,
              name: fallbackTitle,
              kind: fallbackType,
              type: fallbackType,
              primaryCreator: suggestion.primaryCreator || manualAuthor.trim() || undefined,
              description: suggestion.description || manualDescription.trim() || undefined,
            },
          },
        });
      }
      Alert.alert('Added', 'Item added to your shelf.');
      navigation.goBack();
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setManualSaving(false);
    }
  }, [apiBase, shelfId, token, manualTitle, manualType, manualAuthor, manualDescription, shelfType, navigation]);

  // Main handler - search first, show suggestions if found
  const handleAddManual = useCallback(async () => {
    const title = manualTitle.trim();
    if (!title) {
      Alert.alert('Error', 'Title is required.');
      return;
    }

    try {
      setManualSaving(true);
      // Search for existing matches
      const data = await apiRequest({
        apiBase,
        path: `/api/shelves/${shelfId}/manual/search`,
        method: 'POST',
        token,
        body: {
          title,
          author: manualAuthor.trim() || undefined,
        },
      });

      const foundSuggestions = data?.suggestions || [];
      if (foundSuggestions.length > 0) {
        // Show suggestions modal
        setSuggestions(foundSuggestions);
        setShowSuggestionModal(true);
        setManualSaving(false);
      } else {
        // No suggestions - add directly
        await performManualAdd();
      }
    } catch (e) {
      // If search fails, just add manually
      console.warn('Manual search failed, adding directly:', e.message);
      await performManualAdd();
    }
  }, [apiBase, shelfId, token, manualTitle, manualAuthor, performManualAdd]);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />
      <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={22} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Add to Shelf</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Search & Add</Text>

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
              <Text style={styles.saveButtonText}>{manualSaving ? 'Searching...' : 'Search & Add'}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Suggestion Picker Modal */}
      <Modal
        visible={showSuggestionModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowSuggestionModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>We found some matches</Text>
              <TouchableOpacity onPress={() => setShowSuggestionModal(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSubtitle}>
              Select one below or add as a new item
            </Text>

            <ScrollView style={styles.suggestionList}>
              {suggestions.map((suggestion, index) => {
                const title = suggestion.title || suggestion.name || 'Untitled';
                const creator = suggestion.primaryCreator || '';
                return (
                  <TouchableOpacity
                    key={suggestion.id || index}
                    style={styles.suggestionItem}
                    onPress={() => addSuggestion(suggestion)}
                  >
                    <View style={styles.suggestionText}>
                      <Text style={styles.suggestionTitle} numberOfLines={1}>{title}</Text>
                      {creator ? <Text style={styles.suggestionSubtitle} numberOfLines={1}>{creator}</Text> : null}
                    </View>
                    <Ionicons name="add-circle" size={24} color={colors.primary} />
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <TouchableOpacity
              style={styles.addAnywayButton}
              onPress={() => {
                setShowSuggestionModal(false);
                performManualAdd();
              }}
            >
              <Text style={styles.addAnywayText}>Add as new item anyway</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    maxHeight: '70%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  modalSubtitle: {
    fontSize: 14,
    color: colors.textMuted,
    marginBottom: spacing.md,
  },
  suggestionList: {
    maxHeight: 300,
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.background,
    padding: spacing.md,
    borderRadius: radius.lg,
    marginBottom: spacing.sm,
  },
  suggestionText: {
    flex: 1,
    marginRight: spacing.sm,
  },
  suggestionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  suggestionSubtitle: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  addAnywayButton: {
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  addAnywayText: {
    fontSize: 14,
    color: colors.textMuted,
  },
});
