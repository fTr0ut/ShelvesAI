import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Pressable,
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
import { CommonActions } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { AuthContext } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { apiRequest } from '../services/api';
import { resolveCollectableCoverUrl } from '../utils/coverUrl';
import { formatCollectableSearchMeta } from '../utils/collectableDisplay';
import useBottomFooterLayout from '../navigation/useBottomFooterLayout';
import {
  buildCollectableItemKey,
  buildCollectableSearchQuery,
  COLLECTABLE_SEARCH_TYPE_OPTIONS,
  DEFAULT_API_FALLBACK_RESULTS_LIMIT,
  DEFAULT_COLLECTABLE_SEARCH_LIMIT,
  useCollectableSearchEngine,
} from '../hooks/useCollectableSearchEngine';

const SHELF_SEARCH_MIN_QUERY_LENGTH = 3;
const SHELF_SEARCH_PAGE_LIMIT = 50;
const SHELF_SEARCH_FALLBACK_LIMIT = 50;

function normalizeTypeValue(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized || normalized === 'all') return '';
  return normalized;
}

function normalizeAdvancedOptions(input = {}, defaultFallbackLimit = DEFAULT_API_FALLBACK_RESULTS_LIMIT) {
  return {
    forceApiFallback: Boolean(input?.forceApiFallback),
    forceApiSupplement: Boolean(input?.forceApiSupplement),
    fallbackLimit: Number.isFinite(Number(input?.fallbackLimit))
      ? Math.max(1, Math.floor(Number(input?.fallbackLimit)))
      : defaultFallbackLimit,
  };
}

