import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Image,
    Keyboard,
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    TouchableWithoutFeedback,
    View,
} from 'react-native';
import Animated, {
    FadeIn,
    FadeOut,
    SlideInRight,
    SlideOutLeft,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { AuthContext } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { apiRequest } from '../services/api';
import { emitCheckInPosted } from '../services/checkInEvents';
import { formatCollectableSearchMeta } from '../utils/collectableDisplay';
import { useSearch } from '../hooks/useSearch';
import { COLLECTABLE_SEARCH_TYPE_OPTIONS, MIN_FALLBACK_QUERY_LENGTH } from '../hooks/useCollectableSearchEngine';

const STEPS = {
    STATUS: 'status',
    SEARCH: 'search',
    CONFIRM: 'confirm',
};

const STATUS_OPTIONS = [
    { key: 'starting', label: 'Starting', icon: 'play-circle-outline', description: 'Just beginning' },
    { key: 'continuing', label: 'Continuing', icon: 'refresh-outline', description: 'Still in progress' },
    { key: 'completed', label: 'Completed', icon: 'checkmark-circle-outline', description: 'Finished it' },
];
const DEFAULT_SEARCH_LIMIT = 10;
const SEE_MORE_LIMIT = 25;
const DEFAULT_SEARCH_META = {
    results: [],
    searched: { local: true, api: false },
    resolvedContainer: null,
    sources: { localCount: 0, apiCount: 0 },
};

export default function CheckInScreen() {
    const navigation = useNavigation();
    const route = useRoute();
    const { token, apiBase } = useContext(AuthContext);
    const { colors, spacing, typography, shadows, radius, isDark } = useTheme();

    // Multi-step state
    const [step, setStep] = useState(STEPS.STATUS);
    const [selectedStatus, setSelectedStatus] = useState(null);
    const [selectedItem, setSelectedItem] = useState(null);
    const [visibility, setVisibility] = useState('public');
    const [note, setNote] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [selectedType, setSelectedType] = useState('');
    const [showTypePicker, setShowTypePicker] = useState(false);
    const [expandedSearch, setExpandedSearch] = useState(false);

    const styles = useMemo(
        () => createStyles({ colors, spacing, typography, shadows, radius }),
        [colors, spacing, typography, shadows, radius]
    );
    const overlayColor = isDark ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.35)';

    // Search via shared hook (handles debounce, cleanup, and BUG-19 blur cleanup).
    const searchFn = useCallback(async (text) => {
        const limit = expandedSearch ? SEE_MORE_LIMIT : DEFAULT_SEARCH_LIMIT;
        const encodedType = selectedType ? `&type=${encodeURIComponent(selectedType)}` : '';
        const shouldUseApi = text.trim().length >= MIN_FALLBACK_QUERY_LENGTH;
        const data = await apiRequest({
            apiBase,
            path: `/api/checkin/search?q=${encodeURIComponent(text)}&limit=${limit}&wildcard=true&fallbackApi=${shouldUseApi ? 'true' : 'false'}&fallbackLimit=${limit}&apiSupplement=${expandedSearch ? 'true' : 'false'}${encodedType}`,
            token,
        });
        return {
            results: data?.results || [],
            searched: data?.searched || { local: true, api: false },
            resolvedContainer: data?.resolvedContainer || null,
            sources: data?.sources || { localCount: 0, apiCount: 0 },
        };
    }, [apiBase, expandedSearch, selectedType, token]);

    const {
        query: searchQuery,
        setQuery: handleSearchChange,
        results: searchResultsRaw,
        loading: searchLoading,
        clear: clearSearch,
    } = useSearch(searchFn);

    const searchMeta = searchResultsRaw ?? DEFAULT_SEARCH_META;
    const searchResults = searchMeta.results || [];
    const selectedTypeOption = useMemo(() => (
        COLLECTABLE_SEARCH_TYPE_OPTIONS.find((entry) => entry.value === selectedType)
        || COLLECTABLE_SEARCH_TYPE_OPTIONS[0]
    ), [selectedType]);
    const canSeeMoreResults = (
        !expandedSearch
        && searchQuery.trim().length >= MIN_FALLBACK_QUERY_LENGTH
        && searchResults.length > 0
    );

    const onSearchChange = useCallback((text) => {
        if (expandedSearch) setExpandedSearch(false);
        handleSearchChange(text);
    }, [expandedSearch, handleSearchChange]);

    // BUG-19: clear pending search timeout on navigation blur.
    useEffect(() => {
        const unsubscribe = navigation.addListener('blur', clearSearch);
        return unsubscribe;
    }, [navigation, clearSearch]);

    useEffect(() => {
        if (!searchQuery.trim()) return;
        setExpandedSearch(false);
        handleSearchChange(searchQuery);
    }, [selectedType, handleSearchChange]);

    useEffect(() => {
        if (route.params?.prefilledItem) {
            setSelectedItem(route.params.prefilledItem);
        }
    }, [route.params?.prefilledItem]);

    // Step handlers
    const handleStatusSelect = useCallback((status) => {
        setSelectedStatus(status);
        if (selectedItem || route.params?.prefilledItem) {
            setStep(STEPS.CONFIRM);
        } else {
            setStep(STEPS.SEARCH);
        }
    }, [selectedItem, route.params?.prefilledItem]);

    const handleItemSelect = useCallback((item) => {
        setSelectedItem(item);
        setStep(STEPS.CONFIRM);
    }, []);

    const handleBack = useCallback(() => {
        if (step === STEPS.SEARCH) {
            setStep(STEPS.STATUS);
            setSelectedType('');
            setExpandedSearch(false);
            clearSearch();
        } else if (step === STEPS.CONFIRM) {
            if (route.params?.prefilledItem) {
                setStep(STEPS.STATUS);
            } else {
                setStep(STEPS.SEARCH);
            }
        }
    }, [step, clearSearch, route.params?.prefilledItem]);

    const handleSeeMoreResults = useCallback(() => {
        if (!searchQuery.trim()) return;
        setExpandedSearch(true);
        handleSearchChange(searchQuery.trim());
    }, [handleSearchChange, searchQuery]);

    const handleSubmit = useCallback(async () => {
        if (!selectedStatus || !selectedItem) return;

        try {
            setSubmitting(true);
            let itemForCheckin = selectedItem;
            if (selectedItem?.fromApi) {
                const resolved = await apiRequest({
                    apiBase,
                    path: '/api/collectables/resolve-search-hit',
                    method: 'POST',
                    token,
                    body: {
                        candidate: selectedItem,
                        selectedType: selectedType || selectedItem?.kind || null,
                    },
                });
                if (!resolved?.collectable?.id) {
                    throw new Error('Unable to resolve this result for check-in');
                }
                itemForCheckin = {
                    ...resolved.collectable,
                    source: 'collectable',
                    fromApi: false,
                };
            }

            const isManual = itemForCheckin?.source === 'manual';
            await apiRequest({
                apiBase,
                path: '/api/checkin',
                method: 'POST',
                token,
                body: {
                    collectableId: isManual ? undefined : itemForCheckin.id,
                    manualId: isManual ? itemForCheckin.id : undefined,
                    status: selectedStatus.key,
                    visibility,
                    note: note.trim() || undefined,
                },
            });
            Alert.alert('Posted!', 'Your check-in has been shared.', [
                {
                    text: 'OK',
                    onPress: () => {
                        emitCheckInPosted({
                            originTab: route?.params?.originTab || '',
                            postedAt: Date.now(),
                        });
                        navigation.goBack();
                    }
                }
            ]);
        } catch (err) {
            Alert.alert('Error', err.message);
        } finally {
            setSubmitting(false);
        }
    }, [apiBase, token, selectedStatus, selectedItem, selectedType, visibility, note, navigation, route?.params?.originTab]);

    // Get cover URL for display
    const getCoverUrl = (item) => {
        if (item?.coverMediaPath) {
            return `${apiBase}/media/${item.coverMediaPath}`;
        }
        return item?.coverUrl || null;
    };

    // Render step content
    const renderStepContent = () => {
        switch (step) {
            case STEPS.STATUS:
                return (
                    <Animated.View entering={FadeIn} exiting={FadeOut} style={styles.stepContent}>
                        <Text style={styles.stepTitle}>I'm...</Text>
                        <View style={styles.statusOptions}>
                            {STATUS_OPTIONS.map((option) => (
                                <TouchableOpacity
                                    key={option.key}
                                    style={styles.statusOption}
                                    onPress={() => handleStatusSelect(option)}
                                    activeOpacity={0.7}
                                >
                                    <View style={styles.statusIconWrap}>
                                        <Ionicons name={option.icon} size={28} color={colors.primary} />
                                    </View>
                                    <View style={styles.statusTextWrap}>
                                        <Text style={styles.statusLabel}>{option.label}</Text>
                                        <Text style={styles.statusDescription}>{option.description}</Text>
                                    </View>
                                    <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
                                </TouchableOpacity>
                            ))}
                        </View>
                    </Animated.View>
                );

            case STEPS.SEARCH:
                return (
                    <Animated.View entering={SlideInRight} exiting={SlideOutLeft} style={styles.stepContent}>
                        <View style={styles.searchHeader}>
                            <TouchableOpacity onPress={handleBack} style={styles.backButton}>
                                <Ionicons name="arrow-back" size={20} color={colors.text} />
                            </TouchableOpacity>
                            <Text style={styles.stepTitle}>What are you {selectedStatus?.label.toLowerCase()}?</Text>
                        </View>

                        <View style={styles.searchInputContainer}>
                            <Ionicons name="search" size={18} color={colors.textMuted} />
                            <TextInput
                                style={styles.searchInput}
                                placeholder="Search for a book, movie, game..."
                                placeholderTextColor={colors.textMuted}
                                value={searchQuery}
                                onChangeText={onSearchChange}
                                autoFocus
                            />
                            <TouchableOpacity style={styles.typeChip} onPress={() => setShowTypePicker(true)}>
                                <Text style={styles.typeChipText}>{selectedTypeOption.label}</Text>
                                <Ionicons name="chevron-down" size={12} color={colors.textMuted} />
                            </TouchableOpacity>
                            {searchQuery.length > 0 && (
                                <TouchableOpacity onPress={clearSearch}>
                                    <Ionicons name="close-circle" size={18} color={colors.textMuted} />
                                </TouchableOpacity>
                            )}
                        </View>

                        <Modal
                            visible={showTypePicker}
                            transparent
                            animationType="fade"
                            onRequestClose={() => setShowTypePicker(false)}
                        >
                            <Pressable style={styles.typeModalOverlay} onPress={() => setShowTypePicker(false)}>
                                <Pressable style={styles.typeModalCard} onPress={() => {}}>
                                    {COLLECTABLE_SEARCH_TYPE_OPTIONS.map((option) => {
                                        const selected = option.value === selectedType;
                                        return (
                                            <TouchableOpacity
                                                key={option.label}
                                                style={styles.typeModalOption}
                                                onPress={() => {
                                                    setSelectedType(option.value);
                                                    setShowTypePicker(false);
                                                }}
                                            >
                                                <Text style={[styles.typeModalOptionText, selected && styles.typeModalOptionTextSelected]}>
                                                    {option.label}
                                                </Text>
                                                {selected && <Ionicons name="checkmark" size={16} color={colors.primary} />}
                                            </TouchableOpacity>
                                        );
                                    })}
                                </Pressable>
                            </Pressable>
                        </Modal>

                        {searchLoading && (
                            <View style={styles.loadingContainer}>
                                <ActivityIndicator size="small" color={colors.primary} />
                            </View>
                        )}

                        <ScrollView style={styles.searchResultsList} showsVerticalScrollIndicator={false}>
                            {searchResults.map((item, index) => {
                                const coverUrl = getCoverUrl(item);
                                const metadataLine = formatCollectableSearchMeta(item);
                                const resultKey = `${item.source || 'collectable'}-${item.id ?? item.externalId ?? `${item.title || 'untitled'}-${index}`}`;
                                return (
                                    <TouchableOpacity
                                        key={resultKey}
                                        style={styles.searchResultItem}
                                        onPress={() => handleItemSelect(item)}
                                    >
                                        {coverUrl ? (
                                            <Image source={{ uri: coverUrl }} style={styles.resultCover} />
                                        ) : (
                                            <View style={[styles.resultCover, styles.resultCoverFallback]}>
                                                <Ionicons name="book" size={20} color={colors.primary} />
                                            </View>
                                        )}
                                        <View style={styles.resultInfo}>
                                            <Text style={styles.resultTitle} numberOfLines={1}>{item.title || 'Untitled'}</Text>
                                            {item.primaryCreator && (
                                                <Text style={styles.resultSubtitle} numberOfLines={1}>{item.primaryCreator}</Text>
                                            )}
                                            {metadataLine ? (
                                                <Text style={styles.resultMetaText} numberOfLines={1}>{metadataLine}</Text>
                                            ) : null}
                                            {item.kind && (
                                                <Text style={styles.resultKind}>{item.kind}</Text>
                                            )}
                                        </View>
                                        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                                    </TouchableOpacity>
                                );
                            })}

                            {!searchLoading && searchQuery.trim() && searchResults.length === 0 && (
                                <View style={styles.emptyState}>
                                    <Ionicons name="search-outline" size={32} color={colors.textMuted} />
                                    <Text style={styles.emptyText}>No results found</Text>
                                </View>
                            )}

                            {!searchLoading && canSeeMoreResults && (
                                <TouchableOpacity style={styles.seeMoreButton} onPress={handleSeeMoreResults}>
                                    <Text style={styles.seeMoreText}>See more results</Text>
                                    <Ionicons name="arrow-forward" size={14} color={colors.primary} />
                                </TouchableOpacity>
                            )}
                        </ScrollView>
                    </Animated.View>
                );

            case STEPS.CONFIRM:
                const coverUrl = getCoverUrl(selectedItem);
                return (
                    <Animated.View entering={SlideInRight} exiting={SlideOutLeft} style={styles.stepContent}>
                        <View style={styles.searchHeader}>
                            <TouchableOpacity onPress={handleBack} style={styles.backButton}>
                                <Ionicons name="arrow-back" size={20} color={colors.text} />
                            </TouchableOpacity>
                            <Text style={styles.stepTitle}>Confirm Check-In</Text>
                        </View>

                        <ScrollView
                            showsVerticalScrollIndicator={false}
                            keyboardShouldPersistTaps="handled"
                            contentContainerStyle={styles.confirmScrollContent}
                        >
                            <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
                                <View>
                                    {/* Selected item preview */}
                                    <View style={styles.previewCard}>
                                        <View style={styles.previewHeader}>
                                            <View style={styles.statusBadge}>
                                                <Ionicons name={selectedStatus?.icon} size={14} color={colors.primary} />
                                                <Text style={styles.statusBadgeText}>{selectedStatus?.label}</Text>
                                            </View>
                                        </View>
                                        <View style={styles.previewContent}>
                                            {coverUrl ? (
                                                <Image source={{ uri: coverUrl }} style={styles.previewCover} />
                                            ) : (
                                                <View style={[styles.previewCover, styles.resultCoverFallback]}>
                                                    <Ionicons name="book" size={28} color={colors.primary} />
                                                </View>
                                            )}
                                            <View style={styles.previewInfo}>
                                                <Text style={styles.previewTitle} numberOfLines={2}>{selectedItem?.title}</Text>
                                                {selectedItem?.primaryCreator && (
                                                    <Text style={styles.previewSubtitle}>{selectedItem.primaryCreator}</Text>
                                                )}
                                            </View>
                                        </View>
                                    </View>

                                    {/* Visibility toggle */}
                                    <View style={styles.optionRow}>
                                        <Text style={styles.optionLabel}>Share with</Text>
                                        <View style={styles.visibilityToggle}>
                                            <TouchableOpacity
                                                style={[styles.visibilityOption, visibility === 'public' && styles.visibilityOptionActive]}
                                                onPress={() => setVisibility('public')}
                                            >
                                                <Ionicons name="globe-outline" size={16} color={visibility === 'public' ? colors.textInverted : colors.text} />
                                                <Text style={[styles.visibilityText, visibility === 'public' && styles.visibilityTextActive]}>Everyone</Text>
                                            </TouchableOpacity>
                                            <TouchableOpacity
                                                style={[styles.visibilityOption, visibility === 'friends' && styles.visibilityOptionActive]}
                                                onPress={() => setVisibility('friends')}
                                            >
                                                <Ionicons name="people-outline" size={16} color={visibility === 'friends' ? colors.textInverted : colors.text} />
                                                <Text style={[styles.visibilityText, visibility === 'friends' && styles.visibilityTextActive]}>Friends-only</Text>
                                            </TouchableOpacity>
                                        </View>
                                    </View>

                                    {/* Optional note */}
                                    <View style={styles.noteSection}>
                                        <Text style={styles.optionLabel}>Add a note (optional)</Text>
                                        <TextInput
                                            style={styles.noteInput}
                                            placeholder="What are your thoughts?"
                                            placeholderTextColor={colors.textMuted}
                                            value={note}
                                            onChangeText={setNote}
                                            multiline
                                            maxLength={280}
                                            returnKeyType="done"
                                            blurOnSubmit={true}
                                            onSubmitEditing={Keyboard.dismiss}
                                        />
                                        <Text style={styles.charCount}>{note.length}/280</Text>
                                    </View>

                                    {/* Submit button */}
                                    <TouchableOpacity
                                        style={[styles.submitButton, submitting && styles.submitButtonDisabled]}
                                        onPress={handleSubmit}
                                        disabled={submitting}
                                    >
                                        {submitting ? (
                                            <ActivityIndicator size="small" color={colors.textInverted} />
                                        ) : (
                                            <Text style={styles.submitButtonText}>Post Check-In</Text>
                                        )}
                                    </TouchableOpacity>
                                </View>
                            </TouchableWithoutFeedback>
                        </ScrollView>
                    </Animated.View>
                );

            default:
                return null;
        }
    };

    return (
        <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <Pressable
                style={[styles.backdrop, { backgroundColor: overlayColor }]}
                onPress={() => navigation.goBack()}
            />
            <View style={styles.card}>
                <View style={styles.header}>
                    <Text style={styles.title}>Check In</Text>
                    <Pressable
                        onPress={() => navigation.goBack()}
                        style={({ pressed }) => [
                            styles.closeButton,
                            pressed && styles.closeButtonPressed,
                        ]}
                    >
                        <Ionicons name="close" size={20} color={colors.text} />
                    </Pressable>
                </View>
                {renderStepContent()}
            </View>
        </KeyboardAvoidingView>
    );
}

