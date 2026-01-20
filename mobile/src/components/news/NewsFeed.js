import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
    View,
    Text,
    ScrollView,
    StyleSheet,
    ActivityIndicator,
    RefreshControl
} from 'react-native';
import { useTheme } from '../../context/ThemeContext';
import { useNews } from '../../hooks/useNews';
import NewsSection from './NewsSection';
import QuickCheckInModal from './QuickCheckInModal';
import { Ionicons } from '@expo/vector-icons';

const NewsFeed = () => {
    const { colors, spacing, typography } = useTheme();
    const { newsData, loading, error, loadNews } = useNews();

    // Check-in modal state
    const [checkInModalVisible, setCheckInModalVisible] = useState(false);
    const [selectedNewsItem, setSelectedNewsItem] = useState(null);

    const handleCheckIn = useCallback((newsItem) => {
        setSelectedNewsItem(newsItem);
        setCheckInModalVisible(true);
    }, []);

    const handleCloseCheckIn = useCallback(() => {
        setCheckInModalVisible(false);
        setSelectedNewsItem(null);
    }, []);

    // Initial load
    useEffect(() => {
        loadNews();
    }, [loadNews]);

    // Flatten logic for rendering order
    // Dynamically render whatever the backend sends, but respect priority order if present.
    const sections = useMemo(() => {
        if (!newsData) return [];

        const priorityCats = ['movies', 'tv', 'games', 'books', 'vinyl'];
        const priorityTypes = ['trending', 'now_playing', 'upcoming', 'recent'];

        const result = [];

        // Get all categories from the payload
        const categories = Object.keys(newsData);

        // Sort categories: Priority ones first, then others alphabetically
        categories.sort((a, b) => {
            const idxA = priorityCats.indexOf(a);
            const idxB = priorityCats.indexOf(b);
            if (idxA !== -1 && idxB !== -1) return idxA - idxB;
            if (idxA !== -1) return -1;
            if (idxB !== -1) return 1;
            return a.localeCompare(b);
        });

        categories.forEach(cat => {
            const catData = newsData[cat];
            if (!catData) return;

            // Get all types for this category
            const types = Object.keys(catData);

            // Sort types: Priority ones first, then others alphabetically
            types.sort((a, b) => {
                const idxA = priorityTypes.indexOf(a);
                const idxB = priorityTypes.indexOf(b);
                if (idxA !== -1 && idxB !== -1) return idxA - idxB;
                if (idxA !== -1) return -1;
                if (idxB !== -1) return 1;
                return a.localeCompare(b);
            });

            types.forEach(type => {
                const items = catData[type];
                if (items && items.length > 0) {
                    result.push({
                        category: cat,
                        itemType: type,
                        items: items
                    });
                }
            });
        });

        return result;
    }, [newsData]);

    const styles = StyleSheet.create({
        container: {
            flex: 1,
        },
        centerConfig: {
            flex: 1,
            justifyContent: 'center',
            alignItems: 'center',
            padding: spacing.xl,
        },
        errorText: {
            ...typography.body1,
            color: colors.error,
            textAlign: 'center',
            marginTop: spacing.md,
        },
        emptyText: {
            ...typography.body1,
            color: colors.textMuted,
            textAlign: 'center',
            marginTop: spacing.md,
        }
    });

    if (loading && !newsData) {
        return (
            <View style={styles.centerConfig}>
                <ActivityIndicator size="large" color={colors.primary} />
            </View>
        );
    }

    if (error) {
        return (
            <ScrollView
                contentContainerStyle={styles.centerConfig}
                refreshControl={
                    <RefreshControl refreshing={loading} onRefresh={() => loadNews(true)} />
                }
            >
                <Ionicons name="alert-circle-outline" size={48} color={colors.error} />
                <Text style={styles.errorText}>{error}</Text>
            </ScrollView>
        );
    }

    if (!loading && sections.length === 0) {
        return (
            <ScrollView
                contentContainerStyle={styles.centerConfig}
                refreshControl={
                    <RefreshControl refreshing={loading} onRefresh={() => loadNews(true)} />
                }
            >
                <Ionicons name="newspaper-outline" size={48} color={colors.textMuted} />
                <Text style={styles.emptyText}>No news available right now.</Text>
            </ScrollView>
        );
    }

    return (
        <ScrollView
            style={styles.container}
            contentContainerStyle={{ paddingVertical: spacing.md }}
            refreshControl={
                <RefreshControl refreshing={loading} onRefresh={() => loadNews(true)} />
            }
        >
            {sections.map((sec, idx) => (
                <NewsSection
                    key={`${sec.category}-${sec.itemType}`}
                    category={sec.category}
                    itemType={sec.itemType}
                    items={sec.items}
                    onCheckIn={handleCheckIn}
                />
            ))}
            {/* Bottom spacer */}
            <View style={{ height: spacing.xl }} />

            {/* Quick Check-In Modal */}
            <QuickCheckInModal
                visible={checkInModalVisible}
                onClose={handleCloseCheckIn}
                newsItem={selectedNewsItem}
            />
        </ScrollView>
    );
};

export default NewsFeed;
