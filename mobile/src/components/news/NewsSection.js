import React from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { useTheme } from '../../context/ThemeContext';
import NewsCard from './NewsCard';

// Helper to format category titles
const formatTitle = (category, type) => {
    const cat = category.charAt(0).toUpperCase() + category.slice(1);
    const t = type.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

    // Mapping specific combos if needed
    if (type === 'now_playing') return `${cat} Now Playing`;
    if (type === 'trending') return `Trending ${cat}`;
    if (type === 'upcoming') return `Upcoming ${cat}`;
    if (type === 'recent') return `Recent ${cat}`;

    return `${t} ${cat}`;
};

const NewsSection = ({ category, itemType, items, onCheckIn, onDismiss, hideHeader = false }) => {
    const { colors, spacing, typography } = useTheme();

    if (!items || items.length === 0) return null;

    const styles = StyleSheet.create({
        container: {
            marginBottom: hideHeader ? 0 : spacing.xl,
        },
        header: {
            paddingHorizontal: spacing.md,
            marginBottom: spacing.md,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
        },
        title: {
            ...typography.h3,
            color: colors.text,
            fontWeight: 'bold',
        },
        subtitle: {
            ...typography.caption,
            color: colors.textMuted,
        },
        listContent: {
            paddingHorizontal: spacing.md,
            paddingBottom: spacing.sm, // space for shadow
        }
    });

    return (
        <View style={styles.container}>
            {!hideHeader && (
                <View style={styles.header}>
                    <Text style={styles.title}>
                        {formatTitle(category, itemType)}
                    </Text>
                </View>
            )}

            <FlatList
                horizontal
                data={items}
                keyExtractor={(item) => `news-${category}-${itemType}-${item.id}`}
                renderItem={({ item }) => (
                    <NewsCard
                        item={item}
                        onCheckIn={onCheckIn ? () => onCheckIn({ ...item, category }) : undefined}
                        onDismiss={onDismiss ? () => onDismiss({ ...item, category, itemType }) : undefined}
                    />
                )}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.listContent}
            />
        </View>
    );
};

export default NewsSection;