function getCollectableTypeLabel(item, fallbackType = '') {
  const raw = String(item?.kind || item?.type || fallbackType || '').trim().toLowerCase();
  if (!raw) return 'Item';
  if (raw === 'book' || raw === 'books') return 'Book';
  if (raw === 'movie' || raw === 'movies' || raw === 'film' || raw === 'films') return 'Movie';
  if (raw === 'game' || raw === 'games') return 'Game';
  if (raw === 'tv' || raw === 'show' || raw === 'shows' || raw === 'series') return 'TV';
  if (raw === 'vinyl' || raw === 'album' || raw === 'albums' || raw === 'record' || raw === 'records') return 'Vinyl';
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

export default function ItemSearchScreen({ route, navigation }) {
  const {
    mode: rawMode,
    shelfId,
    shelfType,
    replaceContext,
    advancedQuery = '',
    advancedType = '',
    advancedPlatform = '',
    advancedForceApiFallback = false,
    advancedApiSupplement = false,
    advancedFallbackLimit,
  } = route.params || {};
  const { token, apiBase } = useContext(AuthContext);
  const { colors, spacing, shadows, radius, isDark } = useTheme();

  const isAdvancedMode = rawMode === 'advanced_from_friend' || (!shelfId && rawMode !== 'shelf_add_or_replace');
  const isShelfMode = !isAdvancedMode;
  const isReplacementMode = !!(replaceContext?.traceId && replaceContext?.sourceItemId);

  const skipAdvancedReturnOnRemove = useRef(false);

  const [searchTitle, setSearchTitle] = useState(advancedQuery || replaceContext?.prefillTitle || '');
  const [searchCreator, setSearchCreator] = useState(advancedQuery ? '' : (replaceContext?.prefillAuthor || ''));
  const [searchType, setSearchType] = useState(normalizeTypeValue(advancedType || replaceContext?.prefillType || shelfType || ''));
  const [searchPlatform, setSearchPlatform] = useState(advancedPlatform || replaceContext?.prefillPlatform || '');
  const [showTypePicker, setShowTypePicker] = useState(false);
  const [manualSaving, setManualSaving] = useState(false);

  const searchOptions = useMemo(() => {
    if (isShelfMode) {
      return {
        forceApiFallback: true,
        forceApiSupplement: false,
        fallbackLimit: SHELF_SEARCH_FALLBACK_LIMIT,
      };
    }

    return normalizeAdvancedOptions({
      forceApiFallback: advancedForceApiFallback,
      forceApiSupplement: advancedApiSupplement,
      fallbackLimit: advancedFallbackLimit,
    });
  }, [advancedApiSupplement, advancedFallbackLimit, advancedForceApiFallback, isShelfMode]);

  const {
    results: searchResults,
    loading: searchLoading,
    loadingMore: searchLoadingMore,
    searched: searchRan,
    pagination: searchPagination,
    search,
    loadMore,
    reset,
  } = useCollectableSearchEngine({
    apiBase,
    token,
    pageLimit: isShelfMode ? SHELF_SEARCH_PAGE_LIMIT : DEFAULT_COLLECTABLE_SEARCH_LIMIT,
    defaultApiSupplement: false,
    defaultFallbackLimit: isShelfMode ? SHELF_SEARCH_FALLBACK_LIMIT : DEFAULT_API_FALLBACK_RESULTS_LIMIT,
    debugTag: 'ItemSearchDebug',
  });

  const styles = useMemo(
    () => createStyles({ colors, spacing, shadows, radius }),
    [colors, spacing, shadows, radius]
  );
  const { contentBottomPadding } = useBottomFooterLayout();
  const itemSearchBottomPadding = contentBottomPadding(spacing.xl);

  const selectedTypeOption = useMemo(() => (
    COLLECTABLE_SEARCH_TYPE_OPTIONS.find((option) => option.value === searchType)
    || COLLECTABLE_SEARCH_TYPE_OPTIONS[0]
  ), [searchType]);

  const composedQuery = useMemo(() => buildCollectableSearchQuery({
    title: searchTitle.trim(),
    creator: searchCreator.trim(),
  }), [searchCreator, searchTitle]);

  const meetsShelfMinLength = composedQuery.length >= SHELF_SEARCH_MIN_QUERY_LENGTH;
  const canShowManualFallback = isShelfMode && searchRan && meetsShelfMinLength && !searchLoading;
  const canSubmitManualFallback = searchTitle.trim().length > 0;
  const shouldShowSearchGuidance = isShelfMode && searchRan;
  const showEmptyState = searchRan && !searchLoading && searchResults.length === 0;

  const runCatalogSearch = useCallback(async ({ showErrorAlert = true } = {}) => {
    const query = buildCollectableSearchQuery({
      title: searchTitle.trim(),
      creator: searchCreator.trim(),
    });

    if (!query) {
      reset();
      return;
    }

    if (isShelfMode && query.length < SHELF_SEARCH_MIN_QUERY_LENGTH) {
      reset();
      return;
    }

    try {
      await search({
        query,
        type: searchType,
        platform: searchPlatform.trim(),
        forceApiFallback: searchOptions.forceApiFallback,
        forceApiSupplement: searchOptions.forceApiSupplement,
        fallbackLimit: searchOptions.fallbackLimit,
      });
    } catch (err) {
      if (showErrorAlert) {
        Alert.alert('Error', err?.message || 'Search failed');
      }
    }
  }, [
    isShelfMode,
    reset,
    search,
    searchCreator,
    searchOptions.fallbackLimit,
    searchOptions.forceApiFallback,
    searchOptions.forceApiSupplement,
    searchPlatform,
    searchTitle,
    searchType,
  ]);

  const loadMoreCatalog = useCallback(async () => {
    if (!searchPagination?.hasMore || searchLoadingMore || searchLoading) return;
    try {
      await loadMore();
    } catch (err) {
      Alert.alert('Error', err?.message || 'Unable to load more results');
    }
  }, [loadMore, searchLoading, searchLoadingMore, searchPagination?.hasMore]);

  const buildAdvancedReturnParams = useCallback(() => {
    const advancedOptions = {
      forceApiFallback: true,
      forceApiSupplement: Boolean(searchType),
      fallbackLimit: searchOptions.fallbackLimit,
    };

    return {
      advancedReturnToken: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      advancedQuery: composedQuery,
      advancedType: searchType || '',
      advancedPlatform: searchPlatform.trim(),
      advancedOptions,
    };
  }, [composedQuery, searchOptions.fallbackLimit, searchPlatform, searchType]);

  const emitAdvancedReturnParams = useCallback(() => {
    if (!isAdvancedMode) return;

    const state = navigation.getState();
    const routes = state?.routes || [];
    const index = Number.isFinite(state?.index) ? state.index : routes.length - 1;
    const previousRoute = routes[index - 1];
    if (!previousRoute || previousRoute.name !== 'FriendSearch') return;

    navigation.dispatch({
      ...CommonActions.setParams(buildAdvancedReturnParams()),
      source: previousRoute.key,
    });
  }, [buildAdvancedReturnParams, isAdvancedMode, navigation]);

  const handleAdvancedApplyAndGoBack = useCallback(() => {
    if (!composedQuery) {
      Alert.alert('Error', 'Enter a title or creator first.');
      return;
    }

    skipAdvancedReturnOnRemove.current = true;
    emitAdvancedReturnParams();
    navigation.goBack();
  }, [composedQuery, emitAdvancedReturnParams, navigation]);

  useEffect(() => {
    if (!isAdvancedMode) return undefined;
    const unsubscribe = navigation.addListener('beforeRemove', () => {
      if (skipAdvancedReturnOnRemove.current) {
        skipAdvancedReturnOnRemove.current = false;
        return;
      }
      emitAdvancedReturnParams();
    });
    return unsubscribe;
  }, [emitAdvancedReturnParams, isAdvancedMode, navigation]);

  const performReplacement = useCallback(async (payload) => {
    if (!isReplacementMode) return;

    const sourceItemId = replaceContext?.sourceItemId;
    const traceId = replaceContext?.traceId;
    if (!sourceItemId || !traceId) {
      throw new Error('Replacement context is missing.');
    }

    await apiRequest({
      apiBase,
      path: `/api/shelves/${shelfId}/items/${sourceItemId}/replace`,
      method: 'POST',
      token,
      body: {
        traceId,
        ...payload,
      },
    });
  }, [apiBase, isReplacementMode, replaceContext?.sourceItemId, replaceContext?.traceId, shelfId, token]);

  const performManualAdd = useCallback(async () => {
    if (!isShelfMode || !shelfId) {
      Alert.alert('Error', 'Shelf context is missing.');
      return;
    }

    const title = searchTitle.trim();
    if (!title) {
      Alert.alert('Error', 'Title is required to add manually.');
      return;
    }

    const resolvedType = (searchType || shelfType || 'Item').trim();

    try {
      setManualSaving(true);
      if (isReplacementMode) {
        await performReplacement({
          manual: {
            name: title,
            type: resolvedType,
            author: searchCreator.trim() || undefined,
            format: searchPlatform.trim() || undefined,
          },
        });
        Alert.alert('Replaced', 'Item replaced.', [
          { text: 'OK', onPress: () => navigation.goBack() },
        ]);
      } else {
        await apiRequest({
          apiBase,
          path: `/api/shelves/${shelfId}/manual`,
          method: 'POST',
          token,
          body: {
            name: title,
            type: resolvedType,
            author: searchCreator.trim() || undefined,
            format: searchPlatform.trim() || undefined,
          },
        });
        Alert.alert('Added', 'Manual item added to your shelf.');
        navigation.goBack();
      }
    } catch (e) {
      Alert.alert('Error', e?.message || 'Manual add failed');
    } finally {
      setManualSaving(false);
    }
  }, [
    apiBase,
    isReplacementMode,
    isShelfMode,
    navigation,
    performReplacement,
    searchCreator,
    searchPlatform,
    searchTitle,
    searchType,
    shelfId,
    shelfType,
    token,
  ]);

  const persistShelfSelection = useCallback(async (suggestion) => {
    if (!isShelfMode || !shelfId) {
      throw new Error('Shelf context is required to add or replace items.');
    }

    try {
      setManualSaving(true);
      const fallbackTitle = suggestion.title || suggestion.name || searchTitle.trim();
      const fallbackType = suggestion.kind || suggestion.type || searchType || shelfType || 'Item';
      const collectablePayload = {
        ...suggestion,
        title: fallbackTitle,
        name: fallbackTitle,
        kind: fallbackType,
        type: fallbackType,
        primaryCreator: suggestion.primaryCreator || searchCreator.trim() || undefined,
        format: searchPlatform.trim() || undefined,
      };

      if (isReplacementMode) {
        if (suggestion.id) {
          await performReplacement({ collectableId: suggestion.id });
        } else if (suggestion.fromApi) {
          await performReplacement({ collectable: collectablePayload });
        } else {
          throw new Error('Unsupported replacement suggestion payload.');
        }
        Alert.alert('Replaced', 'Item replaced.', [
          { text: 'OK', onPress: () => navigation.goBack() },
        ]);
      } else if (suggestion.id) {
        await apiRequest({
          apiBase,
          path: `/api/shelves/${shelfId}/items`,
          method: 'POST',
          token,
          body: {
            collectableId: suggestion.id,
            format: searchPlatform.trim() || undefined,
          },
        });
        Alert.alert('Added', 'Item added to your shelf.');
        navigation.goBack();
      } else if (suggestion.fromApi) {
        await apiRequest({
          apiBase,
          path: `/api/shelves/${shelfId}/items/from-api`,
          method: 'POST',
          token,
          body: {
            collectable: collectablePayload,
          },
        });
        Alert.alert('Added', 'Item added to your shelf.');
        navigation.goBack();
      }
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setManualSaving(false);
    }
  }, [
    apiBase,
    isReplacementMode,
    isShelfMode,
    navigation,
    performReplacement,
    searchCreator,
    searchPlatform,
    searchTitle,
    searchType,
    shelfId,
    shelfType,
    token,
  ]);

  const confirmShelfSelection = useCallback((collectable) => {
    if (!isShelfMode) return;
    const actionLabel = isReplacementMode ? 'Replace' : 'Add';
    const title = collectable?.title || collectable?.name || 'this item';
    Alert.alert(
      `${actionLabel} item`,
      `${actionLabel} "${title}" ${isReplacementMode ? 'as replacement' : 'to this shelf'}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: actionLabel,
          onPress: () => {
            persistShelfSelection(collectable);
          },
        },
      ],
    );
  }, [isReplacementMode, isShelfMode, persistShelfSelection]);

  const handleCatalogSelect = useCallback(async (collectable) => {
    if (isShelfMode) {
      confirmShelfSelection(collectable);
      return;
    }

    try {
      let resolved = collectable;
      if (collectable?.fromApi) {
        const response = await apiRequest({
          apiBase,
          path: '/api/collectables/resolve-search-hit',
          method: 'POST',
          token,
          body: {
            candidate: collectable,
            selectedType: searchType || null,
          },
        });
        if (response?.collectable) {
          resolved = response.collectable;
        }
      }
      navigation.navigate('CollectableDetail', { item: { collectable: resolved } });
    } catch (err) {
      Alert.alert('Error', err?.message || 'Unable to open collectable');
    }
  }, [apiBase, confirmShelfSelection, isShelfMode, navigation, searchType, token]);

  const manualFallbackLabel = isReplacementMode ? 'Replace anyways...' : 'Add anyways...';
  const searchGuidanceLabel = isReplacementMode
    ? 'Tap the results below to replace on your shelf. Can\'t find what you\'re looking for below? Hit the "Replace anyways..." button at the bottom at the bottom of the results.'
    : 'Tap the results below to add to your shelf. Can\'t find what you\'re looking for below? Hit the "Add anyways..." button at the bottom at the bottom of the results.';

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />
      <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={22} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>
            {isAdvancedMode ? 'Advanced Search' : (isReplacementMode ? 'Replace Item' : 'Add to Shelf')}
          </Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: itemSearchBottomPadding }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Catalog Search</Text>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Title</Text>
              <TextInput
                style={styles.input}
                placeholder="Item title"
                placeholderTextColor={colors.textMuted}
                value={searchTitle}
                onChangeText={setSearchTitle}
                autoFocus={isAdvancedMode || isReplacementMode}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Creator</Text>
              <TextInput
                style={styles.input}
                placeholder="Optional"
                placeholderTextColor={colors.textMuted}
                value={searchCreator}
                onChangeText={setSearchCreator}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Type</Text>
              <TouchableOpacity style={styles.typePickerButton} onPress={() => setShowTypePicker(true)}>
                <Text style={styles.typePickerText}>{selectedTypeOption.label}</Text>
                <Ionicons name="chevron-down" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Platform / Format</Text>
              <TextInput
                style={styles.input}
                placeholder="Optional (PlayStation, Nintendo 64, 4K UHD Blu-ray)"
                placeholderTextColor={colors.textMuted}
                value={searchPlatform}
                onChangeText={setSearchPlatform}
              />
            </View>

            {isAdvancedMode ? (
              <TouchableOpacity
                style={styles.saveButton}
                onPress={handleAdvancedApplyAndGoBack}
                disabled={searchLoading}
              >
                <Text style={styles.saveButtonText}>Apply to Friend Search</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.saveButton, searchLoading && styles.saveButtonDisabled]}
                onPress={() => runCatalogSearch({ showErrorAlert: true })}
                disabled={searchLoading}
              >
                <Text style={styles.saveButtonText}>
                  {searchLoading ? 'Searching...' : 'Search Catalog'}
                </Text>
              </TouchableOpacity>
            )}

            {shouldShowSearchGuidance ? (
              <Text style={styles.helperText}>{searchGuidanceLabel}</Text>
            ) : null}
          </View>

          {searchLoading ? (
            <View style={styles.loadingInline}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : null}

          {searchResults.length > 0 ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>
                Results ({searchResults.length})
              </Text>
              {searchResults.map((item, index) => {
                const key = buildCollectableItemKey(item, index);
                const coverUrl = resolveCollectableCoverUrl(item, apiBase);
                const creator = item.primaryCreator || item.author || '';
                const metadataLine = formatCollectableSearchMeta(item);
                return (
                  <TouchableOpacity
                    key={key}
                    style={styles.resultCard}
                    onPress={() => handleCatalogSelect(item)}
                  >
                    {coverUrl ? (
                      <Image source={{ uri: coverUrl }} style={styles.resultCover} />
                    ) : (
                      <View style={[styles.resultCover, styles.resultCoverFallback]}>
                        <Ionicons name="library" size={20} color={colors.primary} />
                      </View>
                    )}
                    <View style={styles.resultInfo}>
                      <Text style={styles.resultTitle} numberOfLines={2}>{item.title || item.name || 'Untitled'}</Text>
                      {creator ? <Text style={styles.resultSubtitle} numberOfLines={1}>{creator}</Text> : null}
                      {metadataLine ? <Text style={styles.resultMetaText} numberOfLines={1}>{metadataLine}</Text> : null}
                      <View style={styles.resultMetaRow}>
                        <Text style={styles.resultKind}>{getCollectableTypeLabel(item, searchType)}</Text>
                      </View>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                  </TouchableOpacity>
                );
              })}

              {searchPagination?.hasMore ? (
                <TouchableOpacity style={styles.loadMoreButton} onPress={loadMoreCatalog} disabled={searchLoadingMore}>
                  {searchLoadingMore ? (
                    <ActivityIndicator size="small" color={colors.textInverted} />
                  ) : (
                    <Text style={styles.loadMoreButtonText}>Load More</Text>
                  )}
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}

          {showEmptyState ? (
            <View style={styles.card}>
              <Text style={styles.emptyText}>No catalog matches found for this query.</Text>
            </View>
          ) : null}

          {canShowManualFallback ? (
            canSubmitManualFallback ? (
              <View style={styles.card}>
                <TouchableOpacity
                  style={[styles.saveButton, manualSaving && styles.saveButtonDisabled]}
                  onPress={performManualAdd}
                  disabled={manualSaving}
                >
                  <Text style={styles.saveButtonText}>
                    {manualSaving
                      ? (isReplacementMode ? 'Replacing...' : 'Adding...')
                      : manualFallbackLabel}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.card}>
                <Text style={styles.helperText}>Enter a title to add manually.</Text>
              </View>
            )
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal
        visible={showTypePicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowTypePicker(false)}
      >
        <Pressable style={styles.typeModalOverlay} onPress={() => setShowTypePicker(false)}>
          <Pressable style={styles.typeModalCard} onPress={() => {}}>
            {COLLECTABLE_SEARCH_TYPE_OPTIONS.map((option) => {
              const selected = option.value === searchType;
              return (
                <TouchableOpacity
                  key={option.value || 'all'}
                  style={styles.typeModalOption}
                  onPress={() => {
                    setSearchType(option.value);
                    setShowTypePicker(false);
                  }}
                >
                  <Text style={[styles.typeModalOptionText, selected && styles.typeModalOptionTextSelected]}>
                    {option.label}
                  </Text>
                  {selected ? <Ionicons name="checkmark" size={16} color={colors.primary} /> : null}
                </TouchableOpacity>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const createStyles = ({ colors, spacing, shadows, radius }) => StyleSheet.create({
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
  typePickerButton: {
    backgroundColor: colors.background,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  typePickerText: {
    fontSize: 15,
    color: colors.text,
  },
  input: {
    backgroundColor: colors.background,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 15,
    color: colors.text,
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
  helperText: {
    marginTop: spacing.md,
    color: colors.textMuted,
    fontSize: 13,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 14,
  },
  loadingInline: {
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  resultCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    padding: spacing.sm,
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  resultCover: {
    width: 44,
    height: 60,
    borderRadius: 6,
    backgroundColor: colors.surfaceElevated,
  },
  resultCoverFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultInfo: {
    flex: 1,
  },
  resultTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  resultSubtitle: {
    marginTop: 2,
    color: colors.textMuted,
    fontSize: 12,
  },
  resultMetaText: {
    marginTop: 2,
    color: colors.textMuted,
    fontSize: 11,
  },
  resultMetaRow: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  resultKind: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  loadMoreButton: {
    marginTop: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 40,
  },
  loadMoreButtonText: {
    color: colors.textInverted,
    fontSize: 14,
    fontWeight: '600',
  },
  typeModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.25)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  typeModalCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: spacing.xs,
    ...shadows.md,
  },
  typeModalOption: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
  },
  typeModalOptionText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '500',
  },
  typeModalOptionTextSelected: {
    color: colors.primary,
    fontWeight: '700',
  },
});
