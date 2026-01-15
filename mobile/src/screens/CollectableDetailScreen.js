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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AuthContext } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { CachedImage } from '../components/ui';
import { apiRequest } from '../services/api';

// Logo assets for provider attribution (imported as React components via react-native-svg-transformer)
import TmdbLogo from '../assets/tmdb-logo.svg';

export default function CollectableDetailScreen({ route, navigation }) {
    const { item, shelfId, readOnly, id, collectableId } = route.params || {};
    const { apiBase, token } = useContext(AuthContext);
    const { colors, spacing, typography, shadows, radius, isDark } = useTheme();

    const styles = useMemo(() => createStyles({ colors, spacing, typography, shadows, radius }), [colors, spacing, typography, shadows, radius]);

    const [resolvedCollectable, setResolvedCollectable] = useState(null);

    const resolvedCollectableId = collectableId || id || item?.collectable?.id || item?.collectableSnapshot?.id || null;
    const baseCollectable = item?.collectable
        || item?.collectableSnapshot
        || (resolvedCollectableId ? { id: resolvedCollectableId } : {});
    const collectable = resolvedCollectable || baseCollectable;
    const manual = item?.manual || item?.manualSnapshot || {};
    const isManual = !collectable?.title && manual?.title;
    const source = isManual ? manual : collectable;

    useEffect(() => {
        let isActive = true;
        const collectableId = baseCollectable?.id;
        if (!collectableId || baseCollectable?.attribution || !apiBase || !token) {
            return () => {
                isActive = false;
            };
        }

        (async () => {
            try {
                const data = await apiRequest({
                    apiBase,
                    path: `/api/collectables/${collectableId}`,
                    token,
                });
                if (!isActive || !data?.collectable) return;
                setResolvedCollectable(data.collectable);
            } catch (err) {
                console.warn('Failed to refresh collectable details:', err?.message || err);
            }
        })();

        return () => {
            isActive = false;
        };
    }, [apiBase, token, baseCollectable?.id, baseCollectable?.attribution]);

    const normalizeList = (value) => {
        if (!value) return [];
        if (Array.isArray(value)) return value.filter(Boolean);
        if (typeof value === 'string') return value.split(',').map(v => v.trim()).filter(Boolean);
        return [];
    };

    const title = source?.title || source?.name || 'Untitled';
    const subtitle = source?.author || source?.primaryCreator || source?.publisher || '';
    const type = source?.type || 'Item';
    const description = source?.description || source?.overview || item?.notes || '';
    const publishers = [
        ...normalizeList(source?.publisher),
        ...normalizeList(source?.publishers),
    ];
    const publisher = publishers.length ? Array.from(new Set(publishers)).join(', ') : null;
    const yearRaw = source?.year || source?.publishYear || source?.releaseYear || source?.publishDate || null;
    const year = yearRaw != null ? String(yearRaw) : null;
    const tagList = [
        ...normalizeList(source?.tags),
        ...normalizeList(source?.genre),
        ...normalizeList(source?.subjects),
    ];
    const tags = tagList.length ? Array.from(new Set(tagList)).join(', ') : null;
    const isbn = source?.isbn
        || source?.isbn13
        || source?.isbn10
        || (Array.isArray(source?.identifiers?.isbn13) ? source.identifiers.isbn13[0] : null)
        || (Array.isArray(source?.identifiers?.isbn10) ? source.identifiers.isbn10[0] : null);

    const metadata = [
        { label: 'Type', value: type },
        { label: 'Author', value: source?.author || source?.primaryCreator },
        { label: 'Publisher', value: publisher },
        { label: 'Year', value: year },
        { label: 'Format', value: source?.format },
        { label: 'ISBN', value: isbn },
        { label: 'Tags', value: tags },
    ].filter(m => m.value);

    const getIconForType = (t) => {
        switch (t?.toLowerCase()) {
            case 'book': return 'book';
            case 'movie': return 'film';
            case 'game': return 'game-controller';
            case 'music': case 'album': return 'musical-notes';
            default: return 'cube';
        }
    };

    // Provider-agnostic cover resolution
    const resolveCoverUri = () => {
        const c = collectable;
        if (!c?.coverImageUrl) {
            // Fallback to legacy fields
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

        // Use new provider-agnostic fields
        if (c.coverImageSource === 'external') {
            // External URL, use directly
            return c.coverImageUrl;
        }

        // Local path, resolve via media endpoint
        const trimmed = c.coverImageUrl.replace(/^\/+/, '');
        const resource = trimmed.startsWith('media/') ? trimmed : `media/${trimmed}`;
        return apiBase ? `${apiBase.replace(/\/+$/, '')}/${resource}` : `/${resource}`;
    };

    const coverUri = resolveCoverUri();

    // Provider-agnostic attribution rendering
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
                                <Ionicons name={getIconForType(type)} size={48} color={colors.primary} />
                            </View>
                        )}
                    </View>
                    <Text style={styles.title}>{title}</Text>
                    {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
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
    },
    coverImage: {
        width: '100%',
        height: '100%',
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
