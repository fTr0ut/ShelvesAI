import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
    Image,
    Linking,
    Pressable,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    TextInput,
    TouchableOpacity,
    View,
    StatusBar,
    Alert,
    ActivityIndicator,
    Modal,
    FlatList,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { AuthContext } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { CachedImage, StarRating, CategoryIcon } from '../components/ui';
import ImageCropper from '../components/ui/ImageCropper';
import { apiRequest, getValidToken } from '../services/api';
import { shareEntityLink } from '../services/shareLinks';
import { resolveCollectableCoverUrl, resolveManualCoverUrl, buildMediaUri } from '../utils/coverUrl';
import AddToShelfModal from '../components/AddToShelfModal';
import {
    resolveCollectableMaxPlayers,
    resolveCollectableRating,
    resolveCollectableRatingCount,
    resolveMultiplayerData,
    resolveRatingsData,
} from '../utils/collectableDisplay';

// Logo assets for provider attribution (imported as React components via react-native-svg-transformer)
import TmdbLogo from '../assets/tmdb-logo.svg';

const PERSISTENT_TAB_FOOTER_SPACER = 88;
const MAX_OWNED_PLATFORMS = 25;
const OWNED_GAME_FORMAT_OPTIONS = ['physical', 'digital'];

function normalizeUniqueStrings(input) {
    if (input == null) return [];
    const source = Array.isArray(input) ? input : [input];
    const seen = new Set();
    const out = [];
    for (const entry of source) {
        const normalized = String(entry || '').trim();
        if (!normalized) continue;
        const key = normalized.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(normalized);
    }
    return out;
}

function normalizeOwnedGameFormat(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return null;
    return OWNED_GAME_FORMAT_OPTIONS.includes(normalized) ? normalized : null;
}

function formatOwnedGameFormatLabel(value) {
    if (value === 'physical') return 'Physical';
    if (value === 'digital') return 'Digital';
    return 'Not set';
}

function derivePlatformOptionsFromCollectable(collectable, fallbackSystemName = null) {
    const out = [];
    const seen = new Set();
    const push = (value) => {
        const normalized = String(value || '').trim();
        if (!normalized) return;
        const key = normalized.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        out.push(normalized);
    };

    normalizeUniqueStrings(collectable?.platforms).forEach(push);
    if (Array.isArray(collectable?.platformData)) {
        collectable.platformData.forEach((entry) => {
            push(entry?.name);
            push(entry?.abbreviation);
        });
    }
    push(collectable?.systemName);
    push(fallbackSystemName);
    return out;
}

function formatDisplayDate(value) {
    if (!value) return null;
    const parsed = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    try {
        return new Intl.DateTimeFormat('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
        }).format(parsed);
    } catch (_) {
        return parsed.toISOString().slice(0, 10);
    }
}