const createStyles = ({ colors, spacing, typography, shadows, radius }) => StyleSheet.create({
    screen: {
        flex: 1,
        backgroundColor: 'transparent',
        justifyContent: 'center',
        alignItems: 'center',
    },
    backdrop: {
        ...StyleSheet.absoluteFillObject,
    },
    card: {
        width: '92%',
        maxWidth: 400,
        maxHeight: '85%',
        backgroundColor: colors.surface,
        borderRadius: radius.lg,
        ...shadows.lg,
        overflow: 'hidden',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: spacing.lg,
        paddingTop: spacing.lg,
        paddingBottom: spacing.sm,
    },
    title: {
        fontSize: 20,
        fontWeight: '700',
        color: colors.text,
        fontFamily: typography.bold,
    },
    closeButton: {
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.surfaceElevated,
    },
    closeButtonPressed: {
        opacity: 0.7,
    },
    stepContent: {
        paddingHorizontal: spacing.lg,
        paddingBottom: spacing.lg,
    },
    confirmScrollContent: {
        flexGrow: 1,
        paddingBottom: spacing.md,
    },
    stepTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: colors.text,
        marginBottom: spacing.md,
    },

    // Status step
    statusOptions: {
        gap: spacing.sm,
    },
    statusOption: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.surfaceElevated,
        padding: spacing.md,
        borderRadius: radius.lg,
        gap: spacing.md,
    },
    statusIconWrap: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: colors.primary + '15',
        justifyContent: 'center',
        alignItems: 'center',
    },
    statusTextWrap: {
        flex: 1,
    },
    statusLabel: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.text,
    },
    statusDescription: {
        fontSize: 13,
        color: colors.textMuted,
        marginTop: 2,
    },

    // Search step
    searchHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        marginBottom: spacing.md,
    },
    backButton: {
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: colors.surfaceElevated,
        justifyContent: 'center',
        alignItems: 'center',
    },
    searchInputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.background,
        borderRadius: radius.lg,
        paddingHorizontal: spacing.md,
        height: 44,
        gap: spacing.sm,
        marginBottom: spacing.md,
    },
    searchInput: {
        flex: 1,
        fontSize: 15,
        color: colors.text,
    },
    typeChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        height: 28,
        paddingHorizontal: spacing.sm,
        borderRadius: radius.full,
        backgroundColor: colors.surfaceElevated,
    },
    typeChipText: {
        fontSize: 12,
        color: colors.text,
        fontWeight: '600',
    },
    typeModalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.25)',
        justifyContent: 'center',
        paddingHorizontal: spacing.xl,
    },
    typeModalCard: {
        backgroundColor: colors.surface,
        borderRadius: radius.lg,
        overflow: 'hidden',
        ...shadows.md,
    },
    typeModalOption: {
        minHeight: 42,
        paddingHorizontal: spacing.md,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    typeModalOptionText: {
        color: colors.text,
        fontSize: 15,
    },
    typeModalOptionTextSelected: {
        color: colors.primary,
        fontWeight: '600',
    },
    loadingContainer: {
        padding: spacing.md,
        alignItems: 'center',
    },
    searchResultsList: {
        maxHeight: 300,
    },
    searchResultItem: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.surfaceElevated,
        padding: spacing.sm,
        borderRadius: radius.md,
        marginBottom: spacing.sm,
        gap: spacing.sm,
    },
    resultCover: {
        width: 44,
        height: 60,
        borderRadius: radius.sm,
        backgroundColor: colors.background,
    },
    resultCoverFallback: {
        justifyContent: 'center',
        alignItems: 'center',
    },
    resultInfo: {
        flex: 1,
    },
    resultTitle: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.text,
    },
    resultSubtitle: {
        fontSize: 12,
        color: colors.textMuted,
        marginTop: 2,
    },
    resultMetaText: {
        fontSize: 11,
        color: colors.textMuted,
        marginTop: 2,
    },
    resultKind: {
        fontSize: 11,
        color: colors.primary,
        marginTop: 4,
        textTransform: 'capitalize',
    },
    emptyState: {
        alignItems: 'center',
        padding: spacing.xl,
    },
    emptyText: {
        fontSize: 14,
        color: colors.textMuted,
        marginTop: spacing.sm,
    },
    seeMoreButton: {
        minHeight: 40,
        marginTop: spacing.xs,
        marginBottom: spacing.sm,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.primary + '66',
        backgroundColor: colors.primary + '10',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.xs,
    },
    seeMoreText: {
        color: colors.primary,
        fontSize: 13,
        fontWeight: '600',
    },

    // Confirm step
    previewCard: {
        backgroundColor: colors.surfaceElevated,
        borderRadius: radius.lg,
        padding: spacing.md,
        marginBottom: spacing.md,
    },
    previewHeader: {
        marginBottom: spacing.sm,
    },
    statusBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        backgroundColor: colors.primary + '15',
        paddingHorizontal: spacing.sm,
        paddingVertical: 4,
        borderRadius: radius.full,
        gap: 4,
    },
    statusBadgeText: {
        fontSize: 12,
        fontWeight: '600',
        color: colors.primary,
    },
    previewContent: {
        flexDirection: 'row',
        gap: spacing.md,
    },
    previewCover: {
        width: 60,
        height: 80,
        borderRadius: radius.sm,
        backgroundColor: colors.background,
    },
    previewInfo: {
        flex: 1,
        justifyContent: 'center',
    },
    previewTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.text,
    },
    previewSubtitle: {
        fontSize: 13,
        color: colors.textMuted,
        marginTop: 4,
    },
    optionRow: {
        marginBottom: spacing.md,
    },
    optionLabel: {
        fontSize: 13,
        fontWeight: '500',
        color: colors.textMuted,
        marginBottom: spacing.xs,
    },
    visibilityToggle: {
        flexDirection: 'row',
        backgroundColor: colors.surfaceElevated,
        borderRadius: radius.lg,
        padding: 4,
    },
    visibilityOption: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: spacing.sm,
        borderRadius: radius.md,
        gap: 6,
    },
    visibilityOptionActive: {
        backgroundColor: colors.primary,
    },
    visibilityText: {
        fontSize: 14,
        fontWeight: '500',
        color: colors.text,
    },
    visibilityTextActive: {
        color: colors.textInverted,
    },
    noteSection: {
        marginBottom: spacing.md,
    },
    noteInput: {
        backgroundColor: colors.surfaceElevated,
        borderRadius: radius.lg,
        padding: spacing.md,
        fontSize: 15,
        color: colors.text,
        minHeight: 80,
        textAlignVertical: 'top',
    },
    charCount: {
        fontSize: 11,
        color: colors.textMuted,
        textAlign: 'right',
        marginTop: 4,
    },
    submitButton: {
        backgroundColor: colors.primary,
        paddingVertical: 14,
        borderRadius: radius.full,
        alignItems: 'center',
        justifyContent: 'center',
    },
    submitButtonDisabled: {
        opacity: 0.6,
    },
    submitButtonText: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.textInverted,
    },
});
