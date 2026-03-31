import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Image,
    Keyboard,
    Modal,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    TouchableWithoutFeedback,
    View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AuthContext } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { apiRequest } from '../../services/api';
import { resolveCollectableCoverUrl } from '../../utils/coverUrl';
import { formatCollectableSearchMeta } from '../../utils/collectableDisplay';

const SEARCH_TYPE_OPTIONS = [
    { label: 'All', value: '' },
    { label: 'Books', value: 'books' },
    { label: 'Movies', value: 'movies' },
    { label: 'Games', value: 'games' },
    { label: 'TV', value: 'tv' },
    { label: 'Vinyl', value: 'vinyl' },
];
const SEARCH_DEBOUNCE_MS = 800;
const SEARCH_CACHE_TTL_MS = 2 * 60 * 1000;
const MAX_SEARCH_CACHE_ENTRIES = 150;
const MIN_FALLBACK_QUERY_LENGTH = 3;
const SEE_MORE_FALLBACK_LIMIT = 25;

function getCollectableTypeLabel(item, selectedType = '') {
    const raw = String(item?.kind || item?.type || selectedType || '').trim().toLowerCase();
    if (!raw) return 'Item';

    if (raw === 'book' || raw === 'books') return 'Book';
    if (raw === 'movie' || raw === 'movies' || raw === 'film' || raw === 'films') return 'Movie';
    if (raw === 'game' || raw === 'games') return 'Game';
    if (raw === 'tv' || raw === 'show' || raw === 'shows' || raw === 'series') return 'TV';
    if (raw === 'vinyl' || raw === 'album' || raw === 'albums' || raw === 'record' || raw === 'records') return 'Vinyl';
    if (raw === 'other') return 'Other';

    return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/**
 * Hook: manages global search state and handlers.
 * Used with GlobalSearchInput (header) + GlobalSearchOverlay (screen level).
 */
export function useGlobalSearch(navigation) {
    const { token, apiBase } = useContext(AuthContext);

    const [query, setQuery] = useState('');
    const [selectedType, setSelectedType] = useState('');
    const [showTypePicker, setShowTypePicker] = useState(false);
    const [results, setResults] = useState({ friends: [], collectables: [] });
    const [searchMeta, setSearchMeta] = useState({ searched: { local: false, api: false }, resolvedContainer: null });
    const [loading, setLoading] = useState(false);
    const [showResults, setShowResults] = useState(false);
    const [resolving, setResolving] = useState(false);
    const timeoutRef = useRef(null);
    const isMountedRef = useRef(true);
    const requestSeqRef = useRef(0);
    const queryRef = useRef('');
    const searchCacheRef = useRef(new Map());

    const buildCacheKey = useCallback((text, type) => {
        const normalizedQuery = String(text || '').trim().toLowerCase();
        const normalizedType = String(type || '').trim().toLowerCase() || 'all';
        return `${normalizedType}::${normalizedQuery}`;
    }, []);

    const getCachedSearch = useCallback((cacheKey) => {
        const entry = searchCacheRef.current.get(cacheKey);
        if (!entry) return null;
        if (entry.expiresAt <= Date.now()) {
            searchCacheRef.current.delete(cacheKey);
            return null;
        }
        return entry;
    }, []);

    const setCachedSearch = useCallback((cacheKey, value) => {
        if (searchCacheRef.current.size >= MAX_SEARCH_CACHE_ENTRIES) {
            const firstKey = searchCacheRef.current.keys().next().value;
            if (firstKey) searchCacheRef.current.delete(firstKey);
        }
        searchCacheRef.current.set(cacheKey, {
            ...value,
            expiresAt: Date.now() + SEARCH_CACHE_TTL_MS,
        });
    }, []);

    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
        };
    }, []);

    const handleChange = useCallback((text) => {
        queryRef.current = text;
        setQuery(text);
        if (timeoutRef.current) clearTimeout(timeoutRef.current);

        if (!text.trim()) {
            requestSeqRef.current += 1;
            queryRef.current = '';
            setResults({ friends: [], collectables: [] });
            setSearchMeta({ searched: { local: false, api: false }, resolvedContainer: null });
            setShowResults(false);
            return;
        }

        timeoutRef.current = setTimeout(async () => {
            const requestSeq = ++requestSeqRef.current;
            if (!isMountedRef.current) return;
            setLoading(true);
            setShowResults(true);

            try {
                const trimmedText = text.trim();
                const cacheKey = buildCacheKey(trimmedText, selectedType);
                const cached = getCachedSearch(cacheKey);
                if (cached) {
                    setResults({
                        friends: cached.friends || [],
                        collectables: cached.collectables || [],
                    });
                    setSearchMeta(cached.searchMeta || { searched: { local: true, api: false }, resolvedContainer: null });
                    return;
                }

                const encodedType = selectedType ? `&type=${encodeURIComponent(selectedType)}` : '';
                const shouldUseFallbackApi = trimmedText.length >= MIN_FALLBACK_QUERY_LENGTH;
                const [friendsRes, collectablesRes] = await Promise.all([
                    apiRequest({ apiBase, path: `/api/friends/search?q=${encodeURIComponent(text)}&limit=3&wildcard=true`, token }),
                    apiRequest({
                        apiBase,
                        path: `/api/collectables?q=${encodeURIComponent(text)}&limit=3&wildcard=true&fallbackApi=${shouldUseFallbackApi ? 'true' : 'false'}${encodedType}`,
                        token,
                    }),
                ]);
                if (!isMountedRef.current || requestSeq !== requestSeqRef.current) return;
                const nextResults = {
                    friends: friendsRes?.users || [],
                    collectables: collectablesRes?.results || [],
                };
                const nextMeta = {
                    searched: collectablesRes?.searched || { local: true, api: false },
                    resolvedContainer: collectablesRes?.resolvedContainer || null,
                };

                setResults(nextResults);
                setSearchMeta(nextMeta);
                setCachedSearch(cacheKey, {
                    friends: nextResults.friends,
                    collectables: nextResults.collectables,
                    searchMeta: nextMeta,
                });
            } catch (err) {
                console.error('Search error:', err);
            } finally {
                if (isMountedRef.current) setLoading(false);
            }
        }, SEARCH_DEBOUNCE_MS);
    }, [apiBase, buildCacheKey, getCachedSearch, selectedType, setCachedSearch, token]);

    const handleFriendPress = useCallback((friend) => {
        setShowResults(false);
        setQuery('');
        navigation.navigate('Profile', { username: friend.username });
    }, [navigation]);

    const handleCollectablePress = useCallback(async (collectable) => {
        try {
            setResolving(true);
            let resolvedCollectable = collectable;
            if (collectable?.fromApi) {
                const resolveRes = await apiRequest({
                    apiBase,
                    path: '/api/collectables/resolve-search-hit',
                    method: 'POST',
                    token,
                    body: {
                        candidate: collectable,
                        selectedType: selectedType || null,
                    },
                });
                if (resolveRes?.collectable) {
                    resolvedCollectable = resolveRes.collectable;
                }
            }

            setShowResults(false);
            setQuery('');
            navigation.navigate('CollectableDetail', { item: { collectable: resolvedCollectable } });
        } catch (err) {
            console.error('resolve-search-hit error:', err);
        } finally {
            setResolving(false);
        }
    }, [apiBase, navigation, selectedType, token]);

    const handleSeeMore = useCallback(() => {
        const currentQuery = query.trim();
        const hasApiResults = Boolean(searchMeta?.searched?.api)
            || results.collectables.some((entry) => entry?.fromApi);
        const hasLocalCollectableResults = results.collectables.some((entry) => !entry?.fromApi);
        const shouldSupplementWithApi = Boolean(selectedType) && !hasApiResults && hasLocalCollectableResults;
        setShowResults(false);
        setQuery('');
        navigation.navigate('FriendSearch', {
            initialQuery: currentQuery,
            initialType: selectedType || '',
            initialTab: 'items',
            initialUseApiFallback: hasApiResults || shouldSupplementWithApi,
            initialApiSupplement: shouldSupplementWithApi,
            initialFallbackLimit: (hasApiResults || shouldSupplementWithApi) ? SEE_MORE_FALLBACK_LIMIT : undefined,
        });
    }, [navigation, query, results.collectables, searchMeta, selectedType]);

    const dismiss = useCallback(() => setShowResults(false), []);

    const handleFocus = useCallback(() => {
        if (query.trim()) setShowResults(true);
    }, [query]);

    const clear = useCallback(() => {
        requestSeqRef.current += 1;
        queryRef.current = '';
        setQuery('');
        setShowResults(false);
        setSearchMeta({ searched: { local: false, api: false }, resolvedContainer: null });
    }, []);

    const selectedTypeOption = SEARCH_TYPE_OPTIONS.find((entry) => entry.value === selectedType) || SEARCH_TYPE_OPTIONS[0];

    const selectType = useCallback((nextType) => {
        setSelectedType(nextType);
        setShowTypePicker(false);
    }, []);

    useEffect(() => {
        if (!queryRef.current.trim()) return;
        handleChange(queryRef.current);
    }, [handleChange, selectedType]);

    return {
        query, results, loading, showResults, apiBase, searchMeta, resolving,
        selectedType,
        selectedTypeLabel: selectedTypeOption.label,
        typeOptions: SEARCH_TYPE_OPTIONS,
        showTypePicker,
        openTypePicker: () => setShowTypePicker(true),
        closeTypePicker: () => setShowTypePicker(false),
        selectType,
        handleChange, handleFocus, dismiss, clear,
        handleFriendPress, handleCollectablePress, handleSeeMore,
    };
}

