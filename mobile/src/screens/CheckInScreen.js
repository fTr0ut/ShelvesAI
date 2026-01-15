import React, { useCallback, useContext, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Image,
    Keyboard,
    KeyboardAvoidingView,
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
import { useNavigation } from '@react-navigation/native';
import { AuthContext } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { apiRequest } from '../services/api';

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

export default function CheckInScreen() {
    const navigation = useNavigation();
    const { token, apiBase } = useContext(AuthContext);
    const { colors, spacing, typography, shadows, radius, isDark } = useTheme();

    // Multi-step state
    const [step, setStep] = useState(STEPS.STATUS);
    const [selectedStatus, setSelectedStatus] = useState(null);
    const [selectedCollectable, setSelectedCollectable] = useState(null);
    const [visibility, setVisibility] = useState('public');
    const [note, setNote] = useState('');
    const [submitting, setSubmitting] = useState(false);

    // Search state
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [searchLoading, setSearchLoading] = useState(false);
    const searchTimeoutRef = useRef(null);

    const styles = useMemo(
        () => createStyles({ colors, spacing, typography, shadows, radius }),
        [colors, spacing, typography, shadows, radius]
    );
    const overlayColor = isDark ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.35)';

    // Debounced search handler
    const handleSearchChange = useCallback((text) => {
        setSearchQuery(text);

        if (searchTimeoutRef.current) {
            clearTimeout(searchTimeoutRef.current);
        }

        if (!text.trim()) {
            setSearchResults([]);
            return;
        }

        searchTimeoutRef.current = setTimeout(async () => {
            setSearchLoading(true);
            try {
                // Search collectables only (internal database)
                const data = await apiRequest({
                    apiBase,
                    path: `/api/collectables?q=${encodeURIComponent(text)}&limit=10&wildcard=true`,
                    token,
                });
                setSearchResults(data?.results || []);
            } catch (err) {
                console.error('Search error:', err);
            } finally {
                setSearchLoading(false);
            }
        }, 300);
    }, [apiBase, token]);

    // Step handlers
    const handleStatusSelect = useCallback((status) => {
        setSelectedStatus(status);
        setStep(STEPS.SEARCH);
    }, []);

    const handleCollectableSelect = useCallback((collectable) => {
        setSelectedCollectable(collectable);
        setStep(STEPS.CONFIRM);
    }, []);

    const handleBack = useCallback(() => {
        if (step === STEPS.SEARCH) {
            setStep(STEPS.STATUS);
            setSearchQuery('');
            setSearchResults([]);
        } else if (step === STEPS.CONFIRM) {
            setStep(STEPS.SEARCH);
        }
    }, [step]);

    const handleSubmit = useCallback(async () => {
        if (!selectedStatus || !selectedCollectable) return;

        try {
            setSubmitting(true);
            await apiRequest({
                apiBase,
                path: '/api/checkin',
                method: 'POST',
                token,
                body: {
                    collectableId: selectedCollectable.id,
                    status: selectedStatus.key,
                    visibility,
                    note: note.trim() || undefined,
                },
            });
            Alert.alert('Posted!', 'Your check-in has been shared.', [
                { text: 'OK', onPress: () => navigation.goBack() }
            ]);
        } catch (err) {
            Alert.alert('Error', err.message);
        } finally {
            setSubmitting(false);
        }
    }, [apiBase, token, selectedStatus, selectedCollectable, visibility, note, navigation]);

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
                                onChangeText={handleSearchChange}
                                autoFocus
                            />
                            {searchQuery.length > 0 && (
                                <TouchableOpacity onPress={() => { setSearchQuery(''); setSearchResults([]); }}>
                                    <Ionicons name="close-circle" size={18} color={colors.textMuted} />
                                </TouchableOpacity>
                            )}
                        </View>

                        {searchLoading && (
                            <View style={styles.loadingContainer}>
                                <ActivityIndicator size="small" color={colors.primary} />
                            </View>
                        )}

                        <ScrollView style={styles.searchResultsList} showsVerticalScrollIndicator={false}>
                            {searchResults.map((item) => {
                                const coverUrl = getCoverUrl(item);
                                return (
                                    <TouchableOpacity
                                        key={item.id}
                                        style={styles.searchResultItem}
                                        onPress={() => handleCollectableSelect(item)}
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
                        </ScrollView>
                    </Animated.View>
                );

            case STEPS.CONFIRM:
                const coverUrl = getCoverUrl(selectedCollectable);
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
                                                <Text style={styles.previewTitle} numberOfLines={2}>{selectedCollectable?.title}</Text>
                                                {selectedCollectable?.primaryCreator && (
                                                    <Text style={styles.previewSubtitle}>{selectedCollectable.primaryCreator}</Text>
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
                                                <Text style={[styles.visibilityText, visibility === 'friends' && styles.visibilityTextActive]}>Friends</Text>
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
