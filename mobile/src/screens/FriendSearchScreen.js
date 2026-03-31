import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Image,
    Keyboard,
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    StatusBar,
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
import { resolveCollectableCoverUrl } from '../utils/coverUrl';
import { formatCollectableSearchMeta } from '../utils/collectableDisplay';
import {
    buildCollectableItemKey,
    COLLECTABLE_SEARCH_TYPE_OPTIONS,
    DEFAULT_API_FALLBACK_RESULTS_LIMIT,
    useCollectableSearchEngine,
} from '../hooks/useCollectableSearchEngine';

const SEE_MORE_ALL_TYPE_DISCLAIMER = 'To see more results, tap the "All" filter above and choose a specific type.';

const DEFAULT_ADVANCED_OPTIONS = {
    forceApiFallback: false,
    forceApiSupplement: false,
    fallbackLimit: DEFAULT_API_FALLBACK_RESULTS_LIMIT,
};

function normalizeTypeValue(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized || normalized === 'all') return '';
    return normalized;
}

function normalizeAdvancedOptions(input = {}) {
    return {
        forceApiFallback: Boolean(input?.forceApiFallback),
        forceApiSupplement: Boolean(input?.forceApiSupplement),
        fallbackLimit: Number.isFinite(Number(input?.fallbackLimit))
            ? Math.max(1, Math.floor(Number(input?.fallbackLimit)))
            : DEFAULT_API_FALLBACK_RESULTS_LIMIT,
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

function normalizeFilterValue(value) {
    const trimmed = String(value ?? '').trim();
    if (!trimmed) return '';
    return trimmed.toLowerCase().replace(/\s+/g, ' ');
}

function normalizeYearValue(value) {
    const trimmed = String(value ?? '').trim();
    if (!trimmed) return null;
    const match = trimmed.match(/\b(19|20)\d{2}\b/);
    if (match?.[0]) return match[0];
    return trimmed;
}

function toArray(value) {
    if (value == null) return [];
    if (Array.isArray(value)) return value;
    return [value];
}

function toStringArray(value) {
    return toArray(value)
        .flatMap((entry) => {
            if (entry == null) return [];
            if (typeof entry === 'string') {
                return entry.split(',').map((part) => part.trim()).filter(Boolean);
            }
            if (typeof entry === 'number') return [String(entry)];
            return [];
        })
        .filter(Boolean);
}

function extractCreatorValue(item) {
    const candidates = [
        item?.primaryCreator,
        item?.author,
        item?.director,
        item?.developer,
    ];
    const creators = toStringArray(item?.creators);
    if (creators[0]) candidates.push(creators[0]);
    return candidates.find((candidate) => String(candidate ?? '').trim()) || null;
}

function extractYearValue(item) {
    return normalizeYearValue(item?.year || item?.releaseYear || item?.publishYear);
}

function extractGenreValues(item) {
    return toStringArray(item?.genre ?? item?.genres);
}

function extractPlatformValue(item) {
    const candidates = [
        item?.systemName,
        item?.platform,
    ];
    const platforms = toStringArray(item?.platforms);
    if (platforms[0]) candidates.push(platforms[0]);
    return candidates.find((candidate) => String(candidate ?? '').trim()) || null;
}

function addFilterOption(optionMap, value) {
    const display = String(value ?? '').trim();
    if (!display) return;
    const key = normalizeFilterValue(display);
    if (!key || optionMap.has(key)) return;
    optionMap.set(key, display);
}

export default function FriendSearchScreen({ route, navigation }) {
    const {
        initialQuery = '',
        initialType = '',
        initialTab = 'items',
        initialUseApiFallback = false,
        initialApiSupplement = false,
        initialFallbackLimit,
    } = route.params || {};
    const { token, apiBase, user: currentUser } = useContext(AuthContext);
    const { colors, spacing, shadows, radius, isDark } = useTheme();

    const [query, setQuery] = useState(initialQuery || '');
    const [activeTab, setActiveTab] = useState(initialTab === 'friends' ? 'friends' : 'items');
    const [friendResults, setFriendResults] = useState([]);
    const [friendsLoading, setFriendsLoading] = useState(false);
    const [friendSearchRun, setFriendSearchRun] = useState(false);
    const [sending, setSending] = useState({});
    const [selectedType, setSelectedType] = useState(normalizeTypeValue(initialType));
    const [selectedPlatform, setSelectedPlatform] = useState('');
    const [showTypePicker, setShowTypePicker] = useState(false);
    const [filterPickerKey, setFilterPickerKey] = useState('');
    const [filterInputValue, setFilterInputValue] = useState('');
    const [activeCreator, setActiveCreator] = useState('');
    const [activeYear, setActiveYear] = useState('');
    const [activeGenre, setActiveGenre] = useState('');
    const [activePlatform, setActivePlatform] = useState('');
    const [resolvingItemKey, setResolvingItemKey] = useState(null);
    const [searchMoreLoading, setSearchMoreLoading] = useState(false);
    const [lastItemSearchHadApi, setLastItemSearchHadApi] = useState(false);
    const [lastItemSearchType, setLastItemSearchType] = useState(normalizeTypeValue(initialType));
    const [searchOptions, setSearchOptions] = useState(() => normalizeAdvancedOptions({
        forceApiFallback: initialUseApiFallback,
        forceApiSupplement: initialApiSupplement,
        fallbackLimit: initialFallbackLimit,
    }));
    const friendsPrefetched = useRef(false);
    const initialSearchHandled = useRef(false);
    const processedAdvancedReturnToken = useRef(null);
    const startedWithAllTypeRef = useRef(normalizeTypeValue(initialType) === '');
    const searchInputRef = useRef(null);

    const {
        results: itemResults,
        loading: itemLoading,
        loadingMore: itemLoadingMore,
        searched: itemSearched,
        pagination: itemPagination,
        search: searchItems,
        loadMore: loadMoreItems,
        reset: resetItems,
    } = useCollectableSearchEngine({
        apiBase,
        token,
        defaultApiSupplement: false,
        defaultFallbackLimit: DEFAULT_API_FALLBACK_RESULTS_LIMIT,
        debugTag: 'FriendSearchDebug',
    });

    const styles = useMemo(
        () => createStyles({ colors, spacing, shadows, radius }),
        [colors, spacing, shadows, radius],
    );

    const selectedTypeOption = useMemo(() => (
        COLLECTABLE_SEARCH_TYPE_OPTIONS.find((entry) => entry.value === selectedType)
        || COLLECTABLE_SEARCH_TYPE_OPTIONS[0]
    ), [selectedType]);

    const {
        creatorOptions,
        yearOptions,
        genreOptions,
        platformOptions,
    } = useMemo(() => {
        const creatorMap = new Map();
        const yearMap = new Map();
        const genreMap = new Map();
        const platformMap = new Map();

        itemResults.forEach((entry) => {
            addFilterOption(creatorMap, extractCreatorValue(entry));
            addFilterOption(yearMap, extractYearValue(entry));
            extractGenreValues(entry).forEach((genre) => addFilterOption(genreMap, genre));
            addFilterOption(platformMap, extractPlatformValue(entry));
        });

        const toOptionList = (optionMap) => (
            Array.from(optionMap.entries()).map(([key, label]) => ({ key, label }))
        );

        const years = toOptionList(yearMap).sort((a, b) => {
            const yearA = Number.parseInt(a.key, 10);
            const yearB = Number.parseInt(b.key, 10);
            if (Number.isFinite(yearA) && Number.isFinite(yearB) && yearA !== yearB) {
                return yearB - yearA;
            }
            return b.label.localeCompare(a.label);
        });

        return {
            creatorOptions: toOptionList(creatorMap),
            yearOptions: years,
            genreOptions: toOptionList(genreMap),
            platformOptions: toOptionList(platformMap),
        };
    }, [itemResults]);

    const hasActiveItemFilters = Boolean(activeCreator || activeYear || activeGenre || activePlatform);

    const filteredItemResults = useMemo(() => itemResults.filter((entry) => {
        if (activeCreator && normalizeFilterValue(extractCreatorValue(entry)) !== activeCreator) return false;
        if (activeYear && normalizeFilterValue(extractYearValue(entry)) !== activeYear) return false;
        if (activeGenre) {
            const entryGenreKeys = extractGenreValues(entry).map(normalizeFilterValue).filter(Boolean);
            if (!entryGenreKeys.includes(activeGenre)) return false;
        }
        if (activePlatform && normalizeFilterValue(extractPlatformValue(entry)) !== activePlatform) return false;
        return true;
    }), [activeCreator, activeGenre, activePlatform, activeYear, itemResults]);

    const selectedCreatorLabel = useMemo(
        () => creatorOptions.find((entry) => entry.key === activeCreator)?.label || activeCreator,
        [activeCreator, creatorOptions],
    );
    const selectedYearLabel = useMemo(
        () => yearOptions.find((entry) => entry.key === activeYear)?.label || activeYear,
        [activeYear, yearOptions],
    );
    const selectedGenreLabel = useMemo(
        () => genreOptions.find((entry) => entry.key === activeGenre)?.label || activeGenre,
        [activeGenre, genreOptions],
    );
    const selectedPlatformLabel = useMemo(
        () => platformOptions.find((entry) => entry.key === activePlatform)?.label || activePlatform,
        [activePlatform, platformOptions],
    );

    const showPlatformFilterChip = selectedType === 'games' || platformOptions.length > 0;

    const getFriendFromFriendship = useCallback((friendship) => {
        if (!friendship) return null;
        if (currentUser?.id && friendship.requester?.id && friendship.addressee?.id) {
            return friendship.requester.id === currentUser.id
                ? friendship.addressee
                : friendship.requester;
        }
        if (friendship.isRequester && friendship.addressee) return friendship.addressee;
        return friendship.requester || friendship.addressee || null;
    }, [currentUser]);

    const executeFriendSearch = useCallback(async (searchText) => {
        const trimmed = String(searchText || '').trim();
        if (!trimmed) {
            setFriendResults([]);
            setFriendSearchRun(false);
            return [];
        }

        setFriendsLoading(true);
        try {
            const response = await apiRequest({
                apiBase,
                path: `/api/friends/search?q=${encodeURIComponent(trimmed)}&wildcard=true`,
                token,
            });
            const users = Array.isArray(response?.users) ? response.users : [];
            setFriendResults(users);
            setFriendSearchRun(true);
            return users;
        } finally {
            setFriendsLoading(false);
        }
    }, [apiBase, token]);

    const executeItemSearch = useCallback(async ({
        searchText,
        type = selectedType,
        platform = selectedPlatform,
        options = searchOptions,
    }) => {
        const trimmed = String(searchText || '').trim();
        if (!trimmed) {
            resetItems();
            setLastItemSearchHadApi(false);
            return [];
        }

        const normalizedType = normalizeTypeValue(type);
        const resolvedOptions = normalizeAdvancedOptions(options);
        const response = await searchItems({
            query: trimmed,
            type: normalizedType,
            platform,
            forceApiFallback: resolvedOptions.forceApiFallback,
            forceApiSupplement: resolvedOptions.forceApiSupplement,
            fallbackLimit: resolvedOptions.fallbackLimit,
        });

        const results = Array.isArray(response?.results) ? response.results : [];
        const hasApiResults = results.some((entry) => entry?.fromApi);
        const searchedApi = Boolean(response?.response?.searched?.api) || hasApiResults;
        setLastItemSearchHadApi(searchedApi);
        setLastItemSearchType(normalizedType);
        return results;
    }, [resetItems, searchItems, searchOptions, selectedPlatform, selectedType]);

    const runSearch = useCallback(async ({
        searchText,
        type = selectedType,
        platform = selectedPlatform,
        options = searchOptions,
        includeFriends = true,
    } = {}) => {
        const trimmed = String(searchText || '').trim();
        if (!trimmed) {
            setFriendResults([]);
            setFriendSearchRun(false);
            resetItems();
            return;
        }

        const normalizedType = normalizeTypeValue(type);
        const normalizedPlatform = String(platform || '').trim();
        const resolvedOptions = normalizeAdvancedOptions(options);
        setSelectedType(normalizedType);
        setSelectedPlatform(normalizedPlatform);
        setSearchOptions(resolvedOptions);

        const tasks = [
            executeItemSearch({
                searchText: trimmed,
                type: normalizedType,
                platform: normalizedPlatform,
                options: resolvedOptions,
            }),
        ];

        if (includeFriends) {
            tasks.push(executeFriendSearch(trimmed));
        }

        await Promise.all(tasks);
    }, [executeFriendSearch, executeItemSearch, resetItems, searchOptions, selectedPlatform, selectedType]);

    const handleSearchPress = useCallback(async () => {
        const trimmed = query.trim();
        if (!trimmed) return;

        Keyboard.dismiss();
        try {
            await runSearch({ searchText: trimmed, includeFriends: true });
        } catch (err) {
            Alert.alert('Error', err?.message || 'Search failed');
        }
    }, [query, runSearch]);

    const handleKeyboardDone = useCallback(() => {
        searchInputRef.current?.blur?.();
        Keyboard.dismiss();
    }, []);

    const clearSearch = useCallback(() => {
        setQuery('');
        setSelectedPlatform('');
        setSearchOptions(DEFAULT_ADVANCED_OPTIONS);
        setFilterPickerKey('');
        setActiveCreator('');
        setActiveYear('');
        setActiveGenre('');
        setActivePlatform('');
        setFriendResults([]);
        setFriendSearchRun(false);
        setLastItemSearchHadApi(false);
        setLastItemSearchType('');
        resetItems();
    }, [resetItems]);

    useEffect(() => {
        if (activeCreator && !creatorOptions.some((entry) => entry.key === activeCreator)) {
            setActiveCreator('');
        }
    }, [activeCreator, creatorOptions]);

    useEffect(() => {
        if (activeYear && !yearOptions.some((entry) => entry.key === activeYear)) {
            setActiveYear('');
        }
    }, [activeYear, yearOptions]);

    useEffect(() => {
        if (activeGenre && !genreOptions.some((entry) => entry.key === activeGenre)) {
            setActiveGenre('');
        }
    }, [activeGenre, genreOptions]);

    useEffect(() => {
        if (activePlatform && !platformOptions.some((entry) => entry.key === activePlatform)) {
            setActivePlatform('');
        }
    }, [activePlatform, platformOptions]);

    useEffect(() => {
        if (!filterPickerKey) {
            setFilterInputValue('');
            return;
        }
        if (filterPickerKey === 'creator') {
            setFilterInputValue(selectedCreatorLabel || '');
            return;
        }
        if (filterPickerKey === 'year') {
            setFilterInputValue(selectedYearLabel || '');
            return;
        }
        if (filterPickerKey === 'genre') {
            setFilterInputValue(selectedGenreLabel || '');
            return;
        }
        if (filterPickerKey === 'platform') {
            setFilterInputValue(selectedPlatformLabel || '');
        }
    }, [
        filterPickerKey,
        selectedCreatorLabel,
        selectedGenreLabel,
        selectedPlatformLabel,
        selectedYearLabel,
    ]);

    const preloadFriends = useCallback(async () => {
        setFriendsLoading(true);
        try {
            const data = await apiRequest({ apiBase, path: '/api/friends', token });
            const friendships = Array.isArray(data?.friendships) ? data.friendships : [];
            const friends = friendships
                .filter((entry) => entry.status === 'accepted')
                .map((entry) => {
                    const friend = getFriendFromFriendship(entry);
                    if (!friend) return null;
                    return {
                        ...friend,
                        isFriend: true,
                    };
                })
                .filter(Boolean);
            setFriendResults(friends);
        } catch (err) {
            Alert.alert('Error', err?.message || 'Failed to preload friends');
        } finally {
            setFriendsLoading(false);
        }
    }, [apiBase, getFriendFromFriendship, token]);

    useEffect(() => {
        if (activeTab !== 'friends' || friendsPrefetched.current || friendSearchRun) return;
        friendsPrefetched.current = true;
        preloadFriends();
    }, [activeTab, friendSearchRun, preloadFriends]);

    useEffect(() => {
        if (initialSearchHandled.current) return;
        const trimmed = String(initialQuery || '').trim();
        if (!trimmed) {
            initialSearchHandled.current = true;
            return;
        }

        initialSearchHandled.current = true;
        const options = normalizeAdvancedOptions({
            forceApiFallback: initialUseApiFallback,
            forceApiSupplement: initialApiSupplement,
            fallbackLimit: initialFallbackLimit,
        });

        runSearch({
            searchText: trimmed,
            type: normalizeTypeValue(initialType),
            platform: '',
            options,
            includeFriends: true,
        }).catch((err) => {
            Alert.alert('Error', err?.message || 'Search failed');
        });
    }, [
        initialApiSupplement,
        initialFallbackLimit,
        initialQuery,
        initialType,
        initialUseApiFallback,
        runSearch,
    ]);

    useEffect(() => {
        const tokenValue = route.params?.advancedReturnToken;
        if (!tokenValue || processedAdvancedReturnToken.current === tokenValue) return;

        processedAdvancedReturnToken.current = tokenValue;
        const nextQuery = String(route.params?.advancedQuery || '').trim();
        const nextType = normalizeTypeValue(route.params?.advancedType);
        const nextPlatform = String(route.params?.advancedPlatform || '').trim();
        const nextOptions = normalizeAdvancedOptions(route.params?.advancedOptions || {});

        navigation.setParams({
            advancedReturnToken: undefined,
            advancedQuery: undefined,
            advancedType: undefined,
            advancedPlatform: undefined,
            advancedOptions: undefined,
        });

        if (!nextQuery) return;

        setActiveTab('items');
        setQuery(nextQuery);
        runSearch({
            searchText: nextQuery,
            type: nextType,
            platform: nextPlatform,
            options: nextOptions,
            includeFriends: false,
        }).catch((err) => {
            Alert.alert('Error', err?.message || 'Search failed');
        });
    }, [navigation, route.params, runSearch]);

    const handleSendRequest = useCallback(async (targetUserId) => {
        setSending((prev) => ({ ...prev, [targetUserId]: true }));
        try {
            await apiRequest({
                apiBase,
                path: '/api/friends/request',
                method: 'POST',
                token,
                body: { targetUserId },
            });
            setFriendResults((prev) => prev.map((entry) => {
                if (entry.id !== targetUserId) return entry;
                return {
                    ...entry,
                    requestSent: true,
                    isFriend: entry.isFriend === true ? true : 'pending',
                };
            }));
        } catch (err) {
            Alert.alert('Error', err?.message || 'Failed to send request');
        } finally {
            setSending((prev) => ({ ...prev, [targetUserId]: false }));
        }
    }, [apiBase, token]);

    const handleItemPress = useCallback(async (item, index) => {
        const itemKey = buildCollectableItemKey(item, index);
        try {
            setResolvingItemKey(itemKey);
            let resolvedItem = item;
            if (item?.fromApi) {
                const response = await apiRequest({
                    apiBase,
                    path: '/api/collectables/resolve-search-hit',
                    method: 'POST',
                    token,
                    body: {
                        candidate: item,
                        selectedType: selectedType || null,
                    },
                });
                if (response?.collectable) {
                    resolvedItem = response.collectable;
                }
            }
            navigation.navigate('CollectableDetail', { item: { collectable: resolvedItem } });
        } catch (err) {
            Alert.alert('Error', err?.message || 'Unable to open collectable');
        } finally {
            setResolvingItemKey(null);
        }
    }, [apiBase, navigation, selectedType, token]);

    const handleOpenAdvanced = useCallback(() => {
        navigation.navigate('ItemSearch', {
            mode: 'advanced_from_friend',
            advancedQuery: query.trim(),
            advancedType: selectedType,
            advancedPlatform: selectedPlatform,
            advancedForceApiFallback: searchOptions.forceApiFallback,
            advancedApiSupplement: searchOptions.forceApiSupplement,
            advancedFallbackLimit: searchOptions.fallbackLimit,
        });
    }, [navigation, query, searchOptions.fallbackLimit, searchOptions.forceApiFallback, searchOptions.forceApiSupplement, selectedPlatform, selectedType]);

    const handleLoadMoreItems = useCallback(async () => {
        if (itemLoadingMore || itemLoading || !itemPagination?.hasMore) return;
        try {
            await loadMoreItems();
        } catch (err) {
            Alert.alert('Error', err?.message || 'Unable to load more results');
        }
    }, [itemLoading, itemLoadingMore, itemPagination?.hasMore, loadMoreItems]);

    const handleSearchMoreByType = useCallback(async () => {
        const trimmed = query.trim();
        if (!trimmed || !selectedType) return;

        try {
            setSearchMoreLoading(true);
            await runSearch({
                searchText: trimmed,
                type: selectedType,
                platform: selectedPlatform,
                options: {
                    ...searchOptions,
                    forceApiFallback: true,
                    forceApiSupplement: true,
                    fallbackLimit: searchOptions.fallbackLimit || DEFAULT_API_FALLBACK_RESULTS_LIMIT,
                },
                includeFriends: false,
            });
        } catch (err) {
            Alert.alert('Error', err?.message || 'Unable to load more results');
        } finally {
            setSearchMoreLoading(false);
        }
    }, [query, runSearch, searchOptions, selectedPlatform, selectedType]);

    const clearItemFilters = useCallback(() => {
        setActiveCreator('');
        setActiveYear('');
        setActiveGenre('');
        setActivePlatform('');
        setFilterPickerKey('');
    }, []);

    const filterPickerConfig = useMemo(() => {
        if (filterPickerKey === 'creator') {
            return { title: 'Filter by Creator', options: creatorOptions };
        }
        if (filterPickerKey === 'year') {
            return { title: 'Filter by Year', options: yearOptions };
        }
        if (filterPickerKey === 'genre') {
            return { title: 'Filter by Genre', options: genreOptions };
        }
        if (filterPickerKey === 'platform') {
            return { title: 'Filter by Platform', options: platformOptions };
        }
        return null;
    }, [creatorOptions, filterPickerKey, genreOptions, platformOptions, yearOptions]);

    const handleFilterOptionSelect = useCallback((value) => {
        if (filterPickerKey === 'creator') setActiveCreator(value);
        if (filterPickerKey === 'year') setActiveYear(value);
        if (filterPickerKey === 'genre') setActiveGenre(value);
        if (filterPickerKey === 'platform') setActivePlatform(value);
        setFilterPickerKey('');
    }, [filterPickerKey]);

    const handleApplyTypedFilter = useCallback(() => {
        const normalized = normalizeFilterValue(filterInputValue);
        handleFilterOptionSelect(normalized);
    }, [filterInputValue, handleFilterOptionSelect]);

    const renderUser = useCallback(({ item }) => {
        const displayName = item.firstName && item.lastName
            ? `${item.firstName} ${item.lastName}`
            : item.name || item.username;
        const initial = (displayName || '?').charAt(0).toUpperCase();
        const avatarSource = item.profileMediaPath
            ? { uri: `${apiBase}/media/${item.profileMediaPath}` }
            : item.picture
                ? { uri: item.picture }
                : null;
        const isSending = sending[item.id];
        const isPending = item.requestSent || item.isFriend === 'pending';
        const isFriend = item.isFriend === true;

        return (
            <TouchableOpacity
                style={styles.userCard}
                onPress={() => navigation.navigate('Profile', { username: item.username })}
            >
                <View style={styles.avatar}>
                    {avatarSource ? (
                        <Image source={avatarSource} style={styles.avatarImage} />
                    ) : (
                        <Text style={styles.avatarText}>{initial}</Text>
                    )}
                </View>
                <View style={styles.userInfo}>
                    <Text style={styles.userName}>{displayName}</Text>
                    <Text style={styles.userHandle}>@{item.username}</Text>
                </View>
                {isFriend ? (
                    <View style={styles.friendBadge}>
                        <Ionicons name="checkmark-circle" size={16} color={colors.success} />
                        <Text style={styles.friendBadgeText}>Friends</Text>
                    </View>
                ) : isPending ? (
                    <View style={styles.pendingBadge}>
                        <Text style={styles.pendingBadgeText}>Pending</Text>
                    </View>
                ) : (
                    <TouchableOpacity
                        style={styles.addButton}
                        onPress={(event) => {
                            event.stopPropagation();
                            handleSendRequest(item.id);
                        }}
                        disabled={isSending}
                    >
                        {isSending ? (
                            <ActivityIndicator size="small" color={colors.textInverted} />
                        ) : (
                            <>
                                <Ionicons name="person-add" size={16} color={colors.textInverted} />
                                <Text style={styles.addButtonText}>Add</Text>
                            </>
                        )}
                    </TouchableOpacity>
                )}
            </TouchableOpacity>
        );
    }, [apiBase, colors.success, colors.textInverted, handleSendRequest, navigation, sending, styles]);

    const renderItem = useCallback(({ item, index }) => {
        const coverUrl = resolveCollectableCoverUrl(item, apiBase);
        const typeLabel = getCollectableTypeLabel(item, selectedType);
        const metadataLine = formatCollectableSearchMeta(item);
        const itemKey = buildCollectableItemKey(item, index);
        const isResolving = resolvingItemKey === itemKey;

        return (
            <TouchableOpacity
                style={styles.itemCard}
                onPress={() => handleItemPress(item, index)}
            >
                {coverUrl ? (
                    <Image source={{ uri: coverUrl }} style={styles.itemCover} />
                ) : (
                    <View style={[styles.itemCover, styles.itemCoverFallback]}>
                        <Ionicons name="book" size={24} color={colors.primary} />
                    </View>
                )}
                <View style={styles.itemInfo}>
                    <Text style={styles.itemTitle} numberOfLines={2}>{item.title || 'Untitled'}</Text>
                    {item.primaryCreator ? (
                        <Text style={styles.itemCreator} numberOfLines={1}>{item.primaryCreator}</Text>
                    ) : null}
                    {metadataLine ? (
                        <Text style={styles.itemMetaText} numberOfLines={1}>{metadataLine}</Text>
                    ) : null}
                    <View style={styles.itemMetaRow}>
                        <Text style={styles.itemKind}>{typeLabel}</Text>
                    </View>
                </View>
                {isResolving ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                    <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                )}
            </TouchableOpacity>
        );
    }, [apiBase, colors.primary, colors.textMuted, handleItemPress, resolvingItemKey, selectedType, styles]);

    const renderItemFooter = useCallback(() => {
        const showSearchMoreLink = (
            itemSearched
            && itemResults.length > 0
            && startedWithAllTypeRef.current
            && selectedType !== ''
            && lastItemSearchType === selectedType
            && !lastItemSearchHadApi
        );
        const showDisclaimer = selectedType === '' && itemSearched && itemResults.length > 0;
        if (!itemLoadingMore && !showDisclaimer && !showSearchMoreLink && !searchMoreLoading) return null;

        return (
            <View style={styles.itemsFooter}>
                {itemLoadingMore ? <ActivityIndicator size="small" color={colors.primary} /> : null}
                {showDisclaimer ? <Text style={styles.disclaimerText}>{SEE_MORE_ALL_TYPE_DISCLAIMER}</Text> : null}
                {showSearchMoreLink ? (
                    <TouchableOpacity onPress={handleSearchMoreByType} disabled={searchMoreLoading}>
                        <Text style={styles.searchMoreLink}>
                            {searchMoreLoading ? 'Searching more...' : 'Search more'}
                        </Text>
                    </TouchableOpacity>
                ) : null}
            </View>
        );
    }, [
        colors.primary,
        handleSearchMoreByType,
        itemLoadingMore,
        itemResults.length,
        itemSearched,
        lastItemSearchHadApi,
        lastItemSearchType,
        searchMoreLoading,
        selectedType,
        styles,
    ]);

    const listLoading = activeTab === 'friends' ? friendsLoading : itemLoading;

    return (
        <SafeAreaView style={styles.screen} edges={['top']}>
            <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />

            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
                    <Ionicons name="arrow-back" size={22} color={colors.text} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Search</Text>
                <View style={styles.headerSpacer} />
            </View>

            <View style={styles.searchContainer}>
                <View style={styles.searchBox}>
                    <Ionicons name="search" size={18} color={colors.textMuted} />
                    <TextInput
                        ref={searchInputRef}
                        style={styles.searchInput}
                        value={query}
                        onChangeText={setQuery}
                        placeholder="Search friends and collectables"
                        placeholderTextColor={colors.textMuted}
                        autoCapitalize="none"
                        autoCorrect={false}
                        returnKeyType="search"
                        onSubmitEditing={handleSearchPress}
                    />
                    {query.length > 0 ? (
                        <TouchableOpacity style={styles.doneButton} onPress={handleKeyboardDone}>
                            <Text style={styles.doneButtonText}>Done</Text>
                        </TouchableOpacity>
                    ) : null}
                    {query.length > 0 ? (
                        <TouchableOpacity onPress={clearSearch}>
                            <Ionicons name="close-circle" size={18} color={colors.textMuted} />
                        </TouchableOpacity>
                    ) : null}
                    <TouchableOpacity style={styles.typeChip} onPress={() => setShowTypePicker(true)}>
                        <Text style={styles.typeChipText}>{selectedTypeOption.label}</Text>
                        <Ionicons name="chevron-down" size={12} color={colors.textMuted} />
                    </TouchableOpacity>
                </View>
                <View style={styles.searchActions}>
                    <TouchableOpacity style={styles.searchButton} onPress={handleSearchPress}>
                        <Text style={styles.searchButtonText}>Search</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.advancedButton} onPress={handleOpenAdvanced}>
                        <Text style={styles.advancedButtonText}>Advanced</Text>
                    </TouchableOpacity>
                </View>
            </View>

            {(selectedType === 'games' || selectedPlatform) ? (
                <View style={styles.platformRow}>
                    <TextInput
                        style={styles.platformInput}
                        value={selectedPlatform}
                        onChangeText={setSelectedPlatform}
                        placeholder="Platform (optional)"
                        placeholderTextColor={colors.textMuted}
                        returnKeyType="search"
                        onSubmitEditing={handleSearchPress}
                    />
                </View>
            ) : null}

            {activeTab === 'items' && (itemResults.length > 0 || hasActiveItemFilters) ? (
                <View style={styles.resultsFilterRow}>
                    <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.resultsFilterScrollContent}
                    >
                        <TouchableOpacity
                            style={[styles.resultsFilterChip, activeCreator && styles.resultsFilterChipActive]}
                            onPress={() => setFilterPickerKey('creator')}
                        >
                            <Text style={[styles.resultsFilterChipText, activeCreator && styles.resultsFilterChipTextActive]}>
                                {activeCreator ? `Creator: ${selectedCreatorLabel}` : 'Creator'}
                            </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.resultsFilterChip, activeYear && styles.resultsFilterChipActive]}
                            onPress={() => setFilterPickerKey('year')}
                        >
                            <Text style={[styles.resultsFilterChipText, activeYear && styles.resultsFilterChipTextActive]}>
                                {activeYear ? `Year: ${selectedYearLabel}` : 'Year'}
                            </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.resultsFilterChip, activeGenre && styles.resultsFilterChipActive]}
                            onPress={() => setFilterPickerKey('genre')}
                        >
                            <Text style={[styles.resultsFilterChipText, activeGenre && styles.resultsFilterChipTextActive]}>
                                {activeGenre ? `Genre: ${selectedGenreLabel}` : 'Genre'}
                            </Text>
                        </TouchableOpacity>
                        {showPlatformFilterChip ? (
                            <TouchableOpacity
                                style={[styles.resultsFilterChip, activePlatform && styles.resultsFilterChipActive]}
                                onPress={() => setFilterPickerKey('platform')}
                            >
                                <Text style={[styles.resultsFilterChipText, activePlatform && styles.resultsFilterChipTextActive]}>
                                    {activePlatform ? `Platform: ${selectedPlatformLabel}` : 'Platform'}
                                </Text>
                            </TouchableOpacity>
                        ) : null}
                        {hasActiveItemFilters ? (
                            <TouchableOpacity style={styles.clearFiltersChip} onPress={clearItemFilters}>
                                <Text style={styles.clearFiltersChipText}>Clear filters</Text>
                            </TouchableOpacity>
                        ) : null}
                    </ScrollView>
                </View>
            ) : null}

            <View style={styles.tabBar}>
                <TouchableOpacity
                    style={[styles.tab, activeTab === 'items' && styles.tabActive]}
                    onPress={() => setActiveTab('items')}
                >
                    <Ionicons name="library" size={18} color={activeTab === 'items' ? colors.primary : colors.textMuted} />
                    <Text style={[styles.tabText, activeTab === 'items' && styles.tabTextActive]}>
                        Collectables {itemSearched ? `(${itemResults.length})` : ''}
                    </Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={[styles.tab, activeTab === 'friends' && styles.tabActive]}
                    onPress={() => setActiveTab('friends')}
                >
                    <Ionicons name="people" size={18} color={activeTab === 'friends' ? colors.primary : colors.textMuted} />
                    <Text style={[styles.tabText, activeTab === 'friends' && styles.tabTextActive]}>
                        Friends {friendSearchRun ? `(${friendResults.length})` : ''}
                    </Text>
                </TouchableOpacity>
            </View>

            {listLoading ? (
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color={colors.primary} />
                </View>
            ) : activeTab === 'items' ? (
                <FlatList
                    data={filteredItemResults}
                    keyExtractor={(item, index) => buildCollectableItemKey(item, index)}
                    renderItem={renderItem}
                    contentContainerStyle={styles.listContent}
                    keyboardDismissMode="on-drag"
                    keyboardShouldPersistTaps="handled"
                    onScrollBeginDrag={Keyboard.dismiss}
                    onEndReached={handleLoadMoreItems}
                    onEndReachedThreshold={0.35}
                    ListFooterComponent={renderItemFooter}
                    ListEmptyComponent={
                        itemSearched && hasActiveItemFilters && itemResults.length > 0 ? (
                            <View style={styles.emptyState}>
                                <Ionicons name="funnel-outline" size={48} color={colors.textMuted} />
                                <Text style={styles.emptyTitle}>No matches for active filters</Text>
                                <Text style={styles.emptyText}>Adjust or clear your filters to view more results.</Text>
                                <TouchableOpacity style={styles.emptyActionButton} onPress={handleOpenAdvanced}>
                                    <Text style={styles.emptyActionButtonText}>Open Advanced Search</Text>
                                </TouchableOpacity>
                            </View>
                        ) : itemSearched ? (
                            <View style={styles.emptyState}>
                                <Ionicons name="library-outline" size={48} color={colors.textMuted} />
                                <Text style={styles.emptyTitle}>No collectables found</Text>
                                <Text style={styles.emptyText}>Try another query, type, or platform.</Text>
                                <TouchableOpacity style={styles.emptyActionButton} onPress={handleOpenAdvanced}>
                                    <Text style={styles.emptyActionButtonText}>Open Advanced Search</Text>
                                </TouchableOpacity>
                            </View>
                        ) : (
                            <View style={styles.emptyState}>
                                <Ionicons name="search-outline" size={48} color={colors.textMuted} />
                                <Text style={styles.emptyTitle}>Search the catalog</Text>
                                <Text style={styles.emptyText}>Find books, movies, games, and more.</Text>
                            </View>
                        )
                    }
                />
            ) : (
                <FlatList
                    data={friendResults}
                    keyExtractor={(item) => String(item.id)}
                    renderItem={renderUser}
                    contentContainerStyle={styles.listContent}
                    keyboardDismissMode="on-drag"
                    keyboardShouldPersistTaps="handled"
                    onScrollBeginDrag={Keyboard.dismiss}
                    ListEmptyComponent={
                        friendSearchRun ? (
                            <View style={styles.emptyState}>
                                <Ionicons name="people-outline" size={48} color={colors.textMuted} />
                                <Text style={styles.emptyTitle}>No users found</Text>
                                <Text style={styles.emptyText}>Try a different name or username.</Text>
                            </View>
                        ) : (
                            <View style={styles.emptyState}>
                                <Ionicons name="search-outline" size={48} color={colors.textMuted} />
                                <Text style={styles.emptyTitle}>Search for collectors</Text>
                                <Text style={styles.emptyText}>Find friends to share your shelves with.</Text>
                            </View>
                        )
                    }
                />
            )}

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
                                    key={option.value || 'all'}
                                    style={styles.typeModalOption}
                                    onPress={() => {
                                        setSelectedType(option.value);
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

            <Modal
                visible={Boolean(filterPickerConfig)}
                transparent
                animationType="fade"
                onRequestClose={() => setFilterPickerKey('')}
            >
                <Pressable style={styles.typeModalOverlay} onPress={() => setFilterPickerKey('')}>
                    <Pressable style={styles.typeModalCard} onPress={() => {}}>
                        <Text style={styles.filterModalTitle}>{filterPickerConfig?.title || 'Filter results'}</Text>
                        <View style={styles.filterInputRow}>
                            <TextInput
                                style={styles.filterInput}
                                value={filterInputValue}
                                onChangeText={setFilterInputValue}
                                placeholder="Type exact value"
                                placeholderTextColor={colors.textMuted}
                                autoCapitalize="none"
                                autoCorrect={false}
                                returnKeyType="done"
                                onSubmitEditing={handleApplyTypedFilter}
                            />
                            <TouchableOpacity style={styles.filterApplyButton} onPress={handleApplyTypedFilter}>
                                <Text style={styles.filterApplyButtonText}>Apply exact</Text>
                            </TouchableOpacity>
                        </View>
                        <TouchableOpacity
                            style={styles.typeModalOption}
                            onPress={() => handleFilterOptionSelect('')}
                        >
                            <Text style={[
                                styles.typeModalOptionText,
                                !(
                                    (filterPickerKey === 'creator' && activeCreator)
                                    || (filterPickerKey === 'year' && activeYear)
                                    || (filterPickerKey === 'genre' && activeGenre)
                                    || (filterPickerKey === 'platform' && activePlatform)
                                ) && styles.typeModalOptionTextSelected,
                            ]}
                            >
                                Any
                            </Text>
                        </TouchableOpacity>
                        {(filterPickerConfig?.options || []).map((option) => {
                            const selected = (
                                (filterPickerKey === 'creator' && option.key === activeCreator)
                                || (filterPickerKey === 'year' && option.key === activeYear)
                                || (filterPickerKey === 'genre' && option.key === activeGenre)
                                || (filterPickerKey === 'platform' && option.key === activePlatform)
                            );
                            return (
                                <TouchableOpacity
                                    key={option.key}
                                    style={styles.typeModalOption}
                                    onPress={() => handleFilterOptionSelect(option.key)}
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
    headerSpacer: {
        width: 40,
        height: 40,
    },
    advancedButton: {
        width: '100%',
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.surface,
        ...shadows.sm,
    },
    advancedButtonText: {
        color: colors.primary,
        fontSize: 13,
        fontWeight: '700',
    },
    searchContainer: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        paddingHorizontal: spacing.md,
        paddingBottom: spacing.sm,
        gap: spacing.sm,
    },
    searchBox: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.surface,
        borderRadius: radius.lg,
        paddingHorizontal: spacing.md,
        height: 44,
        gap: spacing.sm,
        ...shadows.sm,
    },
    searchInput: {
        flex: 1,
        fontSize: 15,
        color: colors.text,
    },
    doneButton: {
        paddingHorizontal: 2,
        paddingVertical: 2,
    },
    doneButtonText: {
        color: colors.primary,
        fontSize: 12,
        fontWeight: '700',
    },
    searchActions: {
        width: 96,
        gap: spacing.xs,
    },
    searchButton: {
        backgroundColor: colors.primary,
        height: 44,
        paddingHorizontal: spacing.md,
        borderRadius: radius.lg,
        alignItems: 'center',
        justifyContent: 'center',
    },
    searchButtonText: {
        color: colors.textInverted,
        fontWeight: '600',
        fontSize: 14,
    },
    platformRow: {
        paddingHorizontal: spacing.md,
        paddingBottom: spacing.sm,
    },
    resultsFilterRow: {
        paddingHorizontal: spacing.md,
        paddingBottom: spacing.sm,
    },
    resultsFilterScrollContent: {
        gap: spacing.xs,
        paddingRight: spacing.md,
    },
    resultsFilterChip: {
        borderRadius: radius.full || 999,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs + 2,
    },
    resultsFilterChipActive: {
        borderColor: colors.primary,
        backgroundColor: colors.primary + '18',
    },
    resultsFilterChipText: {
        color: colors.text,
        fontSize: 12,
        fontWeight: '500',
    },
    resultsFilterChipTextActive: {
        color: colors.primary,
        fontWeight: '700',
    },
    clearFiltersChip: {
        borderRadius: radius.full || 999,
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs + 2,
        backgroundColor: colors.surfaceElevated,
    },
    clearFiltersChipText: {
        color: colors.textMuted,
        fontSize: 12,
        fontWeight: '600',
        textDecorationLine: 'underline',
    },
    typeChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radius.full || 999,
        paddingHorizontal: 10,
        paddingVertical: 4,
        backgroundColor: colors.surfaceElevated,
    },
    typeChipText: {
        color: colors.text,
        fontSize: 12,
        fontWeight: '600',
    },
    platformInput: {
        flex: 1,
        height: 36,
        borderRadius: radius.md,
        backgroundColor: colors.surface,
        color: colors.text,
        paddingHorizontal: spacing.sm,
        fontSize: 13,
        ...shadows.sm,
    },
    listContent: {
        paddingHorizontal: spacing.md,
        paddingBottom: spacing.xl,
        paddingTop: 0,
    },
    userCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.surface,
        borderRadius: radius.lg,
        padding: spacing.md,
        marginBottom: spacing.sm,
        ...shadows.sm,
    },
    avatar: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: colors.primary,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: spacing.md,
        overflow: 'hidden',
    },
    avatarImage: {
        width: '100%',
        height: '100%',
    },
    avatarText: {
        fontSize: 18,
        fontWeight: '600',
        color: colors.textInverted,
    },
    userInfo: {
        flex: 1,
    },
    userName: {
        fontSize: 15,
        fontWeight: '600',
        color: colors.text,
    },
    userHandle: {
        fontSize: 13,
        color: colors.textMuted,
        marginTop: 1,
    },
    addButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: colors.primary,
        paddingHorizontal: spacing.sm + 4,
        paddingVertical: spacing.xs + 2,
        borderRadius: 16,
    },
    addButtonText: {
        color: colors.textInverted,
        fontSize: 13,
        fontWeight: '600',
    },
    friendBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    friendBadgeText: {
        color: colors.success,
        fontSize: 13,
        fontWeight: '500',
    },
    pendingBadge: {
        backgroundColor: colors.warning + '20',
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs,
        borderRadius: 12,
    },
    pendingBadgeText: {
        color: colors.warning,
        fontSize: 12,
        fontWeight: '500',
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    emptyState: {
        alignItems: 'center',
        paddingTop: spacing['2xl'],
        paddingHorizontal: spacing.lg,
    },
    emptyTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: colors.text,
        marginTop: spacing.md,
    },
    emptyText: {
        fontSize: 14,
        color: colors.textMuted,
        marginTop: spacing.xs,
    },
    emptyActionButton: {
        marginTop: spacing.md,
        backgroundColor: colors.surface,
        borderRadius: radius.full || 999,
        borderWidth: 1,
        borderColor: colors.border,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.xs + 2,
    },
    emptyActionButtonText: {
        color: colors.primary,
        fontSize: 12,
        fontWeight: '700',
    },
    // Tab styles
    tabBar: {
        flexDirection: 'row',
        marginHorizontal: spacing.md,
        marginBottom: spacing.sm,
        backgroundColor: colors.surface,
        borderRadius: radius.lg,
        padding: 4,
        ...shadows.sm,
    },
    tab: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingVertical: spacing.sm,
        borderRadius: radius.lg - 2,
    },
    tabActive: {
        backgroundColor: colors.background,
    },
    tabText: {
        fontSize: 14,
        fontWeight: '500',
        color: colors.textMuted,
    },
    tabTextActive: {
        color: colors.primary,
        fontWeight: '600',
    },
    // Item card styles
    itemCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.surface,
        borderRadius: radius.lg,
        padding: spacing.md,
        marginBottom: spacing.sm,
        gap: spacing.md,
        ...shadows.sm,
    },
    itemCover: {
        width: 50,
        height: 70,
        borderRadius: 6,
        backgroundColor: colors.surfaceElevated,
    },
    itemCoverFallback: {
        justifyContent: 'center',
        alignItems: 'center',
    },
    itemInfo: {
        flex: 1,
    },
    itemTitle: {
        fontSize: 15,
        fontWeight: '600',
        color: colors.text,
    },
    itemCreator: {
        fontSize: 13,
        color: colors.textMuted,
        marginTop: 2,
    },
    itemMetaText: {
        fontSize: 11,
        color: colors.textMuted,
        marginTop: 2,
    },
    itemMetaRow: {
        marginTop: 6,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    itemKind: {
        fontSize: 11,
        color: colors.primary,
        textTransform: 'capitalize',
        fontWeight: '600',
    },
    itemsFooter: {
        paddingVertical: spacing.sm,
        alignItems: 'center',
        gap: spacing.xs,
    },
    disclaimerText: {
        color: colors.textMuted,
        fontSize: 12,
        textAlign: 'center',
    },
    searchMoreLink: {
        color: colors.primary,
        fontSize: 12,
        fontWeight: '600',
        textDecorationLine: 'underline',
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
    filterModalTitle: {
        paddingHorizontal: spacing.md,
        paddingTop: spacing.sm,
        paddingBottom: spacing.xs,
        color: colors.textMuted,
        fontSize: 12,
        fontWeight: '700',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    filterInputRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        paddingHorizontal: spacing.md,
        paddingBottom: spacing.xs,
    },
    filterInput: {
        flex: 1,
        minHeight: 36,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surfaceElevated,
        paddingHorizontal: spacing.sm,
        color: colors.text,
        fontSize: 13,
    },
    filterApplyButton: {
        minHeight: 36,
        borderRadius: radius.md,
        backgroundColor: colors.primary,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: spacing.sm,
    },
    filterApplyButtonText: {
        color: colors.textInverted,
        fontSize: 12,
        fontWeight: '700',
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