/**
 * Search input bar — renders inline in the header row.
 */
export function GlobalSearchInput({ search, style }) {
    const { colors, spacing, shadows } = useTheme();
    const styles = useMemo(() => createInputStyles({ colors, spacing, shadows }), [colors, spacing, shadows]);
    const inputRef = useRef(null);

    const handleDonePress = useCallback(() => {
        inputRef.current?.blur?.();
        Keyboard.dismiss();
    }, []);

    return (
        <View style={[styles.container, style]}>
            <Ionicons name="search" size={16} color={colors.textMuted} />
            <TextInput
                ref={inputRef}
                style={styles.input}
                placeholder="Search Titles, Creators, or Friends"
                placeholderTextColor={colors.textMuted}
                value={search.query}
                onChangeText={search.handleChange}
                onFocus={search.handleFocus}
            />
            <TouchableOpacity style={styles.typeChip} onPress={search.openTypePicker}>
                <Text style={styles.typeChipText}>{search.selectedTypeLabel}</Text>
                <Ionicons name="chevron-down" size={12} color={colors.textMuted} />
            </TouchableOpacity>
            {search.query.length > 0 && (
                <TouchableOpacity style={styles.doneButton} onPress={handleDonePress}>
                    <Text style={styles.doneButtonText}>Done</Text>
                </TouchableOpacity>
            )}
            {search.query.length > 0 && (
                <TouchableOpacity onPress={search.clear}>
                    <Ionicons name="close-circle" size={16} color={colors.textMuted} />
                </TouchableOpacity>
            )}
            <Modal
                visible={search.showTypePicker}
                transparent
                animationType="fade"
                onRequestClose={search.closeTypePicker}
            >
                <Pressable style={styles.typeModalOverlay} onPress={search.closeTypePicker}>
                    <Pressable style={styles.typeModalCard} onPress={() => {}}>
                        {search.typeOptions.map((option) => {
                            const selected = option.value === search.selectedType;
                            return (
                                <TouchableOpacity
                                    key={option.label}
                                    style={styles.typeModalOption}
                                    onPress={() => search.selectType(option.value)}
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
        </View>
    );
}

/**
 * Search overlay + dropdown — renders at screen level (inside a flex:1 body wrapper)
 * so it covers the body without shading the header and without stealing TextInput focus.
 */
export function GlobalSearchOverlay({ search }) {
    const { colors, spacing, shadows } = useTheme();
    const styles = useMemo(() => createOverlayStyles({ colors, spacing, shadows }), [colors, spacing, shadows]);

    if (!search.showResults) return null;

    return (
        <TouchableWithoutFeedback onPress={search.dismiss}>
            <View style={styles.overlay}>
                <TouchableWithoutFeedback>
                    <View style={styles.dropdown}>
                        {search.loading ? (
                            <View style={styles.loadingContainer}>
                                <ActivityIndicator size="small" color={colors.primary} />
                            </View>
                        ) : (
                            <>
                                {/* Friends */}
                                {search.results.friends.length > 0 && (
                                    <View style={styles.section}>
                                        <Text style={styles.sectionTitle}>Friends</Text>
                                        {search.results.friends.map((friend) => {
                                            const displayName = friend.firstName && friend.lastName
                                                ? `${friend.firstName} ${friend.lastName}`
                                                : friend.name || friend.username;
                                            return (
                                                <TouchableOpacity
                                                    key={friend.id}
                                                    style={styles.resultItem}
                                                    onPress={() => search.handleFriendPress(friend)}
                                                >
                                                    <View style={styles.avatar}>
                                                        <Text style={styles.avatarText}>
                                                            {(displayName || '?').charAt(0).toUpperCase()}
                                                        </Text>
                                                    </View>
                                                    <View style={styles.resultInfo}>
                                                        <Text style={styles.resultTitle} numberOfLines={1}>{displayName}</Text>
                                                        <Text style={styles.resultSubtitle} numberOfLines={1}>@{friend.username}</Text>
                                                    </View>
                                                    <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                                                </TouchableOpacity>
                                            );
                                        })}
                                    </View>
                                )}

                                {/* Collectables */}
                                {search.results.collectables.length > 0 && (
                                    <View style={styles.section}>
                                        <Text style={styles.sectionTitle}>
                                            Items • {search.selectedTypeLabel}
                                        </Text>
                                        {search.results.collectables.map((item, index) => {
                                            const coverUrl = resolveCollectableCoverUrl(item, search.apiBase);
                                            const key = item.id
                                                ? `id-${item.id}`
                                                : `api-${item.source || 'api'}-${item.title || 'untitled'}-${index}`;
                                            const typeLabel = getCollectableTypeLabel(item, search.selectedType);
                                            const metadataLine = formatCollectableSearchMeta(item);
                                            return (
                                                <TouchableOpacity
                                                    key={key}
                                                    style={styles.resultItem}
                                                    onPress={() => search.handleCollectablePress(item)}
                                                >
                                                    {coverUrl ? (
                                                        <Image source={{ uri: coverUrl }} style={styles.cover} />
                                                    ) : (
                                                        <View style={[styles.cover, styles.coverFallback]}>
                                                            <Ionicons name="book" size={16} color={colors.primary} />
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
                                                        <View style={styles.sourceChip}>
                                                            <Text style={styles.sourceChipText}>
                                                                {typeLabel}
                                                            </Text>
                                                        </View>
                                                    </View>
                                                    {search.resolving ? (
                                                        <ActivityIndicator size="small" color={colors.primary} />
                                                    ) : (
                                                        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                                                    )}
                                                </TouchableOpacity>
                                            );
                                        })}
                                    </View>
                                )}

                                {/* Empty */}
                                {search.results.friends.length === 0 && search.results.collectables.length === 0 && (
                                    <View style={styles.emptyState}>
                                        <Ionicons name="search-outline" size={24} color={colors.textMuted} />
                                        <Text style={styles.emptyText}>No results found</Text>
                                    </View>
                                )}

                                {/* See more */}
                                {(search.results.friends.length > 0 || search.results.collectables.length > 0) && (
                                    <TouchableOpacity style={styles.seeMoreButton} onPress={search.handleSeeMore}>
                                        <Text style={styles.seeMoreText}>See more results</Text>
                                        <Ionicons name="arrow-forward" size={14} color={colors.primary} />
                                    </TouchableOpacity>
                                )}
                            </>
                        )}
                    </View>
                </TouchableWithoutFeedback>
            </View>
        </TouchableWithoutFeedback>
    );
}

const createInputStyles = ({ colors, spacing, shadows }) => StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.surface,
        borderRadius: 20,
        paddingHorizontal: spacing.md,
        paddingVertical: 8,
        gap: 8,
        ...shadows.sm,
    },
    input: {
        flex: 1,
        fontSize: 15,
        color: colors.text,
        paddingVertical: 0,
    },
    typeChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 4,
        backgroundColor: colors.surfaceElevated,
    },
    typeChipText: {
        fontSize: 12,
        fontWeight: '600',
        color: colors.text,
    },
    doneButton: {
        paddingHorizontal: 2,
        paddingVertical: 2,
    },
    doneButtonText: {
        fontSize: 12,
        fontWeight: '700',
        color: colors.primary,
    },
    typeModalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.35)',
        justifyContent: 'center',
        paddingHorizontal: spacing.lg,
    },
    typeModalCard: {
        backgroundColor: colors.surface,
        borderRadius: 14,
        paddingVertical: spacing.sm,
        ...shadows.md,
    },
    typeModalOption: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
    },
    typeModalOptionText: {
        fontSize: 15,
        color: colors.text,
    },
    typeModalOptionTextSelected: {
        fontWeight: '700',
        color: colors.primary,
    },
});

