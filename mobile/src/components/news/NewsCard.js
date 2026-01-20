import React from 'react';
import {
    View,
    Text,
    Image,
    StyleSheet,
    TouchableOpacity,
    Linking
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';

const NewsCard = ({ item, onCheckIn }) => {
    const { colors, spacing, typography, shadows } = useTheme();

    // Safety check
    if (!item) return null;

    const {
        title,
        description,
        coverImageUrl,
        sourceUrl,
        sourceApi
    } = item;

    const handlePress = () => {
        if (sourceUrl) {
            Linking.openURL(sourceUrl).catch(err =>
                console.error("Couldn't load page", err)
            );
        }
    };

    const handleCheckIn = (e) => {
        e.stopPropagation();
        if (onCheckIn) {
            onCheckIn(item);
        }
    };

    const styles = StyleSheet.create({
        card: {
            width: 280,
            backgroundColor: colors.surface,
            borderRadius: 12,
            marginRight: spacing.md,
            overflow: 'hidden',
            // Simple border for definition if no shadow
            borderWidth: 1,
            borderColor: colors.border,
            ...shadows.sm,
        },
        coverContainer: {
            height: 160,
            width: '100%',
            backgroundColor: colors.background,
            position: 'relative',
        },
        cover: {
            width: '100%',
            height: '100%',
        },
        fallbackCover: {
            flex: 1,
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: colors.surfaceVariant,
        },
        content: {
            padding: spacing.md,
        },
        title: {
            ...typography.h4,
            color: colors.text,
            marginBottom: spacing.xs,
            lineHeight: 22,
        },
        description: {
            ...typography.body2,
            color: colors.textMuted,
            lineHeight: 18,
            marginBottom: spacing.sm,
        },
        footer: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: spacing.xs,
        },
        checkInButton: {
            flexDirection: 'row',
            alignItems: 'center',
            paddingVertical: 6,
            paddingHorizontal: 10,
            backgroundColor: colors.primary + '15',
            borderRadius: 8,
            gap: 4,
        },
        checkInText: {
            ...typography.caption,
            color: colors.primary,
            fontWeight: '600',
        },
        sourceBadge: {
            flexDirection: 'row',
            alignItems: 'center',
        },
        sourceText: {
            ...typography.caption,
            color: colors.primary,
            marginLeft: 4,
            fontWeight: '600',
        }
    });

    return (
        <TouchableOpacity
            style={styles.card}
            activeOpacity={0.9}
            onPress={handlePress}
            accessibilityRole="button"
            accessibilityLabel={`Open ${title}`}
        >
            <View style={styles.coverContainer}>
                {coverImageUrl ? (
                    <Image
                        source={{ uri: coverImageUrl }}
                        style={styles.cover}
                        resizeMode="cover"
                    />
                ) : (
                    <View style={styles.fallbackCover}>
                        <Ionicons name="newspaper-outline" size={48} color={colors.textMuted} />
                    </View>
                )}
            </View>

            <View style={styles.content}>
                <Text style={styles.title} numberOfLines={2}>{title}</Text>
                {description ? (
                    <Text style={styles.description} numberOfLines={2}>
                        {description}
                    </Text>
                ) : null}

                <View style={styles.footer}>
                    {onCheckIn ? (
                        <TouchableOpacity
                            style={styles.checkInButton}
                            onPress={handleCheckIn}
                            accessibilityLabel={`Check in to ${title}`}
                        >
                            <Ionicons name="add-circle-outline" size={14} color={colors.primary} />
                            <Text style={styles.checkInText}>Check In</Text>
                        </TouchableOpacity>
                    ) : (
                        <View />
                    )}
                    <View style={styles.sourceBadge}>
                        <Text style={styles.sourceText}>
                            Read on {sourceApi ? sourceApi.toUpperCase() : 'Web'}
                        </Text>
                        <Ionicons name="open-outline" size={14} color={colors.primary} style={{ marginLeft: 4 }} />
                    </View>
                </View>
            </View>
        </TouchableOpacity>
    );
};

export default NewsCard;
