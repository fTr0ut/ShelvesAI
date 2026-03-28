import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Image,
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

/**
 * Hook: manages global search state and handlers.
 * Used with GlobalSearchInput (header) + GlobalSearchOverlay (screen level).
 */
export function useGlobalSearch(navigation) {
    const { token, apiBase } = useContext(AuthContext);

    const [query, setQuery] = useState('');
    const [results, setResults] = useState({ friends: [], collectables: [] });
    const [loading, setLoading] = useState(false);
    const [showResults, setShowResults] = useState(false);
    const timeoutRef = useRef(null);
    const isMountedRef = useRef(true);

    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
        };
    }, []);

    const handleChange = useCallback((text) => {
        setQuery(text);
        if (timeoutRef.current) clearTimeout(timeoutRef.current);

        if (!text.trim()) {
            setResults({ friends: [], collectables: [] });
            setShowResults(false);
            return;
        }

        timeoutRef.current = setTimeout(async () => {
            if (!isMountedRef.current) return;
            setLoading(true);
            setShowResults(true);

            try {
                const [friendsRes, collectablesRes] = await Promise.all([
                    apiRequest({ apiBase, path: `/api/friends/search?q=${encodeURIComponent(text)}&limit=3&wildcard=true`, token }),
                    apiRequest({ apiBase, path: `/api/collectables?q=${encodeURIComponent(text)}&limit=3&wildcard=true`, token }),
                ]);
                if (!isMountedRef.current) return;
                setResults({
                    friends: friendsRes?.users || [],
                    collectables: collectablesRes?.results || [],
                });
            } catch (err) {
                console.error('Search error:', err);
            } finally {
                if (isMountedRef.current) setLoading(false);
            }
        }, 300);
    }, [apiBase, token]);

    const handleFriendPress = useCallback((friend) => {
        setShowResults(false);
        setQuery('');
        navigation.navigate('Profile', { username: friend.username });
    }, [navigation]);

    const handleCollectablePress = useCallback((collectable) => {
        setShowResults(false);
        setQuery('');
        navigation.navigate('CollectableDetail', { item: { collectable } });
    }, [navigation]);

    const handleSeeMore = useCallback(() => {
        const currentQuery = query;
        setShowResults(false);
        setQuery('');
        navigation.navigate('FriendSearch', { initialQuery: currentQuery });
    }, [navigation, query]);

    const dismiss = useCallback(() => setShowResults(false), []);

    const handleFocus = useCallback(() => {
        if (query.trim()) setShowResults(true);
    }, [query]);

    const clear = useCallback(() => {
        setQuery('');
        setShowResults(false);
    }, []);

    return {
        query, results, loading, showResults, apiBase,
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

    return (
        <View style={[styles.container, style]}>
            <Ionicons name="search" size={16} color={colors.textMuted} />
            <TextInput
                style={styles.input}
                placeholder="Search Titles, Creators, or Friends"
                placeholderTextColor={colors.textMuted}
                value={search.query}
                onChangeText={search.handleChange}
                onFocus={search.handleFocus}
            />
            {search.query.length > 0 && (
                <TouchableOpacity onPress={search.clear}>
                    <Ionicons name="close-circle" size={16} color={colors.textMuted} />
                </TouchableOpacity>
            )}
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
                                        <Text style={styles.sectionTitle}>Items</Text>
                                        {search.results.collectables.map((item) => {
                                            const coverUrl = resolveCollectableCoverUrl(item, search.apiBase);
                                            return (
                                                <TouchableOpacity
                                                    key={item.id}
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
                                                    </View>
                                                    <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
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
