import React, { useContext, useEffect, useMemo, useState } from 'react';
import {
    Image,
    Linking,
    Pressable,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    TouchableOpacity,
    View,
    StatusBar,
    Alert,
    ActivityIndicator,
    Modal,
    FlatList,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { AuthContext } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { CachedImage, StarRating, CategoryIcon } from '../components/ui';
import { apiRequest, getValidToken } from '../services/api';
import { resolveCollectableCoverUrl, resolveManualCoverUrl, buildMediaUri } from '../utils/coverUrl';

// Logo assets for provider attribution (imported as React components via react-native-svg-transformer)
import TmdbLogo from '../assets/tmdb-logo.svg';

export default function CollectableDetailScreen({ route, navigation }) {
    const { item, shelfId, readOnly, id, collectableId, ownerId } = route.params || {}; // ownerId added for Scenario B/C
    const { apiBase, token, user } = useContext(AuthContext); // user needed to compare with ownerId
    const { colors, spacing, typography, shadows, radius, isDark } = useTheme();
    const insets = useSafeAreaInsets();

    const styles = useMemo(() => createStyles({ colors, spacing, typography, shadows, radius }), [colors, spacing, typography, shadows, radius]);

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
    const [ownerPhoto, setOwnerPhoto] = useState(null);
    const [ownerPhotoLoading, setOwnerPhotoLoading] = useState(false);
    const [ownerPhotoBusy, setOwnerPhotoBusy] = useState(false);
    const [imageAuthToken, setImageAuthToken] = useState(null);
    const [ownerPhotoViewerVisible, setOwnerPhotoViewerVisible] = useState(false);
    const [ownerPhotoViewerLoading, setOwnerPhotoViewerLoading] = useState(false);
    const [ownerPhotoViewerApplying, setOwnerPhotoViewerApplying] = useState(false);
    const [ownerPhotoViewerUri, setOwnerPhotoViewerUri] = useState(null);
    const [ownerPhotoViewerOriginalUri, setOwnerPhotoViewerOriginalUri] = useState(null);

    const resolvedCollectableId = collectableId || id || item?.collectable?.id || item?.collectableSnapshot?.id || null;
    const baseCollectable = item?.collectable
        || item?.collectableSnapshot
        || (resolvedCollectableId ? { id: resolvedCollectableId } : {});
    const collectable = resolvedCollectable || baseCollectable;
    const baseManual = item?.manual || item?.manualSnapshot || {};
    const manual = resolvedManual || baseManual;
    // Detect manual items: either has manual data with content, or collectable is empty/missing
    const hasManualContent = !!(manual?.id || manual?.title || manual?.name || manual?.coverMediaUrl || manual?.coverMediaPath);
    const hasCollectableContent = !!(collectable?.id && collectable?.title);
    const isManual = hasManualContent && !hasCollectableContent;
    const source = isManual ? manual : collectable;
    const hasShelfItemContext = !!(shelfId && item?.id);
    const canEditOwnerPhoto = hasShelfItemContext && !readOnly && !(ownerId && user?.id && ownerId !== user.id);

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
            setOwnerPhotoViewerVisible(true);
        } catch (err) {
            console.warn('Failed to open owner photo viewer:', err);
            Alert.alert('Error', err?.message || 'Unable to load your photo');
        } finally {
            setOwnerPhotoViewerLoading(false);
        }
    };

    const handleCloseOwnerPhotoViewer = () => {
        setOwnerPhotoViewerVisible(false);
    };

    const applyOwnerPhotoManipulation = async (actions) => {
        if (!ownerPhotoViewerUri) return;
        try {
            setOwnerPhotoViewerApplying(true);
            const manipulated = await ImageManipulator.manipulateAsync(
                ownerPhotoViewerUri,
                actions,
                { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG },
            );
            if (manipulated?.uri) {
                setOwnerPhotoViewerUri(manipulated.uri);
            }
        } catch (err) {
            console.warn('Failed to edit owner photo:', err);
            Alert.alert('Error', 'Unable to apply edit');
        } finally {
            setOwnerPhotoViewerApplying(false);
        }
    };

    const handleRotateOwnerPhoto = async () => {
        await applyOwnerPhotoManipulation([{ rotate: 90 }]);
    };

    const handlePresetOwnerPhotoCrop = async (aspectWidth, aspectHeight) => {
        if (!ownerPhotoViewerUri) return;
        try {
            const size = await getImageSizeAsync(ownerPhotoViewerUri);
            const crop = getCenteredCrop({
                width: size.width,
                height: size.height,
                aspectWidth,
                aspectHeight,
            });
            await applyOwnerPhotoManipulation([{ crop }]);
        } catch (err) {
            console.warn('Failed to crop owner photo:', err);
            Alert.alert('Error', 'Unable to crop this photo');
        }
    };

    const handleResetOwnerPhotoEdits = () => {
        if (!ownerPhotoViewerOriginalUri) return;
        setOwnerPhotoViewerUri(ownerPhotoViewerOriginalUri);
    };

    const handleSaveOwnerPhotoEdits = async () => {
        if (!canEditOwnerPhoto || !ownerPhotoViewerUri) return;
        try {
            await uploadOwnerPhotoFromUri(ownerPhotoViewerUri, 'image/jpeg');
            setOwnerPhotoViewerOriginalUri(ownerPhotoViewerUri);
            setOwnerPhotoViewerVisible(false);
        } catch (err) {
            console.warn('Failed to save owner photo edits:', err);
            Alert.alert('Save Failed', err?.message || 'Unable to save photo edits');
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

    const title = source?.title || source?.name || 'Untitled';
    const subtitle = source?.author || source?.primaryCreator || source?.publisher || '';
    const type = source?.type || 'Item';
    const description = source?.description || source?.overview || item?.notes || '';

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

        const labelOverrides = {
            primaryCreator: 'Creator',
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
        };

        const valueFormatters = {
            runtime: (value) => `${value} min`,
            networks: (value) => Array.isArray(value) ? value.join(', ') : value,
        };

        const usedKeys = new Set();
        const entries = [];

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
                const flat = value.filter((entry) => entry !== null && entry !== undefined && entry !== '');
                if (!flat.length) return null;
                if (flat.every((entry) => ['string', 'number', 'boolean'].includes(typeof entry))) {
                    return flat.join(', ');
                }
                return null;
            }
            if (typeof value === 'object') return null;
            if (typeof value === 'boolean') return value ? 'Yes' : 'No';
            return String(value);
        };

        const resolveBaseValue = (key) => {
            let rawValue = resolveValue(source, key);
            if (!rawValue && !isManual && manual) {
                rawValue = resolveValue(manual, key);
            }
            return rawValue;
        };

        const addEntry = (key, label, rawValue) => {
            const value = normalizeValue(rawValue, key);
            if (value === null) return;
            entries.push({ label, value });
            usedKeys.add(key);
        };

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
            'systemName',
            'publisher',
            'primaryCreator',
            'developer',
            'author',
            'year',
            'region',
            'genre',
            'tags',
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
            const value = resolveBaseValue(key);
            const label = labelOverrides[key] || prettifyLabel(key);
            addEntry(key, label, value);
        });

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

        // Check collectable cover
        return resolveCollectableCoverUrl(collectable, apiBase);
    };

    const coverUri = resolveCoverUri();
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
    const shouldReplaceManualHeroWithOwnerPhoto = (
        isManual
        && ownerPhoto?.source === 'vision_crop'
        && !!ownerPhoto?.hasPhoto
        && !!ownerPhotoImageSource
    );
    const showAutoScanSubtext = ownerPhoto?.source === 'vision_crop' && !!ownerPhoto?.hasPhoto;
    const showOwnerPhotoInRatingColumn = showOwnerPhotoSection && !shouldReplaceManualHeroWithOwnerPhoto;
    const showOwnerPhotoInHeroForCollectable = showOwnerPhotoInRatingColumn && !isManual;

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
            <Text style={[styles.sectionTitle, styles.ownerPhotoSectionTitle]}>Your photos</Text>
            {showAutoScanSubtext && (
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
                {isManual && !readOnly && (
                    <TouchableOpacity
                        onPress={() => navigation.navigate('ManualEdit', { item, shelfId })}
                        style={styles.editButton}
                    >
                        <Ionicons name="pencil" size={18} color={colors.text} />
                    </TouchableOpacity>
                )}
                {!isManual && <View style={{ width: 40 }} />}
            </View>

            <ScrollView style={styles.container} contentContainerStyle={styles.content}>
                {/* Hero */}
                <View style={styles.hero}>
                    {shouldReplaceManualHeroWithOwnerPhoto ? (
                        renderOwnerPhotoCard(styles.heroOwnerPhotoCard)
                    ) : (
                        <View style={styles.coverBox}>
                            {coverUri ? (
                                <CachedImage
                                    source={{ uri: coverUri }}
                                    style={styles.coverImage}
                                    contentFit="cover"
                                />
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
                                    <Text style={styles.ratingLabel}>Owner</Text>
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
                        </View>
                    </View>
                </View>

                {/* Metadata */}
                {metadata.length > 0 && (
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Details</Text>
                        <View style={styles.metadataCard}>
                            {metadata.map((m, i) => (
                                <View key={m.label} style={[styles.metadataRow, i < metadata.length - 1 && styles.metadataRowBorder]}>
                                    <Text style={styles.metadataLabel}>{m.label}</Text>
                                    <Text style={styles.metadataValue}>{m.value}</Text>
                                </View>
                            ))}
                        </View>
                    </View>
                )}

                {/* Description */}
                {description ? (
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Description</Text>
                        <Text style={styles.description}>{description}</Text>
                    </View>
                ) : null}

                {/* Notes */}
                {item?.notes && !description && (
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Your Notes</Text>
                        <Text style={styles.notes}>{item.notes}</Text>
                    </View>
                )}

                {/* Source badge */}
                <View style={styles.sourceBadge}>
                    <Ionicons name={isManual ? 'create-outline' : 'cloud-outline'} size={14} color={colors.textMuted} />
                    <Text style={styles.sourceText}>{isManual ? 'Manual entry' : 'From catalog'}</Text>
                </View>

                {/* Provider attribution */}
                {renderAttribution()}
            </ScrollView>

            <Modal
                visible={ownerPhotoViewerVisible}
                animationType="fade"
                statusBarTranslucent
                onRequestClose={handleCloseOwnerPhotoViewer}
            >
                <SafeAreaView
                    style={[
                        styles.viewerScreen,
                        {
                            paddingTop: Math.max(insets.top, spacing.xs),
                            paddingBottom: Math.max(insets.bottom, spacing.sm),
                        },
                    ]}
                    edges={['left', 'right']}
                >
                    <View style={styles.viewerHeader}>
                        <TouchableOpacity onPress={handleCloseOwnerPhotoViewer} style={styles.viewerHeaderBtn}>
                            <Ionicons name="close" size={22} color={colors.text} />
                        </TouchableOpacity>
                        <Text style={styles.viewerHeaderTitle}>Your photo</Text>
                        <TouchableOpacity
                            onPress={handleSaveOwnerPhotoEdits}
                            style={[styles.viewerHeaderBtn, (!canEditOwnerPhoto || ownerPhotoViewerBusy) && styles.viewerHeaderBtnDisabled]}
                            disabled={!canEditOwnerPhoto || ownerPhotoViewerBusy}
                        >
                            <Text style={styles.viewerSaveText}>Save</Text>
                        </TouchableOpacity>
                    </View>

                    <View style={styles.viewerImageArea}>
                        {ownerPhotoViewerLoading || !ownerPhotoViewerUri ? (
                            <ActivityIndicator size="large" color={colors.primary} />
                        ) : (
                            <Image source={{ uri: ownerPhotoViewerUri }} style={styles.viewerImage} resizeMode="contain" />
                        )}
                    </View>

                    {canEditOwnerPhoto && (
                        <>
                            <View style={styles.viewerToolRow}>
                                <TouchableOpacity
                                    style={[styles.viewerToolButton, ownerPhotoViewerBusy && styles.viewerToolButtonDisabled]}
                                    onPress={() => handlePresetOwnerPhotoCrop(1, 1)}
                                    disabled={ownerPhotoViewerBusy}
                                >
                                    <Text style={styles.viewerToolText}>Square</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={[styles.viewerToolButton, ownerPhotoViewerBusy && styles.viewerToolButtonDisabled]}
                                    onPress={() => handlePresetOwnerPhotoCrop(3, 4)}
                                    disabled={ownerPhotoViewerBusy}
                                >
                                    <Text style={styles.viewerToolText}>3:4</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={[styles.viewerToolButton, ownerPhotoViewerBusy && styles.viewerToolButtonDisabled]}
                                    onPress={() => handlePresetOwnerPhotoCrop(4, 3)}
                                    disabled={ownerPhotoViewerBusy}
                                >
                                    <Text style={styles.viewerToolText}>4:3</Text>
                                </TouchableOpacity>
                            </View>
                            <View style={styles.viewerToolRow}>
                                <TouchableOpacity
                                    style={[styles.viewerToolButton, ownerPhotoViewerBusy && styles.viewerToolButtonDisabled]}
                                    onPress={handleRotateOwnerPhoto}
                                    disabled={ownerPhotoViewerBusy}
                                >
                                    <Text style={styles.viewerToolText}>Rotate</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={[styles.viewerToolButton, ownerPhotoViewerBusy && styles.viewerToolButtonDisabled]}
                                    onPress={handleResetOwnerPhotoEdits}
                                    disabled={ownerPhotoViewerBusy || !ownerPhotoViewerOriginalUri}
                                >
                                    <Text style={styles.viewerToolText}>Reset</Text>
                                </TouchableOpacity>
                            </View>
                        </>
                    )}
                </SafeAreaView>
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
    editButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: colors.surface,
        justifyContent: 'center',
        alignItems: 'center',
        ...shadows.sm,
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