export default function CollectableDetailScreen({ route, navigation }) {
    const { item, shelfId, readOnly, id, collectableId, manualId, ownerId, ownerUsername } = route.params || {}; // ownerId added for Scenario B/C
    const { apiBase, token, user } = useContext(AuthContext); // user needed to compare with ownerId
    const { colors, spacing, typography, shadows, radius, isDark } = useTheme();
    const insets = useSafeAreaInsets();

    const styles = useMemo(() => createStyles({ colors, spacing, typography, shadows, radius }), [colors, spacing, typography, shadows, radius]);

    const isWithinHoursWindow = (value, hours) => {
        if (!value || !Number.isFinite(hours) || hours <= 0) return false;
        const timestamp = Date.parse(String(value));
        if (!Number.isFinite(timestamp)) return false;
        return (Date.now() - timestamp) <= (hours * 60 * 60 * 1000);
    };

    // Determine ownership to initialize ratings correctly from passed params
    // If ownerId is missing or matches current user, we assume 'item.rating' is OUR rating.
    // If ownerId is present and distinct, 'item.rating' is the OWNER'S rating.
    const isOwnerContext = ownerId && user?.id && ownerId !== user.id;
    const initialRating = !isOwnerContext ? (item?.rating || 0) : 0;
    const initialOwnerRating = isOwnerContext ? (item?.rating || 0) : null;

    const [resolvedCollectable, setResolvedCollectable] = useState(null);
    const [resolvedManual, setResolvedManual] = useState(null);
    const [rating, setRating] = useState(initialRating); // User's own rating
    const [ownerRating, setOwnerRating] = useState(initialOwnerRating); // Shelf owner's rating
    const [aggregateRating, setAggregateRating] = useState(null); // Average rating from all users
    const [isFavorited, setIsFavorited] = useState(false);
    const [isUploadingCover, setIsUploadingCover] = useState(false);
    const [manualCoverUrl, setManualCoverUrl] = useState(null);
    const [showWishlistModal, setShowWishlistModal] = useState(false);
    const [wishlists, setWishlists] = useState([]);
    const [showAddToShelfModal, setShowAddToShelfModal] = useState(false);
    const [addedToShelfId, setAddedToShelfId] = useState(null);
    const [ownerPhoto, setOwnerPhoto] = useState(null);
    const [ownerPhotoLoading, setOwnerPhotoLoading] = useState(false);
    const [ownerPhotoBusy, setOwnerPhotoBusy] = useState(false);
    const [imageAuthToken, setImageAuthToken] = useState(null);
    const [ownerPhotoViewerVisible, setOwnerPhotoViewerVisible] = useState(false);
    const [ownerPhotoViewerLoading, setOwnerPhotoViewerLoading] = useState(false);
    const [ownerPhotoViewerApplying, setOwnerPhotoViewerApplying] = useState(false);
    const [ownerPhotoViewerUri, setOwnerPhotoViewerUri] = useState(null);
    const [ownerPhotoViewerOriginalUri, setOwnerPhotoViewerOriginalUri] = useState(null);
    const [ownerPhotoViewerEditing, setOwnerPhotoViewerEditing] = useState(false);
    const [coverViewerVisible, setCoverViewerVisible] = useState(false);
    const [coverViewerUri, setCoverViewerUri] = useState(null);
    const [coverViewerAspectRatio, setCoverViewerAspectRatio] = useState(null);
    const [collectionNotes, setCollectionNotes] = useState(item?.notes ?? null);
    const [notesDraft, setNotesDraft] = useState(item?.notes || '');
    const [notesSaving, setNotesSaving] = useState(false);
    const [isEditingNotes, setIsEditingNotes] = useState(false);
    const [shareToFeed, setShareToFeed] = useState(false);
    const [reviewedEventId, setReviewedEventId] = useState(item?.reviewedEventId || item?.reviewedEventLogId || null);
    const [reviewPublishedAt, setReviewPublishedAt] = useState(item?.reviewPublishedAt || item?.reviewedEventPublishedAt || null);
    const [reviewUpdatedAt, setReviewUpdatedAt] = useState(item?.reviewUpdatedAt || item?.reviewedEventUpdatedAt || null);
    const [userEstimate, setUserEstimate] = useState(null);
    const [shareBusy, setShareBusy] = useState(false);
    const [isCastExpanded, setIsCastExpanded] = useState(false);
    const [isTagsExpanded, setIsTagsExpanded] = useState(false);
    const [isOwnedPlatformsExpanded, setIsOwnedPlatformsExpanded] = useState(true);
    const [ownedPlatforms, setOwnedPlatforms] = useState(() => normalizeUniqueStrings(item?.ownedPlatforms));
    const [platformDraft, setPlatformDraft] = useState('');
    const [isEditingOwnedPlatforms, setIsEditingOwnedPlatforms] = useState(false);
    const [ownedPlatformsSaving, setOwnedPlatformsSaving] = useState(false);
    const [platformMissing, setPlatformMissing] = useState(!!item?.platformMissing);
    const [ownedPlatformFormat, setOwnedPlatformFormat] = useState(() => normalizeOwnedGameFormat(
        item?.collectable?.format || item?.collectableSnapshot?.format || item?.format,
    ));

    const notesShelfId = item?.shelfId || shelfId || null;
    const resolvedCollectableId = manualId
        ? null
        : (collectableId
            || item?.collectable?.id
            || item?.collectableId
            || item?.collectable_id
            || item?.collectableSnapshot?.id
            || id
            || null);
    const baseCollectable = item?.collectable
        || item?.collectableSnapshot
        || (resolvedCollectableId ? { id: resolvedCollectableId } : {});
    const collectable = resolvedCollectable || baseCollectable;
    const baseManual = item?.manual || item?.manualSnapshot || (manualId ? { id: manualId } : {});
    const manual = resolvedManual || baseManual;
    // Detect manual items: either has manual data with content, or collectable is empty/missing
    const hasManualContent = !!(manual?.id || manual?.title || manual?.name || manual?.coverMediaUrl || manual?.coverMediaPath);
    const hasCollectableContent = !!(collectable?.id && collectable?.title);
    const isManual = hasManualContent && !hasCollectableContent;
    const source = isManual ? manual : collectable;
    const hasShelfItemContext = !!(notesShelfId && item?.id);
    const isOwnedShelfItem = hasShelfItemContext && !readOnly && !(ownerId && user?.id && ownerId !== user.id);
    const canEditOwnerPhoto = isOwnedShelfItem;
    const canEditNotes = hasShelfItemContext && !readOnly;
    const canShowReplaceCTA = isOwnedShelfItem
        && item?.isVisionLinked === true
        && isWithinHoursWindow(item?.createdAt, 72);
    const itemCollectableKind = String(
        item?.collectable?.kind
        || item?.collectable?.type
        || item?.collectableKind
        || '',
    ).trim().toLowerCase();
    const sourceCollectableKind = String(source?.kind || source?.type || '').trim().toLowerCase();
    const isGameCollectableContext = itemCollectableKind === 'games'
        || itemCollectableKind === 'game'
        || sourceCollectableKind === 'games'
        || sourceCollectableKind === 'game';
    const canEditOwnedPlatforms = isOwnedShelfItem && isGameCollectableContext;
    const ownedPlatformsAddedDateLabel = useMemo(() => (
        formatDisplayDate(item?.createdAt || item?.addedAt || item?.updatedAt) || 'Unknown'
    ), [item?.addedAt, item?.createdAt, item?.updatedAt]);
    const hasNoteChanges = (notesDraft || '').trim() !== (collectionNotes || '').trim();
    const hasPublishedReview = !!(reviewedEventId || reviewPublishedAt || reviewUpdatedAt);
    const isInsideBottomTab = useMemo(() => {
        let parent = navigation?.getParent?.();
        while (parent) {
            const parentState = parent.getState?.();
            if (parentState?.type === 'tab') return true;
            parent = parent.getParent?.();
        }
        return false;
    }, [navigation]);
    const bottomFooterSpacer = isInsideBottomTab ? PERSISTENT_TAB_FOOTER_SPACER : 0;

    useEffect(() => {
        setPlatformMissing(!!item?.platformMissing);
    }, [item?.id, item?.platformMissing]);

    // Fetch wishlists
    const fetchWishlists = async () => {
        try {
            const data = await apiRequest({
                apiBase,
                path: `/api/wishlists`,
                token,
            });
            if (data?.wishlists) {
                setWishlists(data.wishlists);
            }
        } catch (e) {
            console.warn('Failed to fetch wishlists', e);
        }
    };

    const handleOpenWishlistModal = () => {
        fetchWishlists();
        setShowWishlistModal(true);
    };

    const handleAddItemToWishlist = async (wishlistId) => {
        try {
            const targetCollectableId = collectable?.id;
            const body = {};

            if (targetCollectableId) {
                body.collectableId = targetCollectableId;
            } else {
                // For manual items or unmatchable items, use the title
                const itemTitle = manual?.title || manual?.name || title;
                if (!itemTitle) {
                    Alert.alert('Error', 'Cannot add item: missing title');
                    return;
                }
                body.manualText = itemTitle;
            }

            await apiRequest({
                apiBase,
                path: `/api/wishlists/${wishlistId}/items`,
                method: 'POST',
                token,
                body,
            });
            Alert.alert('Success', 'Added to wishlist!');
            setShowWishlistModal(false);
        } catch (e) {
            console.warn('Failed to add to wishlist', e);
            Alert.alert('Error', 'Failed to add to wishlist');
        }
    };

    const handleAddToShelfSuccess = useCallback((shelf) => {
        setAddedToShelfId(shelf.id);
    }, []);

    const handleStartReplacementFlow = useCallback(async () => {
        if (!hasShelfItemContext || !isOwnedShelfItem) return;

        try {
            const response = await apiRequest({
                apiBase,
                path: `/api/shelves/${shelfId}/items/${item.id}/replacement-intent`,
                method: 'POST',
                token,
                body: { triggerSource: 'collectable_detail' },
            });

            const traceId = response?.traceId || response?.trace?.id;
            if (!traceId) {
                throw new Error('Replacement intent was not created.');
            }

            const prefillTitle = collectable?.title || manual?.title || manual?.name || '';
            const prefillAuthor = collectable?.primaryCreator || manual?.author || '';
            const prefillType = manual?.type || collectable?.kind || '';
            const prefillPlatform = item?.format || manual?.format || '';
            const prefillDescription = collectable?.description || manual?.description || '';

            navigation.replace('ItemSearch', {
                mode: 'shelf_add_or_replace',
                shelfId,
                shelfType: prefillType,
                replaceContext: {
                    traceId,
                    sourceItemId: item.id,
                    triggerSource: 'collectable_detail',
                    sourceCollectableId: collectable?.id || item?.collectableId || null,
                    sourceManualId: manual?.id || item?.manualId || null,
                    prefillTitle,
                    prefillAuthor,
                    prefillType,
                    prefillPlatform,
                    prefillDescription,
                },
            });
        } catch (err) {
            Alert.alert('Error', err?.message || 'Failed to start replacement');
        }
    }, [
        apiBase,
        collectable?.description,
        collectable?.id,
        collectable?.kind,
        collectable?.primaryCreator,
        collectable?.title,
        hasShelfItemContext,
        isOwnedShelfItem,
        item,
        manual?.author,
        manual?.description,
        manual?.format,
        manual?.id,
        manual?.name,
        manual?.title,
        manual?.type,
        navigation,
        shelfId,
        token,
    ]);

    // Fetch collectable details
    useEffect(() => {
        let isActive = true;
        const targetId = baseCollectable?.id;

        if (!targetId || !apiBase || !token) return;
        if (resolvedCollectable && String(resolvedCollectable.id) === String(targetId)) return;

        (async () => {
            try {
                const data = await apiRequest({
                    apiBase,
                    path: `/api/collectables/${targetId}`,
                    token,
                });
                if (!isActive || !data?.collectable) return;
                setResolvedCollectable(data.collectable);
            } catch (err) {
                console.warn('Failed to refresh collectable details:', err?.message || err);
            }
        })();

        return () => { isActive = false; };
    }, [apiBase, token, baseCollectable?.id]);

    // Fetch manual item details
    useEffect(() => {
        let isActive = true;
        const targetId = baseManual?.id;

        if (!targetId || !apiBase || !token) return;
        if (resolvedManual && String(resolvedManual.id) === String(targetId)) return;

        (async () => {
            try {
                const data = await apiRequest({
                    apiBase,
                    path: `/api/manuals/${targetId}`,
                    token,
                });
                if (!isActive || !data?.manual) return;
                setResolvedManual(data.manual);
            } catch (err) {
                console.warn('Failed to refresh manual details:', err?.message || err);
            }
        })();

        return () => { isActive = false; };
    }, [apiBase, token, baseManual?.id]);

    // Fetch user's market value estimate
    useEffect(() => {
        const targetId = resolvedCollectableId || manual?.id;
        const typeParam = !resolvedCollectableId && manual?.id ? '?type=manual' : '';
        if (!targetId || !apiBase || !token) return;
        let isActive = true;
        (async () => {
            try {
                const data = await apiRequest({
                    apiBase,
                    path: `/api/collectables/${targetId}/user-estimate${typeParam}`,
                    token,
                });
                if (isActive && data?.estimate) {
                    setUserEstimate(data.estimate);
                }
            } catch (err) {
                console.warn('Failed to fetch user estimate:', err?.message || err);
            }
        })();
        return () => { isActive = false; };
    }, [resolvedCollectableId, manual?.id, apiBase, token]);

    // Listen for user estimate returned from MarketValueSourcesScreen
    useEffect(() => {
        if (route.params?.userEstimateAt) {
            setUserEstimate(route.params.userEstimate ?? null);
        }
    }, [route.params?.userEstimateAt]);

    // Fetch all rating data
    useEffect(() => {
        let isActive = true;
        const targetCollectableId = collectable?.id;
        const targetManualId = manual?.id;

        // Need either collectableId or manualId
        if ((!targetCollectableId && !targetManualId) || !apiBase || !token) return;

        const isManualItem = !targetCollectableId && !!targetManualId;
        const targetId = isManualItem ? targetManualId : targetCollectableId;
        const queryParam = isManualItem ? '?type=manual' : '';

        const loadRatings = async () => {
            try {
                // 1. Get Aggregate Rating (only for collectables)
                if (!isManualItem) {
                    const aggData = await apiRequest({
                        apiBase,
                        path: `/api/ratings/${targetId}/aggregate`,
                        token,
                    });
                    if (isActive) setAggregateRating(aggData);
                }

                // 2. Get Your Rating
                const myData = await apiRequest({
                    apiBase,
                    path: `/api/ratings/${targetId}${queryParam}`,
                    token,
                });
                if (isActive) setRating(myData.rating || 0);

                // 3. Get Owner's Rating (Scenario B, C) - for both collectables and manuals
                if (ownerId && user?.id && ownerId !== user.id) {
                    const ownerData = await apiRequest({
                        apiBase,
                        path: `/api/ratings/${targetId}/user/${ownerId}${queryParam}`,
                        token,
                    });
                    if (isActive) setOwnerRating(ownerData.rating || 0);
                }
            } catch (err) {
                console.warn('Failed to load ratings:', err);
            }
        };

        loadRatings();

        return () => { isActive = false; };
    }, [apiBase, token, collectable?.id, manual?.id, ownerId, user?.id]);

    // Check favorite status
    useEffect(() => {
        let isActive = true;

        const checkFavoriteStatus = async () => {
            const targetCollectableId = collectable?.id;
            const targetManualId = manual?.id;

            if ((!targetCollectableId && !targetManualId) || !token) return;

            try {
                // Use single check for simplicity and consistency with manual updates
                if (targetCollectableId) {
                    const response = await apiRequest({
                        apiBase,
                        path: `/api/favorites/${targetCollectableId}/check`,
                        token,
                    });
                    if (isActive) setIsFavorited(!!response.isFavorite);
                } else if (targetManualId) {
                    const response = await apiRequest({
                        apiBase,
                        path: `/api/favorites/${targetManualId}/check?type=manual`,
                        token,
                    });
                    if (isActive) setIsFavorited(!!response.isFavorite);
                }
            } catch (e) {
                console.warn('Failed to check favorite status', e);
            }
        };

        checkFavoriteStatus();
        return () => { isActive = false; };
    }, [apiBase, token, collectable?.id, manual?.id]);

    useEffect(() => {
        let isActive = true;
        if (!token) {
            setImageAuthToken(null);
            return () => { isActive = false; };
        }
        getValidToken(token)
            .then((resolved) => {
                if (isActive) setImageAuthToken(resolved || token);
            })
            .catch(() => {
                if (isActive) setImageAuthToken(token);
            });
        return () => { isActive = false; };
    }, [token]);

    useEffect(() => {
        let isActive = true;

        const loadOwnerPhoto = async () => {
            if (!hasShelfItemContext || !apiBase || !token) {
                if (isActive) setOwnerPhoto(null);
                return;
            }
            try {
                if (isActive) setOwnerPhotoLoading(true);
                const data = await apiRequest({
                    apiBase,
                    path: `/api/shelves/${shelfId}/items/${item.id}/owner-photo`,
                    token,
                });
                if (isActive) {
                    setOwnerPhoto(data?.ownerPhoto || null);
                }
            } catch (err) {
                if (isActive) {
                    if (err?.status === 404) {
                        setOwnerPhoto(null);
                    } else {
                        console.warn('Failed to load owner photo:', err);
                    }
                }
            } finally {
                if (isActive) setOwnerPhotoLoading(false);
            }
        };

        loadOwnerPhoto();
        return () => { isActive = false; };
    }, [apiBase, token, shelfId, item?.id, hasShelfItemContext]);

    const handleRateItem = async (newRating) => {
        // Allow rating even if readOnly (because it's now decoupled!)
        // Unless it's strictly a view-only mode imposed by something else,
        // but typically "readOnly" meant "not my shelf". Now we ignore that for rating.

        // Optimistic update
        setRating(newRating);

        const targetCollectableId = collectable?.id;
        const targetManualId = manual?.id;

        // Need either collectableId or manualId
        if (!targetCollectableId && !targetManualId) {
            Alert.alert('Error', 'Cannot save rating: missing item ID');
            return;
        }

        try {
            const isManualItem = !targetCollectableId && !!targetManualId;
            const targetId = isManualItem ? targetManualId : targetCollectableId;
            const queryParam = isManualItem ? '?type=manual' : '';

            await apiRequest({
                apiBase,
                path: `/api/ratings/${targetId}${queryParam}`,
                method: 'PUT',
                token,
                body: { rating: newRating },
            });

            // Refresh aggregate after rating (only for collectables)
            if (!isManualItem) {
                const aggData = await apiRequest({
                    apiBase,
                    path: `/api/ratings/${targetId}/aggregate`,
                    token,
                });
                setAggregateRating(aggData);
            }

        } catch (e) {
            console.warn('Failed to update rating:', e);
            Alert.alert('Error', 'Failed to save rating');
            // Revert would be tricky without tracking previous, 
            // generally separate state "prevRating" is needed or just re-fetch
        }
    };

    const handleToggleFavorite = async () => {
        const targetCollectableId = collectable?.id;
        const targetManualId = manual?.id;

        if (!targetCollectableId && !targetManualId) return;

        const previousState = isFavorited;
        // Optimistic update
        setIsFavorited(!previousState);

        try {
            if (previousState) {
                // Removing favorite
                if (targetCollectableId) {
                    await apiRequest({
                        apiBase,
                        path: `/api/favorites/${targetCollectableId}`,
                        method: 'DELETE',
                        token,
                    });
                } else {
                    await apiRequest({
                        apiBase,
                        path: `/api/favorites/${targetManualId}?type=manual`,
                        method: 'DELETE',
                        token,
                    });
                }
            } else {
                // Adding favorite
                const body = targetCollectableId
                    ? { collectableId: targetCollectableId }
                    : { manualId: targetManualId };

                await apiRequest({
                    apiBase,
                    path: '/api/favorites',
                    method: 'POST',
                    token,
                    body,
                });
            }
        } catch (e) {
            console.warn('Failed to toggle favorite:', e);
            setIsFavorited(previousState); // Revert
        }
    };

    const handleShareItem = useCallback(async () => {
        const shareKind = isManual && manual?.id ? 'manuals' : 'collectables';
        const shareId = shareKind === 'manuals'
            ? manual?.id
            : (collectable?.id || resolvedCollectableId);
        if (!shareId || shareBusy) return;
        setShareBusy(true);
        try {
            const shareName = source?.title || source?.name || `item-${shareId}`;
            await shareEntityLink({
                apiBase,
                kind: shareKind,
                id: shareId,
                title: shareName,
                slugSource: shareName,
            });
        } catch (_err) {
            Alert.alert('Unable to share', 'Please try again.');
        } finally {
            setShareBusy(false);
        }
    }, [apiBase, collectable?.id, isManual, manual?.id, resolvedCollectableId, shareBusy, source?.name, source?.title]);

    const handlePickCoverImage = async () => {
        if (!shelfId || !item?.id) {
            Alert.alert('Error', 'Cannot upload cover: missing item information');
            return;
        }

        try {
            // Request permission
            const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (!permissionResult.granted) {
                Alert.alert('Permission Required', 'Please grant photo library access to upload a cover image.');
                return;
            }

            // Launch image picker
            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ['images'],
                allowsEditing: true,
                aspect: [3, 4], // Portrait for cover images
                quality: 0.8,
            });

            if (result.canceled) return;

            const selectedImage = result.assets[0];
            if (!selectedImage?.uri) return;

            setIsUploadingCover(true);

            // Create form data for upload
            const formData = new FormData();
            const filename = selectedImage.uri.split('/').pop() || 'cover.jpg';
            const mimeType = selectedImage.mimeType || 'image/jpeg';

            formData.append('cover', {
                uri: selectedImage.uri,
                name: filename,
                type: mimeType,
            });
            const authToken = await getValidToken(token);
            if (!authToken) {
                throw new Error('Session expired. Please sign in again.');
            }

            // Upload to API
            const response = await fetch(`${apiBase}/api/shelves/${shelfId}/manual/${item.id}/cover`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                body: formData,
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || 'Upload failed');
            }

            const data = await response.json();

            // Update local state with the new cover URL
            if (data.manual?.coverMediaUrl) {
                setManualCoverUrl(data.manual.coverMediaUrl);
            } else if (data.manual?.coverMediaPath) {
                setManualCoverUrl(buildMediaUri(data.manual.coverMediaPath, apiBase));
            }

        } catch (e) {
            console.warn('Failed to upload cover:', e);
            Alert.alert('Upload Failed', e.message || 'Failed to upload cover image');
        } finally {
            setIsUploadingCover(false);
        }
    };

    const resolveApiUri = (path) => {
        if (!path) return null;
        if (/^https?:/i.test(path)) return path;
        if (!apiBase) return path;
        return `${apiBase.replace(/\/+$/, '')}${path.startsWith('/') ? '' : '/'}${path}`;
    };

    const getTempOwnerPhotoUri = (ext = 'jpg') => {
        const baseDir = FileSystem.cacheDirectory || FileSystem.documentDirectory;
        if (!baseDir) {
            throw new Error('Unable to access local cache directory');
        }
        return `${baseDir}owner-photo-${Date.now()}-${Math.round(Math.random() * 1000000)}.${ext}`;
    };

    const getImageSizeAsync = (uri) => (
        new Promise((resolve, reject) => {
            Image.getSize(
                uri,
                (width, height) => resolve({ width, height }),
                (err) => reject(err || new Error('Failed to read image size')),
            );
        })
    );

    const getCenteredCrop = ({ width, height, aspectWidth, aspectHeight }) => {
        if (!width || !height || !aspectWidth || !aspectHeight) {
            throw new Error('Invalid crop dimensions');
        }
        const targetRatio = aspectWidth / aspectHeight;
        const imageRatio = width / height;
        let cropWidth = width;
        let cropHeight = height;

        if (imageRatio > targetRatio) {
            cropHeight = height;
            cropWidth = Math.round(height * targetRatio);
        } else {
            cropWidth = width;
            cropHeight = Math.round(width / targetRatio);
        }

        return {
            originX: Math.max(0, Math.floor((width - cropWidth) / 2)),
            originY: Math.max(0, Math.floor((height - cropHeight) / 2)),
            width: Math.max(1, cropWidth),
            height: Math.max(1, cropHeight),
        };
    };

    const uploadOwnerPhotoFromUri = async (uri, mimeType = 'image/jpeg') => {
        if (!canEditOwnerPhoto) return null;
        if (!uri) throw new Error('Photo URI is required');

        setOwnerPhotoBusy(true);
        try {
            const authToken = await getValidToken(token);
            if (!authToken) {
                throw new Error('Session expired. Please sign in again.');
            }

            const formData = new FormData();
            const filename = uri.split('/').pop() || `owner-photo-${Date.now()}.jpg`;
            formData.append('photo', {
                uri,
                name: filename,
                type: mimeType || 'image/jpeg',
            });

            const response = await fetch(`${apiBase}/api/shelves/${shelfId}/items/${item.id}/owner-photo`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
                body: formData,
            });
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || 'Upload failed');
            }

            const data = await response.json();
            const nextOwnerPhoto = data?.ownerPhoto || null;
            setOwnerPhoto(nextOwnerPhoto);
            return nextOwnerPhoto;
        } finally {
            setOwnerPhotoBusy(false);
        }
    };

    const handleSaveNotes = useCallback(async () => {
        if (!canEditNotes || !notesShelfId || !item?.id) return;

        const normalizedNotes = notesDraft.trim() || null;
        setNotesSaving(true);
        try {
            if (isManual) {
                const data = await apiRequest({
                    apiBase,
                    path: `/api/shelves/${notesShelfId}/manual/${item.id}`,
                    method: 'PUT',
                    token,
                    body: {
                        notes: normalizedNotes,
                        reviewedEventId: reviewedEventId || undefined,
                        shareToFeed,
                    },
                });
                const nextNotes = data?.item?.notes ?? normalizedNotes;
                setCollectionNotes(nextNotes);
                setReviewedEventId(data?.item?.reviewedEventId ?? reviewedEventId ?? null);
                setReviewPublishedAt(data?.item?.reviewPublishedAt ?? reviewPublishedAt ?? null);
                setReviewUpdatedAt(data?.item?.reviewUpdatedAt ?? reviewUpdatedAt ?? null);
                const normalizedNext = String(nextNotes ?? '').trim();
                const normalizedNextLower = normalizedNext.toLowerCase();
                setIsEditingNotes(!(normalizedNext && normalizedNextLower !== 'null' && normalizedNextLower !== 'undefined'));
                setShareToFeed(false);
                if (data?.item?.manual) {
                    setResolvedManual((prev) => ({ ...(prev || {}), ...data.item.manual }));
                }
            } else {
                const saveCollectableNotes = async (targetItemId) => apiRequest({
                    apiBase,
                    path: `/api/shelves/${notesShelfId}/items/${targetItemId}/rating`,
                    method: 'PUT',
                    token,
                    body: {
                        notes: normalizedNotes,
                        collectableId: item?.collectable?.id || item?.collectableId || collectable?.id || resolvedCollectableId || undefined,
                        reviewedEventId: reviewedEventId || undefined,
                        shareToFeed,
                    },
                });

                let data;
                try {
                    data = await saveCollectableNotes(item.id);
                } catch (err) {
                    if (err?.status !== 404 || !collectable?.id) {
                        throw err;
                    }

                    // Some navigation paths pass collectable.id instead of shelf item id.
                    // Resolve the matching collection row id and retry once.
                    const shelfData = await apiRequest({
                        apiBase,
                        path: `/api/shelves/${notesShelfId}/items`,
                        token,
                    });
                    const matchedItem = (Array.isArray(shelfData?.items) ? shelfData.items : [])
                        .find((entry) => String(entry?.collectable?.id) === String(collectable.id));
                    if (!matchedItem?.id) {
                        throw err;
                    }
                    data = await saveCollectableNotes(matchedItem.id);
                }

                const nextNotes = data?.item?.notes ?? normalizedNotes;
                setCollectionNotes(nextNotes);
                setReviewedEventId(data?.item?.reviewedEventId ?? reviewedEventId ?? null);
                setReviewPublishedAt(data?.item?.reviewPublishedAt ?? reviewPublishedAt ?? null);
                setReviewUpdatedAt(data?.item?.reviewUpdatedAt ?? reviewUpdatedAt ?? null);
                const normalizedNext = String(nextNotes ?? '').trim();
                const normalizedNextLower = normalizedNext.toLowerCase();
                setIsEditingNotes(!(normalizedNext && normalizedNextLower !== 'null' && normalizedNextLower !== 'undefined'));
                setShareToFeed(false);
            }
        } catch (err) {
            console.warn('Failed to save notes:', err);
            const isCollectableNotFound = !isManual && /item not found/i.test(String(err?.message || ''));
            if (isCollectableNotFound) {
                try {
                    const shelfData = await apiRequest({
                        apiBase,
                        path: `/api/shelves/${notesShelfId}/items?limit=200&skip=0`,
                        token,
                    });
                    const targetCollectableId = resolvedCollectableId || collectable?.id || null;
                    const matchedItem = (Array.isArray(shelfData?.items) ? shelfData.items : []).find((entry) => (
                        (targetCollectableId && String(entry?.collectable?.id) === String(targetCollectableId))
                        || String(entry?.id) === String(item?.id)
                    ));
                    if (matchedItem) {
                        const serverNotes = (matchedItem.notes || '').trim();
                        const intendedNotes = (normalizedNotes || '').trim();
                        if (serverNotes === intendedNotes) {
                            setCollectionNotes(matchedItem.notes ?? null);
                            setIsEditingNotes(!serverNotes);
                            setShareToFeed(false);
                            return;
                        }
                    }
                } catch (_verifyErr) {
                    // fall through to user-visible error
                }
            }
            Alert.alert('Error', err?.message || 'Failed to save notes');
        } finally {
            setNotesSaving(false);
        }
    }, [apiBase, canEditNotes, collectable?.id, isManual, item?.collectable?.id, item?.collectableId, item?.id, notesDraft, notesShelfId, resolvedCollectableId, reviewPublishedAt, reviewUpdatedAt, reviewedEventId, shareToFeed, token]);

    const addOwnedPlatformFromDraft = useCallback(() => {
        const candidate = platformDraft.trim();
        if (!candidate) return;
        if (ownedPlatforms.length >= MAX_OWNED_PLATFORMS) {
            Alert.alert('Limit reached', `You can store up to ${MAX_OWNED_PLATFORMS} owned platforms per item.`);
            return;
        }
        const alreadyOwned = ownedPlatforms.some((entry) => entry.toLowerCase() === candidate.toLowerCase());
        if (alreadyOwned) {
            setPlatformDraft('');
            return;
        }
        setOwnedPlatforms((prev) => normalizeUniqueStrings([...prev, candidate]));
        setPlatformDraft('');
    }, [ownedPlatforms, platformDraft]);

    const removeOwnedPlatform = useCallback((name) => {
        const needle = String(name || '').trim().toLowerCase();
        if (!needle) return;
        setOwnedPlatforms((prev) => prev.filter((entry) => String(entry || '').trim().toLowerCase() !== needle));
    }, []);

    const addOwnedPlatformSuggestion = useCallback((name) => {
        const candidate = String(name || '').trim();
        if (!candidate) return;
        if (ownedPlatforms.length >= MAX_OWNED_PLATFORMS) return;
        setOwnedPlatforms((prev) => normalizeUniqueStrings([...prev, candidate]));
    }, [ownedPlatforms]);

    const handleSaveOwnedPlatforms = useCallback(async () => {
        if (!canEditOwnedPlatforms || !notesShelfId || !item?.id) return;
        if (!ownedPlatformFormat) {
            Alert.alert('Format required', 'Select Physical or Digital before saving owned platforms.');
            return;
        }

        setOwnedPlatformsSaving(true);
        try {
            const payload = {
                platforms: normalizeUniqueStrings(ownedPlatforms),
                format: ownedPlatformFormat,
            };
            const data = await apiRequest({
                apiBase,
                path: `/api/shelves/${notesShelfId}/items/${item.id}/platforms`,
                method: 'PUT',
                token,
                body: payload,
            });
            const nextOwned = normalizeUniqueStrings(data?.item?.ownedPlatforms ?? payload.platforms);
            const nextFormat = normalizeOwnedGameFormat(
                data?.item?.collectable?.format ?? payload.format ?? ownedPlatformFormat,
            );
            setOwnedPlatforms(nextOwned);
            setOwnedPlatformFormat(nextFormat);
            setPlatformMissing(!!data?.item?.platformMissing);
            setIsEditingOwnedPlatforms(false);
            setPlatformDraft('');
        } catch (err) {
            console.warn('Failed to save owned platforms:', err);
            Alert.alert('Error', err?.message || 'Failed to update owned platforms');
        } finally {
            setOwnedPlatformsSaving(false);
        }
    }, [apiBase, canEditOwnedPlatforms, item?.id, notesShelfId, ownedPlatformFormat, ownedPlatforms, token]);

    const handleUploadOwnerPhoto = async () => {
        if (!canEditOwnerPhoto) return;
        try {
            const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (!permissionResult.granted) {
                Alert.alert('Permission Required', 'Please grant photo library access to upload your photo.');
                return;
            }

            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ['images'],
                allowsEditing: true,
                quality: 0.8,
            });
            if (result.canceled) return;

            const selectedImage = result.assets[0];
            if (!selectedImage?.uri) return;
            const mimeType = selectedImage.mimeType || 'image/jpeg';
            await uploadOwnerPhotoFromUri(selectedImage.uri, mimeType);
        } catch (err) {
            console.warn('Failed to upload owner photo:', err);
            Alert.alert('Upload Failed', err?.message || 'Failed to upload your photo');
        }
    };

    const handleOpenOwnerPhotoViewer = async () => {
        if (!ownerPhoto?.hasPhoto || !ownerPhotoImageUri) return;
        try {
            setOwnerPhotoViewerLoading(true);
            const authToken = await getValidToken(token);
            if (!authToken) {
                throw new Error('Session expired. Please sign in again.');
            }
            const ext = ownerPhoto?.contentType?.includes('png') ? 'png' : 'jpg';
            const localUri = getTempOwnerPhotoUri(ext);
            const downloaded = await FileSystem.downloadAsync(ownerPhotoImageUri, localUri, {
                headers: {
                    Authorization: `Bearer ${authToken}`,
                    'ngrok-skip-browser-warning': 'true',
                },
            });
            setOwnerPhotoViewerOriginalUri(downloaded.uri);
            setOwnerPhotoViewerUri(downloaded.uri);
            setOwnerPhotoViewerEditing(false);
            setOwnerPhotoViewerVisible(true);
        } catch (err) {
            console.warn('Failed to open owner photo viewer:', err);
            Alert.alert('Error', err?.message || 'Unable to load your photo');
        } finally {
            setOwnerPhotoViewerLoading(false);
        }
    };

    const handleCloseOwnerPhotoViewer = () => {
        setOwnerPhotoViewerEditing(false);
        setOwnerPhotoViewerVisible(false);
    };

    const handleEnterOwnerPhotoEditMode = () => {
        if (!canEditOwnerPhoto || !ownerPhotoViewerUri) return;
        setOwnerPhotoViewerEditing(true);
    };

    const handleCancelOwnerPhotoCropper = () => {
        setOwnerPhotoViewerEditing(false);
    };

    const roundDebug = (value, precision = 3) => {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return null;
        const scale = 10 ** precision;
        return Math.round(numeric * scale) / scale;
    };

    const rectDebug = (rect) => {
        if (!rect || typeof rect !== 'object') return null;
        return {
            left: roundDebug(rect.left),
            top: roundDebug(rect.top),
            right: roundDebug(rect.right),
            bottom: roundDebug(rect.bottom),
            width: roundDebug((Number(rect.right) || 0) - (Number(rect.left) || 0)),
            height: roundDebug((Number(rect.bottom) || 0) - (Number(rect.top) || 0)),
        };
    };

    const cropDebug = (stage, payload) => {
        if (!__DEV__) return;
        try {
            console.log(`[OwnerPhotoCropDebug] [CollectableDetail] ${stage}`, JSON.stringify(payload));
        } catch {
            console.log(`[OwnerPhotoCropDebug] [CollectableDetail] ${stage}`, payload);
        }
    };

    const handleSaveOwnerPhotoCropper = async (cropData) => {
        if (!canEditOwnerPhoto || !ownerPhotoViewerUri) return;
        setOwnerPhotoViewerApplying(true);
        let debugSnapshot = { stage: 'start' };
        try {
            const { mainCrop, thumbnailBox, viewSize, imageSize, displayBaseScale } = cropData;
            if (!mainCrop || !viewSize || !imageSize) {
                throw new Error('Editor payload is incomplete');
            }

            const clamp01 = (value) => Math.max(0, Math.min(1, value));
            const rotation = Number(mainCrop.rotation || 0);
            const absRotationRad = Math.abs(rotation * Math.PI / 180);
            cropDebug('save.begin', {
                mainCrop,
                thumbnailBox,
                viewSize,
                imageSize,
                displayBaseScale,
                canEditOwnerPhoto,
            });

            const largestInscribedRect = (width, height, angleRad) => {
                const w = Math.max(1, Number(width) || 1);
                const h = Math.max(1, Number(height) || 1);
                const sinA = Math.abs(Math.sin(angleRad));
                const cosA = Math.abs(Math.cos(angleRad));

                if (sinA < 1e-8 || cosA < 1e-8) {
                    return { width: w, height: h };
                }

                const widthIsLonger = w >= h;
                const sideLong = widthIsLonger ? w : h;
                const sideShort = widthIsLonger ? h : w;

                let inscribedW;
                let inscribedH;
                if (sideShort <= 2 * sinA * cosA * sideLong || Math.abs(sinA - cosA) < 1e-10) {
                    const x = 0.5 * sideShort;
                    if (widthIsLonger) {
                        inscribedW = x / sinA;
                        inscribedH = x / cosA;
                    } else {
                        inscribedW = x / cosA;
                        inscribedH = x / sinA;
                    }
                } else {
                    const cos2A = (cosA * cosA) - (sinA * sinA);
                    inscribedW = ((w * cosA) - (h * sinA)) / cos2A;
                    inscribedH = ((h * cosA) - (w * sinA)) / cos2A;
                }

                return {
                    width: Math.max(1, Math.min(w, Math.round(inscribedW))),
                    height: Math.max(1, Math.min(h, Math.round(inscribedH))),
                };
            };

            // 1) Rotate first, then crop against measured rotated output dimensions.
            let rotated = {
                uri: ownerPhotoViewerUri,
                width: Number(imageSize.width) || 0,
                height: Number(imageSize.height) || 0,
            };
            if (Math.abs(rotation) > 0.01) {
                rotated = await ImageManipulator.manipulateAsync(
                    ownerPhotoViewerUri,
                    [{ rotate: rotation }],
                    { compress: 1, format: ImageManipulator.SaveFormat.JPEG },
                );
            }
            const rotatedWidth = Math.max(1, Number(rotated.width) || 0);
            const rotatedHeight = Math.max(1, Number(rotated.height) || 0);
            cropDebug('save.rotated', {
                rotation: roundDebug(rotation),
                rotatedWidth,
                rotatedHeight,
                sourceWidth: Number(imageSize.width) || 0,
                sourceHeight: Number(imageSize.height) || 0,
            });

            // 2) Recompute crop from live transform state.
            const derivedBaseScale = Math.min(
                Number(viewSize.width) / Math.max(1, Number(imageSize.width)),
                Number(viewSize.height) / Math.max(1, Number(imageSize.height)),
            );
            const initialImgScale = Number.isFinite(Number(displayBaseScale)) && Number(displayBaseScale) > 0
                ? Number(displayBaseScale)
                : derivedBaseScale;
            const finalScale = initialImgScale * Math.max(0.01, Number(mainCrop.scale) || 1);
            const cropW = Number(viewSize.width) / finalScale;
            const cropH = Number(viewSize.height) / finalScale;

            const centerImageX = rotatedWidth / 2;
            const centerImageY = rotatedHeight / 2;
            const originX = centerImageX - (Number(mainCrop.translateX || 0) / finalScale) - (cropW / 2);
            const originY = centerImageY - (Number(mainCrop.translateY || 0) / finalScale) - (cropH / 2);

            const left = originX;
            const top = originY;
            const right = originX + cropW;
            const bottom = originY + cropH;
            const requestedRect = { left, top, right, bottom };

            let validBounds = { left: 0, top: 0, right: rotatedWidth, bottom: rotatedHeight };
            if (Math.abs(rotation) > 0.01) {
                const inscribed = largestInscribedRect(
                    Number(imageSize.width) || rotatedWidth,
                    Number(imageSize.height) || rotatedHeight,
                    absRotationRad,
                );
                const validLeft = (rotatedWidth - inscribed.width) / 2;
                const validTop = (rotatedHeight - inscribed.height) / 2;
                validBounds = {
                    left: validLeft,
                    top: validTop,
                    right: validLeft + inscribed.width,
                    bottom: validTop + inscribed.height,
                };
            }

            const safeLeft = Math.max(validBounds.left, left);
            const safeTop = Math.max(validBounds.top, top);
            const safeRight = Math.min(validBounds.right, right);
            const safeBottom = Math.min(validBounds.bottom, bottom);
            const safeWidth = Math.floor(safeRight - safeLeft);
            const safeHeight = Math.floor(safeBottom - safeTop);
            const safeRect = {
                left: safeLeft,
                top: safeTop,
                right: safeRight,
                bottom: safeBottom,
            };
            debugSnapshot = {
                stage: 'computed_bounds',
                rotation: roundDebug(rotation),
                initialImgScale: roundDebug(initialImgScale, 6),
                derivedBaseScale: roundDebug(derivedBaseScale, 6),
                finalScale: roundDebug(finalScale, 6),
                input: {
                    viewSize,
                    imageSize,
                    mainCrop: {
                        scale: roundDebug(mainCrop.scale, 6),
                        translateX: roundDebug(mainCrop.translateX),
                        translateY: roundDebug(mainCrop.translateY),
                        rotation: roundDebug(mainCrop.rotation),
                    },
                },
                rotatedSize: { width: rotatedWidth, height: rotatedHeight },
                requestedRect: rectDebug(requestedRect),
                validBounds: rectDebug(validBounds),
                safeRect: rectDebug(safeRect),
                safeWidth,
                safeHeight,
                outOfBounds: safeWidth < 1 || safeHeight < 1,
            };
            cropDebug('save.bounds', debugSnapshot);

            if (safeWidth < 1 || safeHeight < 1) {
                cropDebug('save.reject.out_of_bounds', debugSnapshot);
                throw new Error('Selected crop area is outside valid image bounds. Please adjust and try again.');
            }

            const manipulated = await ImageManipulator.manipulateAsync(
                rotated.uri,
                [{
                    crop: {
                        originX: Math.floor(safeLeft),
                        originY: Math.floor(safeTop),
                        width: safeWidth,
                        height: safeHeight,
                    },
                }],
                { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG },
            );
            cropDebug('save.cropped', {
                manipulatedWidth: Number(manipulated.width) || null,
                manipulatedHeight: Number(manipulated.height) || null,
                cropRect: {
                    originX: Math.floor(safeLeft),
                    originY: Math.floor(safeTop),
                    width: safeWidth,
                    height: safeHeight,
                },
            });

            // 3. Upload main owner photo
            await uploadOwnerPhotoFromUri(manipulated.uri, 'image/jpeg');
            
            // 4. Send thumbnail box if provided
            if (thumbnailBox && thumbnailBox.scale) {
                const baseThumbW = viewSize.width * 0.6;
                const baseThumbH = baseThumbW * (4 / 3);
                const safeThumbScale = Math.max(0.05, Number(thumbnailBox.scale) || 1);
                const thumbScreenW = baseThumbW * safeThumbScale;
                const thumbScreenH = baseThumbH * safeThumbScale;
                const thumbScreenX = (viewSize.width / 2) - (thumbScreenW / 2) + Number(thumbnailBox.translateX || 0);
                const thumbScreenY = (viewSize.height / 2) - (thumbScreenH / 2) + Number(thumbnailBox.translateY || 0);
                
                // Convert thumbScreen to original unclipped crop coordinates:
                const unclippedScaleX = cropW / viewSize.width;
                const unclippedScaleY = cropH / viewSize.height;

                const thumbUnclippedX = thumbScreenX * unclippedScaleX;
                const thumbUnclippedY = thumbScreenY * unclippedScaleY;
                const thumbUnclippedW = thumbScreenW * unclippedScaleX;
                const thumbUnclippedH = thumbScreenH * unclippedScaleY;

                // Now offset by the amount we clipped off
                const finalThumbX = thumbUnclippedX - (safeLeft - left);
                const finalThumbY = thumbUnclippedY - (safeTop - top);
                const finalThumbW = thumbUnclippedW;
                const finalThumbH = thumbUnclippedH;
                const manipulatedWidth = Math.max(1, Number(manipulated.width) || 1);
                const manipulatedHeight = Math.max(1, Number(manipulated.height) || 1);
                const thumbRect = {
                    left: finalThumbX,
                    top: finalThumbY,
                    right: finalThumbX + finalThumbW,
                    bottom: finalThumbY + finalThumbH,
                };
                const clippedRect = {
                    left: Math.max(0, Math.min(manipulatedWidth, thumbRect.left)),
                    top: Math.max(0, Math.min(manipulatedHeight, thumbRect.top)),
                    right: Math.max(0, Math.min(manipulatedWidth, thumbRect.right)),
                    bottom: Math.max(0, Math.min(manipulatedHeight, thumbRect.bottom)),
                };
                const clippedWidth = Math.max(0, clippedRect.right - clippedRect.left);
                const clippedHeight = Math.max(0, clippedRect.bottom - clippedRect.top);

                const normalizedBox = {
                    x: clamp01(clippedRect.left / manipulatedWidth),
                    y: clamp01(clippedRect.top / manipulatedHeight),
                    width: clamp01(clippedWidth / manipulatedWidth),
                    height: clamp01(clippedHeight / manipulatedHeight),
                };
                cropDebug('save.thumbnail', {
                    thumbScreen: {
                        x: roundDebug(thumbScreenX),
                        y: roundDebug(thumbScreenY),
                        width: roundDebug(thumbScreenW),
                        height: roundDebug(thumbScreenH),
                    },
                    normalizedBox: {
                        x: roundDebug(normalizedBox.x, 6),
                        y: roundDebug(normalizedBox.y, 6),
                        width: roundDebug(normalizedBox.width, 6),
                        height: roundDebug(normalizedBox.height, 6),
                    },
                    thumbRect: rectDebug(thumbRect),
                    clippedRect: rectDebug(clippedRect),
                    manipulatedWidth,
                    manipulatedHeight,
                });
                if (normalizedBox.width <= 0 || normalizedBox.height <= 0) {
                    throw new Error('Thumbnail selection is invalid. Please reframe and try again.');
                }
                
                const authToken = await getValidToken(token);
                const thumbResp = await fetch(`${apiBase}/api/shelves/${shelfId}/items/${item.id}/owner-photo/thumbnail`, {
                    method: 'PUT',
                    headers: {
                        Authorization: `Bearer ${authToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        box: normalizedBox
                    })
                });
                if (!thumbResp.ok) {
                    const bodyText = await thumbResp.text().catch(() => '');
                    throw new Error(`Thumbnail update failed (${thumbResp.status}): ${bodyText || thumbResp.statusText}`);
                }
            }

            setOwnerPhotoViewerVisible(false);
        } catch (err) {
            const message = err?.message || 'Unable to process and save photo edits';
            cropDebug('save.error', {
                message,
                stage: debugSnapshot?.stage || null,
                snapshot: debugSnapshot,
            });
            console.warn('Failed to save owner photo cropper:', message, err);
            Alert.alert('Save Failed', message);
        } finally {
            setOwnerPhotoViewerApplying(false);
        }
    };

    const handleToggleOwnerPhotoVisibility = async (nextVisible) => {
        if (!canEditOwnerPhoto) return;
        try {
            setOwnerPhotoBusy(true);
            const data = await apiRequest({
                apiBase,
                path: `/api/shelves/${shelfId}/items/${item.id}/owner-photo/visibility`,
                method: 'PUT',
                token,
                body: { visible: !!nextVisible },
            });
            setOwnerPhoto(data?.ownerPhoto || null);
        } catch (err) {
            console.warn('Failed to update owner photo visibility:', err);
            Alert.alert('Error', 'Failed to update photo visibility');
        } finally {
            setOwnerPhotoBusy(false);
        }
    };

    const handleDeleteOwnerPhoto = async () => {
        if (!canEditOwnerPhoto || !ownerPhoto?.hasPhoto) return;
        try {
            setOwnerPhotoBusy(true);
            const data = await apiRequest({
                apiBase,
                path: `/api/shelves/${shelfId}/items/${item.id}/owner-photo`,
                method: 'DELETE',
                token,
            });
            setOwnerPhoto(data?.ownerPhoto || null);
            setOwnerPhotoViewerVisible(false);
        } catch (err) {
            console.warn('Failed to delete owner photo:', err);
            Alert.alert('Error', 'Failed to delete your photo');
        } finally {
            setOwnerPhotoBusy(false);
        }
    };

    const handleConfirmDeleteOwnerPhoto = () => {
        if (!canEditOwnerPhoto || !ownerPhoto?.hasPhoto) return;
        Alert.alert(
            'Delete your photo?',
            'This removes your attached photo from this shelf item.',
            [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: handleDeleteOwnerPhoto },
            ],
        );
    };

    const resolveValue = (obj, path) => {
        if (!obj) return null;
        return path.split('.').reduce((prev, curr) => prev ? prev[curr] : null, obj);
    };

    const normalizeDisplayText = (value) => {
        if (value === null || value === undefined) return null;
        const normalized = String(value).trim();
        if (!normalized) return null;
        const lower = normalized.toLowerCase();
        if (lower === 'null' || lower === 'undefined') return null;
        return normalized;
    };

    const title = source?.title || source?.name || 'Untitled';
    const subtitle = source?.author || source?.primaryCreator || source?.publisher || '';
    const type = source?.type || source?.kind || 'Item';
    const normalizedType = String(type).trim().toLowerCase();
    const isMovieType = ['movie', 'movies', 'film', 'films'].includes(normalizedType);
    const description = normalizeDisplayText(source?.description) || normalizeDisplayText(source?.overview) || '';
    const personalNotes = normalizeDisplayText(collectionNotes) || '';
    const tagValues = (() => {
        const sourceTags = Array.isArray(source?.tags)
            ? source.tags
            : (source?.tags ? [source.tags] : []);
        const out = [];
        const seen = new Set();
        for (const entry of sourceTags) {
            const value = normalizeDisplayText(entry);
            if (!value) continue;
            const key = value.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(value);
        }
        return out;
    })();
    const castEntries = (() => {
        const memberSource = Array.isArray(source?.castMembers)
            ? source.castMembers
            : (Array.isArray(source?.cast_members) ? source.cast_members : []);
        const castSource = Array.isArray(source?.cast)
            ? source.cast
            : (source?.cast ? [source.cast] : []);
        const out = [];
        const seen = new Set();

        const pushCastEntry = (nameValue, characterValue = null) => {
            const name = normalizeDisplayText(nameValue);
            if (!name) return;
            const key = name.toLowerCase();
            if (seen.has(key)) return;
            seen.add(key);
            out.push({
                name,
                character: normalizeDisplayText(characterValue),
            });
        };

        memberSource.forEach((entry) => {
            if (entry && typeof entry === 'object') {
                pushCastEntry(entry.name, entry.character || entry.role);
                return;
            }
            pushCastEntry(entry);
        });

        castSource.forEach((entry) => {
            if (entry && typeof entry === 'object') {
                pushCastEntry(entry.name, entry.character || entry.role);
                return;
            }
            pushCastEntry(entry);
        });

        return out;
    })();
    const hasSavedNotes = !!personalNotes;
    const showNotesEditor = canEditNotes && (isEditingNotes || !hasSavedNotes);
    const normalizedOwnerUsername = String(ownerUsername || '').trim().replace(/^@+/, '');
    const notesSectionLabel = (!canEditNotes && normalizedOwnerUsername)
        ? `${normalizedOwnerUsername}'s Notes:`
        : 'Your Notes';
    const ownerRatingLabel = normalizedOwnerUsername
        ? `${normalizedOwnerUsername}'s rating:`
        : 'Owner rating:';
    const ownerPhotoSectionLabel = (isOwnerContext && normalizedOwnerUsername)
        ? `${normalizedOwnerUsername}'s Photo`
        : 'Your photos';
    const ownerPhotoViewerTitle = (isOwnerContext && normalizedOwnerUsername)
        ? `${normalizedOwnerUsername}'s photo`
        : 'Your photo';

    useFocusEffect(
        useCallback(() => {
            let isActive = true;
            if (!isManual || !baseManual?.id || !apiBase || !token) {
                return () => { isActive = false; };
            }

            (async () => {
                try {
                    const data = await apiRequest({
                        apiBase,
                        path: `/api/manuals/${baseManual.id}`,
                        token,
                    });
                    if (!isActive || !data?.manual) return;
                    setResolvedManual(data.manual);
                } catch (err) {
                    console.warn('Failed to refresh manual details on focus:', err?.message || err);
                }
            })();

            return () => { isActive = false; };
        }, [isManual, baseManual?.id, apiBase, token]),
    );

    const buildMetadata = () => {
        const excludedKeys = new Set([
            'id',
            'title',
            'name',
            'kind',
            'type',
            'description',
            'overview',
            'images',
            'identifiers',
            'sources',
            'coverUrl',
            'coverImageUrl',
            'coverImageSource',
            'coverMediaId',
            'coverMediaPath',
            'attribution',
            'externalId',
            'fingerprint',
            'lightweightFingerprint',
            'fuzzyFingerprints',
            'rawOcrFingerprint',
            '_raw',
            'raw',
            'cast',
            'castMembers',
            'cast_members',
            'tags',
            'urlCoverFront',
            'urlCoverBack',
            'coordinates',
            'position',
            'confidence',
            'manualFingerprint',
            'createdAt',
            'updatedAt',
        ]);

        // Hide internal metadata fields for manual items
        if (isManual) {
            excludedKeys.add('coverMediaUrl');
            excludedKeys.add('userId');
            excludedKeys.add('shelfId');
            excludedKeys.add('coverContentType');
        }
        if (isGameCollectableContext) {
            excludedKeys.add('systemName');
            excludedKeys.add('system_name');
        }

        const labelOverrides = {
            primaryCreator: isMovieType ? 'Director' : 'Creator',
            creators: 'Creators',
            publisher: 'Publisher',
            publishers: 'Publishers',
            systemName: 'System',
            formats: 'Formats',
            format: 'Format',
            year: 'Year',
            tags: 'Tags',
            genre: 'Genre',
            region: 'Region',
            regionalItem: 'Region',
            developer: 'Developer',
            author: 'Author',
            manufacturer: 'Manufacturer',
            subtitle: 'Subtitle',
            barcode: 'Barcode',
            ageStatement: 'Age Statement',
            specialMarkings: 'Special Markings',
            labelColor: 'Label Color',
            edition: 'Edition',
            pages: 'Pages',
            runtime: 'Runtime',
            status: 'Status',
            networks: 'Networks',
            numberOfSeasons: 'Seasons',
            numberOfEpisodes: 'Episodes',
            limitedEdition: 'Limited Edition',
            itemSpecificText: 'Item Details',
            marketValue: 'Market Value',
        };

        const valueFormatters = {
            runtime: (value) => `${value} min`,
            networks: (value) => Array.isArray(value) ? value.join(', ') : value,
        };

        const usedKeys = new Set();
        const entries = [];
        const manualEditableFields = [
            'format',
            'author',
            'publisher',
            'year',
            'genre',
            'edition',
            'limitedEdition',
            'ageStatement',
            'labelColor',
            'specialMarkings',
            'regionalItem',
            'barcode',
            'itemSpecificText',
            'marketValue',
        ];

        const prettifyLabel = (key) =>
            key
                .replace(/([A-Z])/g, ' $1')
                .replace(/_/g, ' ')
                .replace(/\b\w/g, (c) => c.toUpperCase())
                .trim();

        const normalizeValue = (value, key) => {
            if (value === null || value === undefined || value === '') return null;
            const formatter = valueFormatters[key];
            if (formatter) {
                return formatter(value);
            }
            if (Array.isArray(value)) {
                const flat = value
                    .map((entry) => (typeof entry === 'string' ? normalizeDisplayText(entry) : entry))
                    .filter((entry) => entry !== null && entry !== undefined && entry !== '');
                if (!flat.length) return null;
                if (flat.every((entry) => ['string', 'number', 'boolean'].includes(typeof entry))) {
                    return flat.join(', ');
                }
                return null;
            }
            if (typeof value === 'object') return null;
            if (typeof value === 'boolean') return value ? 'Yes' : 'No';
            if (typeof value === 'string') {
                return normalizeDisplayText(value);
            }
            return String(value);
        };

        const formatOneDecimal = (value) => {
            const parsed = Number(value);
            return Number.isFinite(parsed) ? parsed.toFixed(1) : null;
        };

        const resolveBaseValue = (key) => {
            let rawValue = resolveValue(source, key);
            if (!rawValue && !isManual && manual) {
                rawValue = resolveValue(manual, key);
            }
            return rawValue;
        };

        const resolveManualValue = (key) => {
            const aliasMap = {
                ageStatement: ['ageStatement', 'age_statement'],
                specialMarkings: ['specialMarkings', 'special_markings'],
                labelColor: ['labelColor', 'label_color'],
                regionalItem: ['regionalItem', 'regional_item'],
                limitedEdition: ['limitedEdition', 'limited_edition'],
                itemSpecificText: ['itemSpecificText', 'item_specific_text'],
            };
            const paths = aliasMap[key] || [key];
            for (const path of paths) {
                const value = resolveValue(manual, path);
                if (value !== null && value !== undefined && value !== '') {
                    return value;
                }
            }
            return null;
        };

        const addEntry = (key, label, rawValue, extra = {}) => {
            const value = normalizeValue(rawValue, key);
            if (value === null) return;
            entries.push({ label, value, ...extra });
            usedKeys.add(key);
        };

        if (isManual) {
            manualEditableFields.forEach((key) => {
                const value = resolveManualValue(key);
                if (key === 'marketValue' && value) {
                    const manualId = manual?.id;
                    addEntry(key, 'Est. Market Value', value, {
                        isLinkable: !!manualId,
                        onPress: manualId
                            ? () => navigation.navigate('MarketValueSources', {
                                collectableId: resolvedCollectableId || null,
                                manualId,
                                itemTitle: title,
                                detailRouteKey: route.key,
                                detailNavigatorKey: navigation.getState?.()?.key || null,
                            })
                            : undefined,
                    });
                    return;
                }
                const label = labelOverrides[key] || prettifyLabel(key);
                addEntry(key, label, value);
            });
            return entries;
        }

        const derivedFormat = () => {
            if (item?.format) return item.format;
            const direct = resolveBaseValue('format') || resolveValue(source, 'physical.format');
            if (direct) return direct;
            const formats = resolveBaseValue('formats');
            if (Array.isArray(formats) && formats.length) return formats.join(', ');
            return null;
        };

        const derivedPublisher = () => {
            const direct = resolveBaseValue('publisher');
            if (direct) return direct;
            const publishers = resolveBaseValue('publishers');
            if (Array.isArray(publishers) && publishers.length) return publishers.join(', ');
            return null;
        };

        const preferredKeys = [
            'format',
            ...(!isGameCollectableContext ? ['systemName'] : []),
            'publisher',
            'primaryCreator',
            'developer',
            'author',
            'year',
            'marketValue',
            'region',
            'genre',
            'platforms',
            'creators',
        ];

        preferredKeys.forEach((key) => {
            if (key === 'format') {
                addEntry(key, labelOverrides.format, derivedFormat());
                usedKeys.add('formats');
                usedKeys.add('format');
                return;
            }
            if (key === 'publisher') {
                addEntry(key, labelOverrides.publisher, derivedPublisher());
                usedKeys.add('publishers');
                usedKeys.add('publisher');
                return;
            }
            if (key === 'region') {
                const value = resolveBaseValue('region') || resolveBaseValue('regionalItem');
                addEntry('region', labelOverrides.region, value);
                usedKeys.add('regionalItem');
                return;
            }
            if (key === 'marketValue') {
                const apiValue = collectable?.marketValue;
                const value = resolveBaseValue(key);
                const isApiSourced = !!apiValue;
                const label = isApiSourced ? 'Est. Market Value' : (labelOverrides[key] || prettifyLabel(key));
                addEntry(key, label, value, {
                    isLinkable: isApiSourced && !!resolvedCollectableId,
                    onPress: isApiSourced && resolvedCollectableId
                        ? () => navigation.navigate('MarketValueSources', {
                            collectableId: resolvedCollectableId,
                            manualId: manual?.id || null,
                            itemTitle: title,
                            detailRouteKey: route.key,
                            detailNavigatorKey: navigation.getState?.()?.key || null,
                        })
                        : undefined,
                });
                return;
            }
            const value = resolveBaseValue(key);
            const label = labelOverrides[key] || prettifyLabel(key);
            addEntry(key, label, value);
        });

        if (isGameCollectableContext) {
            const maxPlayers = resolveCollectableMaxPlayers(source) ?? resolveCollectableMaxPlayers(collectable);
            addEntry('maxPlayers', '# of Players', maxPlayers);

            const rating = resolveCollectableRating(source) ?? resolveCollectableRating(collectable);
            const parsedIgdbRating = Number(rating);
            if (Number.isFinite(parsedIgdbRating) && parsedIgdbRating > 0) {
                addEntry('igdbRating', 'IGDB Rating', formatOneDecimal(parsedIgdbRating));
            }

            const ratingCount = resolveCollectableRatingCount(source) ?? resolveCollectableRatingCount(collectable);
            addEntry('igdbRatingCount', 'Rating Count', ratingCount);

            const ratingsData = resolveRatingsData(source) || resolveRatingsData(collectable);
            addEntry(
                'aggregatedRating',
                'Aggregated Rating',
                formatOneDecimal(ratingsData?.aggregatedRating),
            );
            addEntry('aggregatedRatingCount', 'Aggregated Rating Count', ratingsData?.aggregatedRatingCount ?? null);
            addEntry(
                'totalRating',
                'Total Rating',
                formatOneDecimal(ratingsData?.totalRating),
            );
            addEntry('totalRatingCount', 'Total Rating Count', ratingsData?.totalRatingCount ?? null);

            const multiplayerData = resolveMultiplayerData(source) || resolveMultiplayerData(collectable);
            addEntry('maxOnlinePlayers', 'Max Online Players', multiplayerData?.maxOnlinePlayers ?? multiplayerData?.onlinemax ?? null);
            addEntry('maxOfflinePlayers', 'Max Offline Players', multiplayerData?.maxOfflinePlayers ?? multiplayerData?.offlinemax ?? null);
            addEntry(
                'maxOnlineCoopPlayers',
                'Max Online Co-op Players',
                multiplayerData?.maxOnlineCoopPlayers ?? multiplayerData?.onlinecoopmax ?? null,
            );
            addEntry(
                'maxOfflineCoopPlayers',
                'Max Offline Co-op Players',
                multiplayerData?.maxOfflineCoopPlayers ?? multiplayerData?.offlinecoopmax ?? null,
            );
            addEntry('supportsOnlineCoop', 'Supports Online Co-op', multiplayerData?.supportsOnlineCoop ?? multiplayerData?.onlinecoop ?? null);
            addEntry('supportsOfflineCoop', 'Supports Offline Co-op', multiplayerData?.supportsOfflineCoop ?? multiplayerData?.offlinecoop ?? null);
            addEntry('supportsSplitScreen', 'Supports Split Screen', multiplayerData?.supportsSplitScreen ?? multiplayerData?.splitscreen ?? null);
        }

        const nestedGroups = [
            { key: 'physical', source: resolveBaseValue('physical') },
            { key: 'extras', source: resolveBaseValue('extras') },
        ];

        nestedGroups.forEach((group) => {
            if (!group.source || typeof group.source !== 'object') return;
            Object.entries(group.source).forEach(([key, value]) => {
                if (usedKeys.has(key) || excludedKeys.has(key)) return;
                const label = labelOverrides[key] || prettifyLabel(key);
                addEntry(key, label, value);
            });
        });

        const combinedKeys = new Set([
            ...Object.keys(source || {}),
            ...(!isManual && manual ? Object.keys(manual) : []),
        ]);

        combinedKeys.forEach((key) => {
            if (usedKeys.has(key) || excludedKeys.has(key)) return;
            const value = resolveBaseValue(key);
            const label = labelOverrides[key] || prettifyLabel(key);
            addEntry(key, label, value);
        });

        return entries;
    };

    const metadata = buildMetadata();
    if (userEstimate?.value) {
        metadata.push({ label: 'Your Estimate', value: userEstimate.value });
    }



    const resolveCoverUri = () => {
        // Check local state for recently uploaded manual cover first
        if (manualCoverUrl) {
            return manualCoverUrl;
        }

        // Check manual cover from item data (check regardless of isManual flag for robustness)
        // This handles cases where item comes from feed with manualSnapshot
        const manualUrl = resolveManualCoverUrl(manual, apiBase);
        if (manualUrl) {
            return manualUrl;
        }

        // Check collectable cover. Prefer resolved data, but preserve working
        // shelf-provided cover fields as fallback for display stability.
        const coverCollectable = {
            ...(resolvedCollectable || {}),
            ...(baseCollectable || {}),
            coverMediaUrl: resolvedCollectable?.coverMediaUrl || baseCollectable?.coverMediaUrl || null,
            coverMediaPath: resolvedCollectable?.coverMediaPath || baseCollectable?.coverMediaPath || null,
            coverImageUrl: resolvedCollectable?.coverImageUrl || baseCollectable?.coverImageUrl || null,
            coverUrl: resolvedCollectable?.coverUrl || baseCollectable?.coverUrl || null,
            images: (Array.isArray(resolvedCollectable?.images) && resolvedCollectable.images.length > 0)
                ? resolvedCollectable.images
                : (Array.isArray(baseCollectable?.images) ? baseCollectable.images : []),
        };
        return resolveCollectableCoverUrl(coverCollectable, apiBase);
    };

    const coverUri = resolveCoverUri();
    const coverViewerImageHitboxStyle = useMemo(() => {
        if (!Number.isFinite(coverViewerAspectRatio) || coverViewerAspectRatio <= 0) {
            return styles.coverViewerImageHitboxFallback;
        }
        if (coverViewerAspectRatio >= 1) {
            return {
                width: '100%',
                aspectRatio: coverViewerAspectRatio,
            };
        }
        return {
            height: '100%',
            aspectRatio: coverViewerAspectRatio,
        };
    }, [coverViewerAspectRatio, styles.coverViewerImageHitboxFallback]);

    const handleOpenCoverViewer = () => {
        if (!coverUri) return;
        setCoverViewerUri(coverUri);
        setCoverViewerVisible(true);
    };
    const handleCloseCoverViewer = () => {
        setCoverViewerVisible(false);
        setCoverViewerUri(null);
    };

    useEffect(() => {
        if (!coverViewerUri) {
            setCoverViewerAspectRatio(null);
            return;
        }
        let canceled = false;
        Image.getSize(
            coverViewerUri,
            (width, height) => {
                if (canceled) return;
                const ratio = Number(width) > 0 && Number(height) > 0
                    ? Number(width) / Number(height)
                    : null;
                setCoverViewerAspectRatio(ratio);
            },
            () => {
                if (canceled) return;
                setCoverViewerAspectRatio(null);
            },
        );
        return () => {
            canceled = true;
        };
    }, [coverViewerUri]);

    const rawOwnerPhotoVersion = ownerPhoto?.updatedAt
        ? new Date(ownerPhoto.updatedAt).getTime()
        : null;
    const ownerPhotoVersion = Number.isFinite(rawOwnerPhotoVersion) ? rawOwnerPhotoVersion : null;
    const ownerPhotoImageUri = ownerPhoto?.imageUrl
        ? (() => {
            const baseUri = resolveApiUri(ownerPhoto.imageUrl);
            if (!baseUri) return null;
            if (!ownerPhotoVersion) return baseUri;
            const hasQuery = baseUri.includes('?');
            return `${baseUri}${hasQuery ? '&' : '?'}v=${ownerPhotoVersion}`;
        })()
        : null;
    const ownerPhotoImageSource = ownerPhotoImageUri
        ? {
            uri: ownerPhotoImageUri,
            ...(imageAuthToken ? { headers: { Authorization: `Bearer ${imageAuthToken}`, 'ngrok-skip-browser-warning': 'true' } } : {}),
        }
        : null;
    const ownerPhotoViewerBusy = ownerPhotoViewerLoading || ownerPhotoViewerApplying || ownerPhotoBusy;
    const showOwnerPhotoSection = hasShelfItemContext
        ? (ownerPhotoLoading || !!ownerPhoto?.hasPhoto || canEditOwnerPhoto)
        : !(ownerId && user?.id && ownerId !== user.id);
    const isOtherManualItem = isManual && String(manual?.type || '').toLowerCase() === 'other';
    const shouldReplaceManualHeroWithOwnerPhoto = (
        isOtherManualItem
        && !!ownerPhoto?.hasPhoto
        && !!ownerPhotoImageSource
    );
    const showAutoScanSubtext = ownerPhoto?.source === 'vision_crop' && !!ownerPhoto?.hasPhoto;
    const showOwnerPhotoInRatingColumn = showOwnerPhotoSection && !shouldReplaceManualHeroWithOwnerPhoto;
    const showOwnerPhotoInHeroForCollectable = showOwnerPhotoInRatingColumn && !isManual;
    const platformOptions = useMemo(
        () => derivePlatformOptionsFromCollectable(
            collectable,
            item?.collectable?.systemName || item?.collectableSystemName || null,
        ),
        [collectable, item?.collectable?.systemName, item?.collectableSystemName],
    );
    const availableOwnedPlatformSuggestions = useMemo(() => {
        const ownedSet = new Set(normalizeUniqueStrings(ownedPlatforms).map((entry) => entry.toLowerCase()));
        return platformOptions.filter((entry) => !ownedSet.has(String(entry || '').trim().toLowerCase()));
    }, [platformOptions, ownedPlatforms]);

    useEffect(() => {
        setOwnedPlatforms(normalizeUniqueStrings(item?.ownedPlatforms));
        setPlatformDraft('');
        setIsEditingOwnedPlatforms(false);
        setOwnedPlatformFormat(normalizeOwnedGameFormat(
            item?.collectable?.format || item?.collectableSnapshot?.format || item?.format,
        ));
    }, [item?.id, item?.ownedPlatforms]);

    useEffect(() => {
        if (isEditingOwnedPlatforms) return;
        setOwnedPlatformFormat(normalizeOwnedGameFormat(
            collectable?.format || item?.collectable?.format || item?.collectableSnapshot?.format || item?.format,
        ));
    }, [
        collectable?.format,
        isEditingOwnedPlatforms,
        item?.collectable?.format,
        item?.collectableSnapshot?.format,
        item?.format,
    ]);

    useEffect(() => {
        setCollectionNotes(item?.notes ?? null);
    }, [item?.id, item?.notes]);

    useEffect(() => {
        setNotesDraft(collectionNotes || '');
    }, [collectionNotes, item?.id]);

    useEffect(() => {
        if (!canEditNotes) {
            setIsEditingNotes(false);
            return;
        }
        const normalized = String(collectionNotes ?? '').trim();
        const normalizedLower = normalized.toLowerCase();
        const hasExistingNotes = normalized && normalizedLower !== 'null' && normalizedLower !== 'undefined';
        setIsEditingNotes(!hasExistingNotes);
    }, [canEditNotes, collectionNotes, item?.id]);

    useEffect(() => {
        if (showNotesEditor) {
            setShareToFeed(hasPublishedReview);
        }
    }, [hasPublishedReview, showNotesEditor, item?.id]);

    useEffect(() => {
        const updatedManualEntry = route.params?.updatedManualEntry;
        if (!updatedManualEntry) return;
        if (String(updatedManualEntry.id) !== String(item?.id)) return;

        setCollectionNotes(updatedManualEntry.notes ?? null);
        if (updatedManualEntry.manual) {
            setResolvedManual((prev) => ({ ...(prev || {}), ...updatedManualEntry.manual }));
        }
    }, [route.params?.updatedManualEntryAt, route.params?.updatedManualEntry, item?.id]);

    const renderAttribution = () => {
        const attr = collectable?.attribution;
        if (!attr) return null;

        return (
            <View style={styles.attributionSection}>
                {attr.logoKey === 'tmdb' && (
                    <TmdbLogo width={100} height={24} style={styles.attributionLogo} />
                )}
                {attr.linkUrl && (
                    <TouchableOpacity
                        onPress={() => Linking.openURL(attr.linkUrl)}
                        style={styles.attributionLink}
                    >
                        <Ionicons name="open-outline" size={14} color={colors.primary} />
                        <Text style={styles.attributionLinkText}>
                            {attr.linkText || 'View Source'}
                        </Text>
                    </TouchableOpacity>
                )}
                {attr.disclaimerText && (
                    <Text style={styles.disclaimerText}>{attr.disclaimerText}</Text>
                )}
            </View>
        );
    };

    const renderOwnerPhotoCard = (extraStyle = null) => (
        <View style={[styles.ownerPhotoCard, extraStyle]}>
            <Text style={[styles.sectionTitle, styles.ownerPhotoSectionTitle]}>{ownerPhotoSectionLabel}</Text>
            {showAutoScanSubtext && !isOwnerContext && (
                <Text style={styles.ownerPhotoSubtext}>added automatically from your scan</Text>
            )}

            {!hasShelfItemContext ? (
                <Text style={styles.ownerPhotoHint}>
                    Open this item from a shelf to upload or replace your photo.
                </Text>
            ) : ownerPhotoLoading ? (
                <View style={styles.ownerPhotoLoading}>
                    <ActivityIndicator size="small" color={colors.primary} />
                </View>
            ) : (
                <>
                    {ownerPhoto?.hasPhoto && ownerPhotoImageSource ? (
                        <View style={styles.ownerPhotoImageWrap}>
                            <CachedImage
                                key={ownerPhotoVersion ? `owner-photo-${ownerPhotoVersion}` : 'owner-photo-current'}
                                source={ownerPhotoImageSource}
                                style={styles.ownerPhotoImage}
                                contentFit="cover"
                            />
                            <Pressable
                                style={styles.ownerPhotoOpenPressable}
                                onPress={handleOpenOwnerPhotoViewer}
                                disabled={ownerPhotoViewerBusy}
                            />
                            <View style={styles.ownerPhotoZoomBadge}>
                                <Ionicons name="expand-outline" size={12} color={colors.textInverted} />
                                <Text style={styles.ownerPhotoZoomText}>Open</Text>
                            </View>
                            {canEditOwnerPhoto && (
                                <TouchableOpacity
                                    style={[styles.ownerPhotoDeleteButton, ownerPhotoBusy && styles.ownerPhotoButtonDisabled]}
                                    onPress={handleConfirmDeleteOwnerPhoto}
                                    disabled={ownerPhotoBusy}
                                    activeOpacity={0.85}
                                >
                                    <Ionicons name="close" size={14} color="#000" />
                                </TouchableOpacity>
                            )}
                        </View>
                    ) : (
                        <Text style={styles.ownerPhotoHint}>No personal photo attached yet.</Text>
                    )}

                    {canEditOwnerPhoto && (
                        <>
                            <TouchableOpacity
                                style={[styles.ownerPhotoButton, ownerPhotoBusy && styles.ownerPhotoButtonDisabled]}
                                onPress={handleUploadOwnerPhoto}
                                disabled={ownerPhotoBusy}
                            >
                                <Ionicons name="camera-outline" size={16} color={colors.textInverted} />
                                <Text style={styles.ownerPhotoButtonText}>
                                    {ownerPhoto?.hasPhoto ? 'Replace your photo' : 'Upload your photo'}
                                </Text>
                            </TouchableOpacity>

                            <View style={styles.ownerPhotoVisibilityRow}>
                                <View style={{ flex: 1, paddingRight: spacing.sm }}>
                                    <Text style={styles.ownerPhotoVisibilityLabel}>Show to friends/public</Text>
                                    <Text style={styles.ownerPhotoVisibilityHint}>
                                        Controlled by your profile setting and shelf visibility
                                    </Text>
                                </View>
                                <Switch
                                    value={!!ownerPhoto?.visible}
                                    onValueChange={handleToggleOwnerPhotoVisibility}
                                    disabled={ownerPhotoBusy || !ownerPhoto?.hasPhoto}
                                    trackColor={{ false: colors.border, true: colors.primary + '80' }}
                                    thumbColor={ownerPhoto?.visible ? colors.primary : colors.surfaceElevated}
                                />
                            </View>
                        </>
                    )}
                </>
            )}
        </View>
    );

    return (
        <SafeAreaView style={styles.screen} edges={['top']}>
            <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />

            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
                    <Ionicons name="arrow-back" size={22} color={colors.text} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Details</Text>
                {isManual && !readOnly ? (
                    <TouchableOpacity
                        onPress={() => navigation.navigate('ManualEdit', {
                            item: { ...(item || {}), notes: collectionNotes },
                            shelfId,
                            detailRouteKey: route.key,
                            detailNavigatorKey: navigation.getState?.()?.key || null,
                        })}
                        style={styles.editButton}
                    >
                        <Ionicons name="pencil" size={18} color={colors.text} />
                    </TouchableOpacity>
                ) : (
                    <View style={{ width: 40 }} />
                )}
            </View>

            {canShowReplaceCTA && (
                <View style={styles.replaceCtaRow}>
                    <TouchableOpacity
                        onPress={handleStartReplacementFlow}
                        style={styles.replaceButton}
                        activeOpacity={0.7}
                    >
                        <Text style={styles.replaceButtonText}>Not the item you intended to add?</Text>
                    </TouchableOpacity>
                </View>
            )}

            <ScrollView
                style={styles.container}
                contentContainerStyle={[
                    styles.content,
                    bottomFooterSpacer > 0 ? { paddingBottom: 40 + bottomFooterSpacer } : null,
                ]}
            >
                {/* Hero */}
                <View style={styles.hero}>
                    {shouldReplaceManualHeroWithOwnerPhoto ? (
                        renderOwnerPhotoCard(styles.heroOwnerPhotoCard)
                    ) : (
                        <View style={styles.coverBox}>
                            {coverUri ? (
                                <TouchableOpacity
                                    style={styles.coverOpenButton}
                                    onPress={handleOpenCoverViewer}
                                    activeOpacity={0.9}
                                >
                                    <CachedImage
                                        source={{ uri: coverUri }}
                                        style={styles.coverImage}
                                        contentFit="cover"
                                    />
                                </TouchableOpacity>
                            ) : (
                                <View style={styles.coverFallback}>
                                    <CategoryIcon type={type} size={48} />
                                </View>
                            )}
                            {/* Camera overlay for manual items */}
                            {isManual && !readOnly && (
                                <TouchableOpacity
                                    style={styles.coverEditButton}
                                    onPress={handlePickCoverImage}
                                    disabled={isUploadingCover}
                                >
                                    {isUploadingCover ? (
                                        <ActivityIndicator size="small" color={colors.surface} />
                                    ) : (
                                        <Ionicons name="camera" size={18} color={colors.surface} />
                                    )}
                                </TouchableOpacity>
                            )}
                        </View>
                    )}
                    <Text style={styles.title}>{title}</Text>
                    {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
                    {platformMissing ? (
                        <View style={styles.platformMissingBadge}>
                            <Text style={styles.platformMissingBadgeText}>Platform missing</Text>
                        </View>
                    ) : null}
                    {showOwnerPhotoInHeroForCollectable && renderOwnerPhotoCard([
                        styles.heroOwnerPhotoCard,
                        styles.ownerPhotoUnderSubtitle,
                    ])}

                    {/* Actions Row */}
                    <View style={styles.actionsRow}>
                        <View style={styles.ratingInfoColumn}>
                            {showOwnerPhotoInRatingColumn && isManual && renderOwnerPhotoCard()}

                            {/* Aggregate Rating */}
                            <View style={styles.ratingBlock}>
                                <Text style={styles.ratingLabel}>Community</Text>
                                <View style={styles.ratingRow}>
                                    <Ionicons name="star" size={16} color={colors.warning} />
                                    <Text style={styles.ratingValue}>
                                        {aggregateRating?.average || '0.0'}
                                    </Text>
                                    <Text style={styles.ratingCount}>
                                        ({aggregateRating?.count || 0})
                                    </Text>
                                </View>
                            </View>

                            {/* Owner Rating (if visible) */}
                            {ownerId && user?.id && ownerId !== user.id && (
                                <View style={styles.ratingBlock}>
                                    <Text style={styles.ratingLabel}>{ownerRatingLabel}</Text>
                                    <View style={styles.ratingRow}>
                                        <Ionicons name="star" size={16} color={colors.primary} />
                                        <Text style={styles.ratingValue}>
                                            {ownerRating || '-'}
                                        </Text>
                                    </View>
                                </View>
                            )}

                            {/* Your Rating */}
                            <View style={styles.ratingBlock}>
                                <Text style={styles.ratingLabel}>You</Text>
                                <StarRating
                                    rating={rating}
                                    size={24}
                                    onRatingChange={handleRateItem}
                                />
                            </View>
                        </View>

                        <View
                            style={[
                                styles.actionButtonsColumn,
                                showOwnerPhotoInRatingColumn && isManual && styles.actionButtonsColumnAlignWithRatings,
                            ]}
                        >
                            {!hasShelfItemContext && user?.id && (collectable?.id || manual?.id) && !addedToShelfId && (
                                <TouchableOpacity
                                    onPress={() => setShowAddToShelfModal(true)}
                                    style={styles.actionIconBtn}
                                    activeOpacity={0.7}
                                >
                                    <Ionicons name="add-circle-outline" size={28} color={colors.primary} />
                                </TouchableOpacity>
                            )}
                            {!hasShelfItemContext && user?.id && addedToShelfId && (
                                <View style={styles.actionIconBtn}>
                                    <Ionicons name="checkmark-circle" size={28} color={colors.success || '#4CAF50'} />
                                </View>
                            )}
                            {(collectable?.id || manual?.id) && (
                                <TouchableOpacity
                                    onPress={handleToggleFavorite}
                                    style={styles.actionIconBtn}
                                    activeOpacity={0.7}
                                >
                                    <Ionicons
                                        name={isFavorited ? 'heart' : 'heart-outline'}
                                        size={28}
                                        color={isFavorited ? colors.error : colors.textMuted}
                                    />
                                </TouchableOpacity>
                            )}
                            <TouchableOpacity
                                onPress={handleOpenWishlistModal}
                                style={styles.actionIconBtn}
                                activeOpacity={0.7}
                            >
                                <Ionicons
                                    name="bookmark-outline"
                                    size={28}
                                    color={colors.textMuted}
                                />
                            </TouchableOpacity>
                            <TouchableOpacity
                                onPress={handleShareItem}
                                style={styles.actionIconBtn}
                                activeOpacity={0.7}
                                disabled={shareBusy}
                            >
                                {shareBusy ? (
                                    <ActivityIndicator size="small" color={colors.textMuted} />
                                ) : (
                                    <Ionicons
                                        name="share-social-outline"
                                        size={28}
                                        color={colors.textMuted}
                                    />
                                )}
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>

                {/* Notes */}
                {(canEditNotes || personalNotes) && (
                    <View style={styles.section}>
                        <View style={styles.notesHeaderRow}>
                            <Text style={styles.sectionTitle}>{notesSectionLabel}</Text>
                            {canEditNotes && showNotesEditor && (
                                <TouchableOpacity
                                    style={[
                                        styles.notesSaveButton,
                                        (!hasNoteChanges || notesSaving) && styles.notesSaveButtonDisabled,
                                    ]}
                                    onPress={handleSaveNotes}
                                    disabled={!hasNoteChanges || notesSaving}
                                    activeOpacity={0.85}
                                >
                                    <Text style={styles.notesSaveButtonText}>{notesSaving ? 'Saving...' : 'Save'}</Text>
                                </TouchableOpacity>
                            )}
                            {canEditNotes && !showNotesEditor && (
                                <TouchableOpacity
                                    style={styles.notesEditButton}
                                    onPress={() => {
                                        setNotesDraft(collectionNotes || '');
                                        setShareToFeed(hasPublishedReview);
                                        setIsEditingNotes(true);
                                    }}
                                    activeOpacity={0.85}
                                >
                                    <Ionicons name="pencil" size={14} color={colors.text} />
                                </TouchableOpacity>
                            )}
                        </View>

                        {showNotesEditor ? (
                            <>
                                <TextInput
                                    style={styles.notesInput}
                                    value={notesDraft}
                                    onChangeText={setNotesDraft}
                                    placeholder="Add notes for this item"
                                    placeholderTextColor={colors.textMuted}
                                    editable={!notesSaving}
                                    multiline
                                    numberOfLines={4}
                                    textAlignVertical="top"
                                />
                                <View style={styles.notesShareRow}>
                                    <View style={{ flex: 1, paddingRight: spacing.sm }}>
                                        <Text style={styles.notesShareLabel}>Share to feed?</Text>
                                        <Text style={styles.notesShareHint}>Post this review to your feed when saving.</Text>
                                    </View>
                                    <Switch
                                        value={shareToFeed}
                                        onValueChange={setShareToFeed}
                                        disabled={notesSaving}
                                        trackColor={{ false: colors.border, true: colors.primary + '80' }}
                                        thumbColor={shareToFeed ? colors.primary : colors.surfaceElevated}
                                    />
                                </View>
                                {hasNoteChanges && (
                                    <Text style={styles.notesUnsavedText}>Unsaved changes</Text>
                                )}
                            </>
                        ) : (
                            <Text style={styles.notes}>{personalNotes}</Text>
                        )}
                    </View>
                )}

                {/* Metadata */}
                {metadata.length > 0 && (
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Details</Text>
                        <View style={styles.metadataCard}>
                            {metadata.map((m, i) => (
                                <View key={m.label} style={[styles.metadataRow, i < metadata.length - 1 && styles.metadataRowBorder]}>
                                    <Text style={styles.metadataLabel}>{m.label}</Text>
                                    {m.onPress ? (
                                        <TouchableOpacity onPress={m.onPress} style={styles.metadataValueLink}>
                                            <Text style={[styles.metadataValue, { color: colors.primary }]}>{m.value}</Text>
                                            <Ionicons name="chevron-forward" size={14} color={colors.primary} style={{ marginLeft: 4 }} />
                                        </TouchableOpacity>
                                    ) : (
                                        <Text style={styles.metadataValue}>{m.value}</Text>
                                    )}
                                </View>
                            ))}
                        </View>
                    </View>
                )}

                {hasShelfItemContext && isGameCollectableContext && (
                    <View style={styles.section}>
                        <TouchableOpacity
                            style={styles.collapsibleHeader}
                            onPress={() => setIsOwnedPlatformsExpanded((prev) => !prev)}
                            activeOpacity={0.8}
                        >
                            <View style={styles.collapsibleHeaderTitleWrap}>
                                <Text style={styles.sectionTitleCompact}>Owned Platforms</Text>
                                <Text style={styles.collapsibleHeaderCount}>{ownedPlatforms.length}</Text>
                            </View>
                            <Ionicons
                                name={isOwnedPlatformsExpanded ? 'chevron-up' : 'chevron-down'}
                                size={18}
                                color={colors.textMuted}
                            />
                        </TouchableOpacity>
                        {isOwnedPlatformsExpanded && (
                            <>
                                {canEditOwnedPlatforms && (
                                    <View style={styles.ownedPlatformActionsRow}>
                                        {!isEditingOwnedPlatforms ? (
                                            <TouchableOpacity
                                                style={styles.notesEditButton}
                                                onPress={() => setIsEditingOwnedPlatforms(true)}
                                                activeOpacity={0.85}
                                            >
                                                <Ionicons name="pencil" size={14} color={colors.text} />
                                            </TouchableOpacity>
                                        ) : (
                                            <TouchableOpacity
                                                style={[
                                                    styles.notesSaveButton,
                                                    (ownedPlatformsSaving || !ownedPlatformFormat) && styles.notesSaveButtonDisabled,
                                                ]}
                                                onPress={handleSaveOwnedPlatforms}
                                                disabled={ownedPlatformsSaving || !ownedPlatformFormat}
                                                activeOpacity={0.85}
                                            >
                                                <Text style={styles.notesSaveButtonText}>
                                                    {ownedPlatformsSaving ? 'Saving...' : 'Save'}
                                                </Text>
                                            </TouchableOpacity>
                                        )}
                                    </View>
                                )}

                                <View style={styles.collapsibleCard}>
                                    {ownedPlatforms.length > 0 ? ownedPlatforms.map((platformName, index) => (
                                        <View
                                            key={platformName.toLowerCase()}
                                            style={[
                                                styles.ownedPlatformRow,
                                                index < ownedPlatforms.length - 1 && styles.collapsibleRowBorder,
                                            ]}
                                        >
                                            <View style={styles.ownedPlatformTextWrap}>
                                                <View style={styles.ownedPlatformNameRow}>
                                                    <Text style={styles.ownedPlatformName}>{platformName}</Text>
                                                    {ownedPlatformFormat && (
                                                        <View style={styles.ownedPlatformFormatBadge}>
                                                            <Text style={styles.ownedPlatformFormatBadgeText}>
                                                                {formatOwnedGameFormatLabel(ownedPlatformFormat)}
                                                            </Text>
                                                        </View>
                                                    )}
                                                </View>
                                                <Text style={styles.ownedPlatformDate}>
                                                    Added Date: {ownedPlatformsAddedDateLabel}
                                                </Text>
                                            </View>
                                            {isEditingOwnedPlatforms && canEditOwnedPlatforms && (
                                                <TouchableOpacity
                                                    style={styles.ownedPlatformRemoveButton}
                                                    onPress={() => removeOwnedPlatform(platformName)}
                                                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                                >
                                                    <Ionicons name="close" size={14} color={colors.textSecondary} />
                                                </TouchableOpacity>
                                            )}
                                        </View>
                                    )) : (
                                        <View style={styles.ownedPlatformEmptyState}>
                                            <Text style={styles.platformHint}>No owned platforms saved yet.</Text>
                                        </View>
                                    )}
                                </View>

                                {isEditingOwnedPlatforms && canEditOwnedPlatforms && (
                                    <>
                                        <View style={styles.platformFormatSection}>
                                            <Text style={styles.platformFormatLabel}>Ownership Format</Text>
                                            <View style={styles.platformFormatOptionsRow}>
                                                {OWNED_GAME_FORMAT_OPTIONS.map((option) => {
                                                    const selected = ownedPlatformFormat === option;
                                                    return (
                                                        <TouchableOpacity
                                                            key={`owned-format-${option}`}
                                                            style={[
                                                                styles.platformFormatOptionChip,
                                                                selected && styles.platformFormatOptionChipSelected,
                                                            ]}
                                                            onPress={() => setOwnedPlatformFormat(option)}
                                                            disabled={ownedPlatformsSaving}
                                                            activeOpacity={0.85}
                                                        >
                                                            <Text
                                                                style={[
                                                                    styles.platformFormatOptionText,
                                                                    selected && styles.platformFormatOptionTextSelected,
                                                                ]}
                                                            >
                                                                {formatOwnedGameFormatLabel(option)}
                                                            </Text>
                                                        </TouchableOpacity>
                                                    );
                                                })}
                                            </View>
                                            {!ownedPlatformFormat && (
                                                <Text style={styles.platformFormatRequiredText}>
                                                    Required: select Physical or Digital.
                                                </Text>
                                            )}
                                        </View>

                                        <View style={styles.platformEditorRow}>
                                            <TextInput
                                                style={styles.platformInput}
                                                value={platformDraft}
                                                onChangeText={setPlatformDraft}
                                                placeholder="Add console/platform"
                                                placeholderTextColor={colors.textMuted}
                                                editable={!ownedPlatformsSaving}
                                                onSubmitEditing={addOwnedPlatformFromDraft}
                                                returnKeyType="done"
                                            />
                                            <TouchableOpacity
                                                style={styles.platformAddButton}
                                                onPress={addOwnedPlatformFromDraft}
                                                disabled={ownedPlatformsSaving}
                                                activeOpacity={0.85}
                                            >
                                                <Ionicons name="add" size={16} color={colors.textInverted} />
                                            </TouchableOpacity>
                                        </View>

                                        {availableOwnedPlatformSuggestions.length > 0 && (
                                            <View style={styles.platformSuggestionRow}>
                                                {availableOwnedPlatformSuggestions.slice(0, 8).map((platformName) => (
                                                    <TouchableOpacity
                                                        key={`suggest-${platformName.toLowerCase()}`}
                                                        style={styles.platformSuggestionChip}
                                                        onPress={() => addOwnedPlatformSuggestion(platformName)}
                                                        activeOpacity={0.85}
                                                    >
                                                        <Text style={styles.platformSuggestionText}>{platformName}</Text>
                                                    </TouchableOpacity>
                                                ))}
                                            </View>
                                        )}
                                    </>
                                )}
                            </>
                        )}
                    </View>
                )}

                {/* Cast */}
                {castEntries.length > 0 && (
                    <View style={styles.section}>
                        <TouchableOpacity
                            style={styles.collapsibleHeader}
                            onPress={() => setIsCastExpanded((prev) => !prev)}
                            activeOpacity={0.8}
                        >
                            <View style={styles.collapsibleHeaderTitleWrap}>
                                <Text style={styles.sectionTitleCompact}>Cast</Text>
                                <Text style={styles.collapsibleHeaderCount}>{castEntries.length}</Text>
                            </View>
                            <Ionicons
                                name={isCastExpanded ? 'chevron-up' : 'chevron-down'}
                                size={18}
                                color={colors.textMuted}
                            />
                        </TouchableOpacity>
                        {isCastExpanded && (
                            <View style={styles.collapsibleCard}>
                                {castEntries.map((entry, index) => (
                                    <View
                                        key={`${entry.name}-${index}`}
                                        style={[styles.collapsibleRow, index < castEntries.length - 1 && styles.collapsibleRowBorder]}
                                    >
                                        <Text style={styles.collapsiblePrimary}>{entry.name}</Text>
                                        {entry.character ? (
                                            <Text style={styles.collapsibleSecondary} numberOfLines={2}>{entry.character}</Text>
                                        ) : null}
                                    </View>
                                ))}
                            </View>
                        )}
                    </View>
                )}

                {/* Tags */}
                {tagValues.length > 0 && (
                    <View style={styles.section}>
                        <TouchableOpacity
                            style={styles.collapsibleHeader}
                            onPress={() => setIsTagsExpanded((prev) => !prev)}
                            activeOpacity={0.8}
                        >
                            <View style={styles.collapsibleHeaderTitleWrap}>
                                <Text style={styles.sectionTitleCompact}>Tags</Text>
                                <Text style={styles.collapsibleHeaderCount}>{tagValues.length}</Text>
                            </View>
                            <Ionicons
                                name={isTagsExpanded ? 'chevron-up' : 'chevron-down'}
                                size={18}
                                color={colors.textMuted}
                            />
                        </TouchableOpacity>
                        {isTagsExpanded && (
                            <View style={styles.tagsContainer}>
                                {tagValues.map((tag, index) => (
                                    <View key={`${tag}-${index}`} style={styles.tagPill}>
                                        <Text style={styles.tagPillText}>{tag}</Text>
                                    </View>
                                ))}
                            </View>
                        )}
                    </View>
                )}

                {/* Description */}
                {description ? (
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Description</Text>
                        <Text style={styles.description}>{description}</Text>
                    </View>
                ) : null}

                {/* Source badge */}
                <View style={styles.sourceBadge}>
                    <Ionicons name={isManual ? 'create-outline' : 'cloud-outline'} size={14} color={colors.textMuted} />
                    <Text style={styles.sourceText}>{isManual ? 'Manual entry' : 'From catalog'}</Text>
                </View>

                {/* Provider attribution */}
                {renderAttribution()}
            </ScrollView>

            <Modal
                visible={coverViewerVisible}
                animationType="fade"
                presentationStyle="fullScreen"
                onRequestClose={handleCloseCoverViewer}
            >
                {coverViewerUri ? (
                    <View
                        style={[
                            styles.viewerScreen,
                            {
                                paddingTop: insets.top,
                                paddingBottom: insets.bottom,
                                paddingLeft: insets.left,
                                paddingRight: insets.right,
                            },
                        ]}
                    >
                        <View style={styles.viewerHeader}>
                            <TouchableOpacity
                                style={styles.viewerHeaderBtn}
                                onPress={handleCloseCoverViewer}
                                activeOpacity={0.8}
                            >
                                <Text style={styles.viewerToolText}>Close</Text>
                            </TouchableOpacity>
                            <Text style={styles.viewerHeaderTitle}>Cover Art</Text>
                            <View style={styles.viewerHeaderBtn} />
                        </View>
                        <Pressable style={styles.viewerImageArea} onPress={handleCloseCoverViewer}>
                            <Pressable
                                style={[styles.coverViewerImageHitbox, coverViewerImageHitboxStyle]}
                                onPress={(event) => event.stopPropagation?.()}
                            >
                                <CachedImage
                                    source={{ uri: coverViewerUri }}
                                    style={styles.viewerImage}
                                    contentFit="contain"
                                />
                            </Pressable>
                        </Pressable>
                    </View>
                ) : null}
            </Modal>

            <Modal
                visible={ownerPhotoViewerVisible}
                animationType="fade"
                presentationStyle="fullScreen"
                onRequestClose={handleCloseOwnerPhotoViewer}
            >
                {ownerPhotoViewerUri && ownerPhotoViewerEditing ? (
                    <ImageCropper
                        uri={ownerPhotoViewerUri}
                        colors={colors}
                        forcedInsets={insets}
                        onSave={handleSaveOwnerPhotoCropper}
                        onCancel={handleCancelOwnerPhotoCropper}
                    />
                ) : ownerPhotoViewerUri ? (
                    <View
                        style={[
                            styles.viewerScreen,
                            {
                                paddingTop: insets.top,
                                paddingBottom: insets.bottom,
                                paddingLeft: insets.left,
                                paddingRight: insets.right,
                            },
                        ]}
                    >
                        <View style={styles.viewerHeader}>
                            <TouchableOpacity
                                style={styles.viewerHeaderBtn}
                                onPress={handleCloseOwnerPhotoViewer}
                                activeOpacity={0.8}
                            >
                                <Text style={styles.viewerToolText}>Close</Text>
                            </TouchableOpacity>
                            <Text style={styles.viewerHeaderTitle}>{ownerPhotoViewerTitle}</Text>
                            {canEditOwnerPhoto ? (
                                <TouchableOpacity
                                    style={[styles.viewerHeaderBtn, ownerPhotoViewerBusy && styles.viewerHeaderBtnDisabled]}
                                    onPress={handleEnterOwnerPhotoEditMode}
                                    disabled={ownerPhotoViewerBusy}
                                    activeOpacity={0.8}
                                >
                                    <Text style={styles.viewerSaveText}>Edit</Text>
                                </TouchableOpacity>
                            ) : (
                                <View style={styles.viewerHeaderBtn} />
                            )}
                        </View>
                        <View style={styles.viewerImageArea}>
                            <CachedImage
                                source={{ uri: ownerPhotoViewerUri }}
                                style={styles.viewerImage}
                                contentFit="contain"
                            />
                        </View>
                    </View>
                ) : null}
            </Modal>

            {/* Wishlist Selection Modal */}
            <Modal
                visible={showWishlistModal}
                transparent
                animationType="slide"
                onRequestClose={() => setShowWishlistModal(false)}
            >
                <TouchableOpacity
                    style={styles.modalOverlay}
                    activeOpacity={1}
                    onPress={() => setShowWishlistModal(false)}
                >
                    <View style={styles.modalContent}>
                        <View style={styles.modalHeader}>
                            <Text style={styles.modalTitle}>Add to Wishlist</Text>
                            <TouchableOpacity onPress={() => setShowWishlistModal(false)}>
                                <Ionicons name="close" size={24} color={colors.text} />
                            </TouchableOpacity>
                        </View>
                        {wishlists.length === 0 ? (
                            <View style={styles.emptyWishlistState}>
                                <Text style={styles.emptyWishlistText}>No wishlists found.</Text>
                                <Text style={styles.emptyWishlistSubtext}>Create one in your Profile.</Text>
                            </View>
                        ) : (
                            <FlatList
                                data={wishlists}
                                keyExtractor={(item) => item.id.toString()}
                                renderItem={({ item }) => (
                                    <TouchableOpacity
                                        style={styles.wishlistItem}
                                        onPress={() => handleAddItemToWishlist(item.id)}
                                    >
                                        <View style={styles.wishlistIcon}>
                                            <Ionicons name="heart" size={16} color={colors.primary} />
                                        </View>
                                        <View style={styles.wishlistInfo}>
                                            <Text style={styles.wishlistName}>{item.name}</Text>
                                            <Text style={styles.wishlistCount}>
                                                {item.itemCount || 0} items
                                            </Text>
                                        </View>
                                        <Ionicons name="add-circle-outline" size={24} color={colors.primary} />
                                    </TouchableOpacity>
                                )}
                            />
                        )}
                    </View>
                </TouchableOpacity>
            </Modal>

            <AddToShelfModal
                visible={showAddToShelfModal}
                onClose={() => setShowAddToShelfModal(false)}
                onSuccess={handleAddToShelfSuccess}
                apiBase={apiBase}
                token={token}
                collectableId={collectable?.id || null}
                manualId={!collectable?.id ? (manual?.id || null) : null}
            />
        </SafeAreaView >
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
        paddingBottom: spacing.sm,
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
    editButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: colors.surface,
        justifyContent: 'center',
        alignItems: 'center',
        ...shadows.sm,
    },
    replaceButton: {
        minHeight: 32,
        maxWidth: 240,
        justifyContent: 'center',
    },
    replaceCtaRow: {
        alignItems: 'flex-end',
        paddingHorizontal: spacing.md,
        paddingBottom: spacing.md,
    },
    replaceButtonText: {
        fontSize: 12,
        lineHeight: 16,
        fontWeight: '600',
        color: colors.primary,
        textAlign: 'right',
    },
    container: {
        flex: 1,
    },
    content: {
        padding: spacing.md,
        paddingBottom: 40,
    },
    hero: {
        alignItems: 'center',
        marginBottom: spacing.xl,
    },
    coverBox: {
        width: 120,
        height: 160,
        borderRadius: 12,
        overflow: 'hidden',
        marginBottom: spacing.md,
        backgroundColor: colors.surface,
        ...shadows.md,
        position: 'relative',
    },
    coverImage: {
        width: '100%',
        height: '100%',
    },
    coverOpenButton: {
        width: '100%',
        height: '100%',
    },
    coverEditButton: {
        position: 'absolute',
        bottom: 8,
        right: 8,
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: colors.primary,
        justifyContent: 'center',
        alignItems: 'center',
        ...shadows.sm,
    },
    coverFallback: {
        width: '100%',
        height: '100%',
        backgroundColor: colors.primary + '15',
        justifyContent: 'center',
        alignItems: 'center',
    },
    title: {
        fontSize: 22,
        fontWeight: '700',
        color: colors.text,
        textAlign: 'center',
    },
    subtitle: {
        fontSize: 15,
        color: colors.textSecondary,
        marginTop: 4,
        textAlign: 'center',
    },
    platformMissingBadge: {
        marginTop: spacing.sm,
        alignSelf: 'center',
        paddingHorizontal: spacing.sm,
        paddingVertical: 4,
        borderRadius: radius.full,
        backgroundColor: colors.error + '20',
        borderWidth: 1,
        borderColor: colors.error + '55',
    },
    platformMissingBadgeText: {
        fontSize: 12,
        color: colors.error,
        fontWeight: '700',
    },
    actionsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: spacing.lg,
        gap: spacing.xl,
    },
    ratingInfoColumn: {
        flex: 1,
        gap: spacing.md,
    },
    ownerPhotoCard: {
        marginBottom: spacing.sm,
        alignItems: 'center',
    },
    ownerPhotoSectionTitle: {
        textAlign: 'center',
    },
    heroOwnerPhotoCard: {
        width: '100%',
        maxWidth: 360,
        alignSelf: 'center',
        marginBottom: spacing.md,
    },
    ownerPhotoUnderSubtitle: {
        marginTop: spacing.md,
    },
    ratingBlock: {
        marginBottom: 2,
    },
    ratingLabel: {
        fontSize: 11,
        color: colors.textMuted,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginBottom: 4,
    },
    ratingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    ratingValue: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.text,
    },
    ratingCount: {
        fontSize: 13,
        color: colors.textSecondary,
    },
    actionButtonsColumn: {
        alignItems: 'center',
        gap: spacing.md,
    },
    actionButtonsColumnAlignWithRatings: {
        alignSelf: 'flex-end',
        paddingBottom: spacing.xs,
    },
    actionIconBtn: {
        padding: 4,
    },
    section: {
        marginBottom: spacing.lg,
    },
    sectionTitle: {
        fontSize: 13,
        fontWeight: '600',
        color: colors.textMuted,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginBottom: spacing.sm,
    },
    description: {
        fontSize: 15,
        color: colors.text,
        lineHeight: 22,
    },
    ownerPhotoSubtext: {
        fontSize: 12,
        color: colors.textMuted,
        marginBottom: spacing.sm,
        textAlign: 'center',
    },
    ownerPhotoLoading: {
        paddingVertical: spacing.md,
        alignItems: 'center',
    },
    ownerPhotoHint: {
        fontSize: 13,
        color: colors.textMuted,
        lineHeight: 18,
        textAlign: 'center',
    },
    ownerPhotoImageWrap: {
        width: 160,
        height: 200,
        borderRadius: radius.md,
        overflow: 'hidden',
        backgroundColor: colors.surface,
        marginBottom: spacing.sm,
        ...shadows.sm,
    },
    ownerPhotoImage: {
        width: '100%',
        height: '100%',
    },
    ownerPhotoOpenPressable: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 1,
    },
    ownerPhotoZoomBadge: {
        position: 'absolute',
        right: 8,
        bottom: 8,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: 'rgba(0,0,0,0.55)',
        borderRadius: radius.sm,
        paddingHorizontal: 6,
        paddingVertical: 3,
        zIndex: 2,
    },
    ownerPhotoZoomText: {
        fontSize: 11,
        fontWeight: '600',
        color: colors.textInverted,
    },
    ownerPhotoDeleteButton: {
        position: 'absolute',
        top: 8,
        right: 8,
        width: 24,
        height: 24,
        borderRadius: 12,
        backgroundColor: 'rgba(255,255,255,0.92)',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 3,
    },
    ownerPhotoButton: {
        marginTop: spacing.xs,
        marginBottom: spacing.sm,
        alignSelf: 'center',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: colors.primary,
        borderRadius: radius.md,
        paddingVertical: spacing.xs + 2,
        paddingHorizontal: spacing.sm + 2,
    },
    ownerPhotoButtonDisabled: {
        opacity: 0.6,
    },
    ownerPhotoButtonText: {
        fontSize: 13,
        fontWeight: '600',
        color: colors.textInverted,
    },
    ownerPhotoVisibilityRow: {
        width: '100%',
        maxWidth: 360,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: spacing.xs,
    },
    ownerPhotoVisibilityLabel: {
        fontSize: 13,
        fontWeight: '500',
        color: colors.text,
    },
    ownerPhotoVisibilityHint: {
        fontSize: 11,
        color: colors.textMuted,
        marginTop: 2,
    },
    viewerScreen: {
        flex: 1,
        backgroundColor: colors.background,
    },
    viewerHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    viewerHeaderBtn: {
        minWidth: 56,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: spacing.xs,
    },
    viewerHeaderBtnDisabled: {
        opacity: 0.5,
    },
    viewerHeaderTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.text,
    },
    viewerSaveText: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.primary,
    },
    viewerImageArea: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.md,
    },
    viewerImage: {
        width: '100%',
        height: '100%',
    },
    coverViewerImageHitbox: {
        alignSelf: 'center',
        maxWidth: '100%',
        maxHeight: '100%',
    },
    coverViewerImageHitboxFallback: {
        width: '92%',
        height: '92%',
    },
    viewerToolRow: {
        flexDirection: 'row',
        justifyContent: 'center',
        gap: spacing.sm,
        paddingHorizontal: spacing.md,
        paddingBottom: spacing.sm,
    },
    viewerToolButton: {
        minWidth: 84,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.md,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
    },
    viewerToolButtonDisabled: {
        opacity: 0.55,
    },
    viewerToolText: {
        fontSize: 13,
        fontWeight: '500',
        color: colors.text,
    },
    metadataCard: {
        backgroundColor: colors.surface,
        borderRadius: radius.lg,
        padding: spacing.md,
        ...shadows.sm,
    },
    metadataRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingVertical: spacing.sm,
    },
    metadataRowBorder: {
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    metadataLabel: {
        fontSize: 14,
        color: colors.textMuted,
    },
    metadataValue: {
        fontSize: 14,
        fontWeight: '500',
        color: colors.text,
        maxWidth: '60%',
        textAlign: 'right',
    },
    metadataValueLink: {
        flexDirection: 'row',
        alignItems: 'center',
        maxWidth: '60%',
        justifyContent: 'flex-end',
    },
    sectionTitleCompact: {
        fontSize: 13,
        fontWeight: '600',
        color: colors.textMuted,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    collapsibleHeader: {
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        paddingVertical: spacing.sm,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    collapsibleHeaderTitleWrap: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
    },
    collapsibleHeaderCount: {
        fontSize: 12,
        fontWeight: '600',
        color: colors.textMuted,
        backgroundColor: colors.surfaceElevated,
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 2,
        overflow: 'hidden',
    },
    collapsibleCard: {
        backgroundColor: colors.surface,
        borderRadius: radius.lg,
        marginTop: spacing.sm,
        paddingHorizontal: spacing.md,
        ...shadows.sm,
    },
    collapsibleRow: {
        paddingVertical: spacing.sm,
    },
    collapsibleRowBorder: {
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    collapsiblePrimary: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.text,
    },
    collapsibleSecondary: {
        marginTop: 3,
        fontSize: 13,
        color: colors.textMuted,
    },
    tagsContainer: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: spacing.xs,
        marginTop: spacing.sm,
    },
    tagPill: {
        backgroundColor: colors.surfaceElevated,
        borderRadius: radius.md,
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs,
    },
    tagPillText: {
        fontSize: 12,
        fontWeight: '500',
        color: colors.textSecondary,
    },
    notesHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: spacing.sm,
    },
    notesEditButton: {
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.surface,
        ...shadows.sm,
    },
    notesInput: {
        backgroundColor: colors.surface,
        borderRadius: radius.lg,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.md,
        minHeight: 100,
        fontSize: 14,
        color: colors.text,
        ...shadows.sm,
    },
    notesSaveButton: {
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.xs,
        borderRadius: radius.md,
        backgroundColor: colors.primary,
    },
    notesSaveButtonDisabled: {
        opacity: 0.5,
    },
    notesSaveButtonText: {
        fontSize: 12,
        fontWeight: '600',
        color: colors.textInverted,
    },
    ownedPlatformActionsRow: {
        marginTop: spacing.sm,
        alignItems: 'flex-end',
    },
    ownedPlatformRow: {
        paddingVertical: spacing.sm,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    ownedPlatformTextWrap: {
        flex: 1,
        paddingRight: spacing.sm,
    },
    ownedPlatformName: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.text,
    },
    ownedPlatformNameRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        flexWrap: 'wrap',
    },
    ownedPlatformFormatBadge: {
        paddingHorizontal: spacing.xs,
        paddingVertical: 2,
        borderRadius: radius.full,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surfaceElevated,
    },
    ownedPlatformFormatBadgeText: {
        fontSize: 10,
        fontWeight: '700',
        color: colors.textSecondary,
        textTransform: 'uppercase',
    },
    ownedPlatformDate: {
        marginTop: 3,
        fontSize: 12,
        color: colors.textMuted,
    },
    ownedPlatformRemoveButton: {
        width: 28,
        height: 28,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.surfaceElevated,
    },
    ownedPlatformEmptyState: {
        paddingVertical: spacing.sm,
    },
    platformHint: {
        fontSize: 12,
        color: colors.textMuted,
    },
    platformEditorRow: {
        marginTop: spacing.sm,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
    },
    platformFormatSection: {
        marginTop: spacing.sm,
    },
    platformFormatLabel: {
        fontSize: 12,
        color: colors.textMuted,
        marginBottom: spacing.xs,
    },
    platformFormatRequiredText: {
        marginTop: spacing.xs,
        fontSize: 12,
        color: colors.danger || '#b42318',
    },
    platformFormatOptionsRow: {
        flexDirection: 'row',
        gap: spacing.xs,
    },
    platformFormatOptionChip: {
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs,
        borderRadius: radius.full,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
    },
    platformFormatOptionChipSelected: {
        backgroundColor: `${colors.primary}22`,
        borderColor: colors.primary,
    },
    platformFormatOptionText: {
        fontSize: 12,
        fontWeight: '600',
        color: colors.textSecondary,
    },
    platformFormatOptionTextSelected: {
        color: colors.primary,
    },
    platformInput: {
        flex: 1,
        backgroundColor: colors.surface,
        borderRadius: radius.lg,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        fontSize: 14,
        color: colors.text,
        ...shadows.sm,
    },
    platformAddButton: {
        width: 34,
        height: 34,
        borderRadius: 17,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.primary,
        ...shadows.sm,
    },
    platformSuggestionRow: {
        marginTop: spacing.sm,
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: spacing.xs,
    },
    platformSuggestionChip: {
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs,
        borderRadius: radius.full,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
    },
    platformSuggestionText: {
        fontSize: 12,
        color: colors.textSecondary,
    },
    notesUnsavedText: {
        marginTop: spacing.xs,
        fontSize: 12,
        color: colors.textMuted,
    },
    notesShareRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: spacing.sm,
        paddingHorizontal: spacing.xs,
    },
    notesShareLabel: {
        fontSize: 13,
        fontWeight: '600',
        color: colors.text,
    },
    notesShareHint: {
        marginTop: 2,
        fontSize: 12,
        color: colors.textMuted,
    },
    notes: {
        fontSize: 14,
        color: colors.textSecondary,
        lineHeight: 20,
        fontStyle: 'italic',
    },
    sourceBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        marginTop: spacing.md,
    },
    sourceText: {
        fontSize: 12,
        color: colors.textMuted,
    },
    attributionSection: {
        marginTop: spacing.lg,
        paddingTop: spacing.md,
        borderTopWidth: 1,
        borderTopColor: colors.border,
        alignItems: 'center',
    },
    attributionLogo: {
        width: 100,
        height: 24,
        marginBottom: spacing.sm,
    },
    attributionLink: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingVertical: spacing.sm,
    },
    attributionLinkText: {
        fontSize: 14,
        color: colors.primary,
    },
    disclaimerText: {
        fontSize: 11,
        color: colors.textMuted,
        textAlign: 'center',
        marginTop: spacing.sm,
        lineHeight: 16,
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'flex-end',
    },
    modalContent: {
        backgroundColor: colors.surface,
        borderTopLeftRadius: radius.xl,
        borderTopRightRadius: radius.xl,
        padding: spacing.lg,
        maxHeight: '60%',
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: spacing.md,
    },
    modalTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: colors.text,
    },
    wishlistItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: spacing.md,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    wishlistIcon: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: colors.primary + '15',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: spacing.md,
    },
    wishlistInfo: {
        flex: 1,
    },
    wishlistName: {
        fontSize: 16,
        fontWeight: '500',
        color: colors.text,
    },
    wishlistCount: {
        fontSize: 12,
        color: colors.textSecondary,
    },
    emptyWishlistState: {
        padding: spacing.xl,
        alignItems: 'center',
    },
    emptyWishlistText: {
        fontSize: 16,
        color: colors.text,
        marginBottom: 8,
    },
    emptyWishlistSubtext: {
        fontSize: 14,
        color: colors.textMuted,
    },
});
