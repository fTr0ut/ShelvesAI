import React, { useMemo } from 'react';
import {
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
    StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';

export default function CollectableDetailScreen({ route, navigation }) {
    const { item, shelfId } = route.params || {};
    const { colors, spacing, typography, shadows, radius, isDark } = useTheme();

    const styles = useMemo(() => createStyles({ colors, spacing, typography, shadows, radius }), [colors, spacing, typography, shadows, radius]);

    const collectable = item?.collectable || item?.collectableSnapshot || {};
    const manual = item?.manual || item?.manualSnapshot || {};
    const isManual = !collectable?.title && manual?.title;
    const source = isManual ? manual : collectable;

    const title = source?.title || source?.name || 'Untitled';
    const subtitle = source?.author || source?.primaryCreator || source?.publisher || '';
    const type = source?.type || 'Item';
    const description = source?.description || item?.notes || '';

    const metadata = [
        { label: 'Type', value: type },
        { label: 'Author', value: source?.author || source?.primaryCreator },
        { label: 'Publisher', value: source?.publisher },
        { label: 'Year', value: source?.year || source?.releaseYear },
        { label: 'Format', value: source?.format },
        { label: 'ISBN', value: source?.isbn },
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

    return (
        <View style={styles.screen}>
            <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />

            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
                    <Ionicons name="arrow-back" size={22} color={colors.text} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Details</Text>
                {isManual && (
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
                    <View style={styles.iconBox}>
                        <Ionicons name={getIconForType(type)} size={48} color={colors.primary} />
                    </View>
                    <Text style={styles.title}>{title}</Text>
                    {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
                </View>

                {/* Description */}
                {description ? (
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Description</Text>
                        <Text style={styles.description}>{description}</Text>
                    </View>
                ) : null}

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
            </ScrollView>
        </View>
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
    iconBox: {
        width: 96,
        height: 96,
        borderRadius: 20,
        backgroundColor: colors.primary + '15',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: spacing.md,
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
});