const createOverlayStyles = ({ colors, spacing, shadows }) => StyleSheet.create({
    overlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.3)',
        zIndex: 100,
    },
    dropdown: {
        marginHorizontal: spacing.md,
        marginTop: spacing.sm,
        backgroundColor: colors.surface,
        borderRadius: 16,
        ...shadows.lg,
        maxHeight: 450,
        overflow: 'hidden',
    },
    loadingContainer: {
        padding: spacing.lg,
        alignItems: 'center',
    },
    section: {
        paddingBottom: spacing.md,
    },
    sectionTitle: {
        fontSize: 12,
        fontWeight: '600',
        color: colors.textMuted,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        paddingHorizontal: spacing.md,
        paddingTop: spacing.md,
        paddingBottom: spacing.xs,
    },
    resultItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.md,
        gap: spacing.md,
    },
    avatar: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: colors.primary,
        justifyContent: 'center',
        alignItems: 'center',
    },
    avatarText: {
        color: colors.textInverted,
        fontWeight: '600',
        fontSize: 16,
    },
    cover: {
        width: 40,
        height: 54,
        borderRadius: 6,
        backgroundColor: colors.surfaceElevated,
    },
    coverFallback: {
        justifyContent: 'center',
        alignItems: 'center',
    },
    resultInfo: {
        flex: 1,
    },
    resultTitle: {
        fontSize: 15,
        fontWeight: '600',
        color: colors.text,
    },
    resultSubtitle: {
        fontSize: 13,
        color: colors.textMuted,
        marginTop: 2,
    },
    resultMetaText: {
        fontSize: 11,
        color: colors.textMuted,
        marginTop: 2,
    },
    sourceChip: {
        alignSelf: 'flex-start',
        marginTop: 6,
        backgroundColor: colors.surfaceElevated,
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 2,
    },
    sourceChipText: {
        fontSize: 10,
        fontWeight: '600',
        color: colors.textMuted,
        textTransform: 'uppercase',
        letterSpacing: 0.4,
    },
    emptyState: {
        alignItems: 'center',
        padding: spacing.xl,
        gap: spacing.md,
    },
    emptyText: {
        fontSize: 15,
        color: colors.textMuted,
    },
    seeMoreButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: spacing.lg,
        borderTopWidth: 1,
        borderTopColor: colors.border,
    },
    seeMoreText: {
        fontSize: 15,
        fontWeight: '500',
        color: colors.primary,
    },
});
