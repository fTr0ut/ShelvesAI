import React, { useContext, useEffect, useMemo, useState } from 'react';
import {
    Image,
    Linking,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
    StatusBar,
    Alert,
    ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { AuthContext } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { CachedImage, StarRating, CategoryIcon } from '../components/ui';
import { apiRequest } from '../services/api';

// Logo assets for provider attribution (imported as React components via react-native-svg-transformer)
import TmdbLogo from '../assets/tmdb-logo.svg';

export default function CollectableDetailScreen({ route, navigation }) {
    const { item, shelfId, readOnly, id, collectableId, ownerId } = route.params || {}; // ownerId added for Scenario B/C
    const { apiBase, token, user } = useContext(AuthContext); // user needed to compare with ownerId
    const { colors, spacing, typography, shadows, radius, isDark } = useTheme();

    const styles = useMemo(() => createStyles({ colors, spacing, typography, shadows, radius }), [colors, spacing, typography, shadows, radius]);

    // Determine ownership to initialize ratings correctly from passed params
    // If ownerId is missing or matches current user, we assume 'item.rating' is OUR rating.
    // If ownerId is present and distinct, 'item.rating' is the OWNER'S rating.
    const isOwnerContext = ownerId && user?.id && ownerId !== user.id;
    const initialRating = !isOwnerContext ? (item?.rating || 0) : 0;
    const initialOwnerRating = isOwnerContext ? (item?.rating || 0) : null;

    const [resolvedCollectable, setResolvedCollectable] = useState(null);
    const [rating, setRating] = useState(initialRating); // User's own rating
    const [ownerRating, setOwnerRating] = useState(initialOwnerRating); // Shelf owner's rating
    const [aggregateRating, setAggregateRating] = useState(null); // Average rating from all users
    const [isFavorited, setIsFavorited] = useState(false);
    const [isUploadingCover, setIsUploadingCover] = useState(false);
    const [manualCoverUrl, setManualCoverUrl] = useState(null);

    const resolvedCollectableId = collectableId || id || item?.collectable?.id || item?.collectableSnapshot?.id || null;
    const baseCollectable = item?.collectable
        || item?.collectableSnapshot
        || (resolvedCollectableId ? { id: resolvedCollectableId } : {});
    const collectable = resolvedCollectable || baseCollectable;
    const manual = item?.manual || item?.manualSnapshot || {};
    const isManual = !collectable?.title && manual?.title;
    const source = isManual ? manual : collectable;

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

    // NEW: Fetch all rating data
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

                // 3. Get Owner's Rating (Scenario B, C) - only for collectables
                if (!isManualItem && ownerId && user?.id && ownerId !== user.id) {
                    const ownerData = await apiRequest({
                        apiBase,
                        path: `/api/ratings/${targetId}/user/${ownerId}`,
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
            if (!collectable?.id || !token) return;
            try {
                const response = await apiRequest({
                    apiBase,
                    path: '/api/favorites/check-batch',
                    method: 'POST',
                    token,
                    body: { collectableIds: [collectable.id] },
                });
                if (isActive && response.status) {
                    setIsFavorited(!!response.status[collectable.id]);
                }
            } catch (e) {
                console.warn('Failed to check favorite status', e);
            }
        };
        checkFavoriteStatus();
        return () => { isActive = false; };
    }, [apiBase, token, collectable?.id]);

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
        if (!collectable?.id) return;

        const previousState = isFavorited;
        // Optimistic update
        setIsFavorited(!previousState);

        try {
            if (previousState) {
                await apiRequest({
                    apiBase,
                    path: `/api/favorites/${collectable.id}`,
                    method: 'DELETE',
                    token,
                });
            } else {
                await apiRequest({
                    apiBase,
                    path: '/api/favorites',
                    method: 'POST',
                    token,
                    body: { collectableId: collectable.id },
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

            // Upload to API
            const response = await fetch(`${apiBase}/api/shelves/${shelfId}/manual/${item.id}/cover`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
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
                // Build URL from path
                const trimmed = data.manual.coverMediaPath.replace(/^\/+/, '');
                const resource = trimmed.startsWith('media/') ? trimmed : `media/${trimmed}`;
                setManualCoverUrl(`${apiBase.replace(/\/+$/, '')}/${resource}`);
            }

        } catch (e) {
            console.warn('Failed to upload cover:', e);
            Alert.alert('Upload Failed', e.message || 'Failed to upload cover image');
        } finally {
            setIsUploadingCover(false);
        }
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

        // Check manual cover from item data
        if (isManual && manual) {
            if (manual.coverMediaUrl) {
                return manual.coverMediaUrl;
            }
            if (manual.coverMediaPath) {
                const trimmed = manual.coverMediaPath.replace(/^\/+/, '');
                const resource = trimmed.startsWith('media/') ? trimmed : `media/${trimmed}`;
                return apiBase ? `${apiBase.replace(/\/+$/, '')}/${resource}` : `/${resource}`;
            }
        }

        // Check collectable cover
        const c = collectable;
        if (!c?.coverImageUrl) {
            if (c?.coverMediaPath) {
                const trimmed = c.coverMediaPath.replace(/^\/+/, '');
                const resource = trimmed.startsWith('media/') ? trimmed : `media/${trimmed}`;
                return apiBase ? `${apiBase.replace(/\/+$/, '')}/${resource}` : `/${resource}`;
            }
            if (c?.coverUrl && /^https?:/i.test(c.coverUrl)) {
                return c.coverUrl;
            }
            return null;
        }

        if (c.coverImageSource === 'external') {
            return c.coverImageUrl;
        }

        const trimmed = c.coverImageUrl.replace(/^\/+/, '');
        const resource = trimmed.startsWith('media/') ? trimmed : `media/${trimmed}`;
        return apiBase ? `${apiBase.replace(/\/+$/, '')}/${resource}` : `/${resource}`;
    };

    const coverUri = resolveCoverUri();

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
                    <Text style={styles.title}>{title}</Text>
                    {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}

                    {/* Actions Row */}
                    <View style={styles.actionsRow}>
                        <View style={styles.ratingInfoColumn}>
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

                        {collectable?.id && (
                            <TouchableOpacity
                                onPress={handleToggleFavorite}
                                style={styles.favoriteBigButton}
                                activeOpacity={0.7}
                            >
                                <Ionicons
                                    name={isFavorited ? 'heart' : 'heart-outline'}
                                    size={28}
                                    color={isFavorited ? colors.error : colors.textMuted}
                                />
                            </TouchableOpacity>
                        )}
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
    favoriteBigButton: {
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
});
