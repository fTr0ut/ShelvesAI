import React, { useCallback, useContext, useMemo, useRef, useState } from 'react';
import {
    Dimensions,
    FlatList,
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
import { apiRequest } from '../services/api';

const { width: screenWidth } = Dimensions.get('window');

export default function OnboardingPagerScreen({ navigation }) {
    const { token, apiBase, user, setUser, onboardingConfig } = useContext(AuthContext);
    const { colors, spacing, typography, radius, shadows, isDark } = useTheme();
    const [index, setIndex] = useState(0);
    const listRef = useRef(null);

    const styles = useMemo(
        () => createStyles({ colors, spacing, typography, radius, shadows }),
        [colors, spacing, typography, radius, shadows]
    );

    const resolveUser = useCallback(async () => {
        if (user || !token) return user;
        try {
            const data = await apiRequest({ apiBase, path: '/api/account', token });
            if (data.user) {
                setUser(data.user);
                return data.user;
            }
        } catch (err) {
            return null;
        }
        return null;
    }, [apiBase, setUser, token, user]);

    const pages = onboardingConfig?.intro?.pages || [];

    const handleNext = useCallback(async () => {
        if (index < pages.length - 1) {
            listRef.current?.scrollToIndex({ index: index + 1, animated: true });
            return;
        }

        const currentUser = await resolveUser();
        if (!currentUser?.username) {
            navigation.navigate('UsernameSetup', { nextRoute: 'OnboardingProfileRequired' });
            return;
        }
        navigation.navigate('OnboardingProfileRequired');
    }, [index, navigation, resolveUser, pages.length]);

    if (!pages.length) {
        return (
            <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
                <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />
                <View style={styles.loadingContainer}>
                    <Ionicons name="hourglass" size={32} color={colors.primary} />
                    <Text style={styles.loadingText}>Loading onboarding...</Text>
                </View>
            </SafeAreaView>
        );
    }

    const renderItem = ({ item }) => (
        <View style={[styles.page, { width: screenWidth }]}>
            <View style={styles.iconWrap}>
                <Ionicons name={item.icon} size={44} color={colors.primary} />
            </View>
            <Text style={styles.title}>{item.title}</Text>
            <Text style={styles.subtitle}>{item.subtitle}</Text>
            <Text style={styles.body}>{item.body}</Text>
        </View>
    );

    const onViewableItemsChanged = useRef(({ viewableItems }) => {
        if (viewableItems?.[0]?.index != null) {
            setIndex(viewableItems[0].index);
        }
    }).current;

    const viewConfig = useRef({ viewAreaCoveragePercentThreshold: 50 }).current;

    return (
        <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
            <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />

            <FlatList
                ref={listRef}
                data={pages}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                renderItem={renderItem}
                keyExtractor={(item) => item.key}
                onViewableItemsChanged={onViewableItemsChanged}
                viewabilityConfig={viewConfig}
            />

            <View style={styles.footer}>
                <View style={styles.dots}>
                    {pages.map((page, dotIndex) => (
                        <View
                            key={page.key}
                            style={[
                                styles.dot,
                                dotIndex === index && styles.dotActive,
                            ]}
                        />
                    ))}
                </View>

                <TouchableOpacity style={styles.primaryButton} onPress={handleNext}>
                    <Text style={styles.primaryButtonText}>
                        {index === pages.length - 1
                            ? onboardingConfig.intro.startButtonLabel
                            : onboardingConfig.intro.nextButtonLabel}
                    </Text>
                    <Ionicons name="arrow-forward" size={18} color={colors.textInverted} />
                </TouchableOpacity>
            </View>
        </SafeAreaView>
    );
}

const createStyles = ({ colors, spacing, typography, radius, shadows }) =>
    StyleSheet.create({
        screen: {
            flex: 1,
            backgroundColor: colors.background,
        },
        page: {
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: spacing.xl,
        },
        iconWrap: {
            width: 88,
            height: 88,
            borderRadius: 24,
            backgroundColor: colors.primary + '18',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: spacing.lg,
            ...shadows.sm,
        },
        title: {
            fontSize: 26,
            fontWeight: '700',
            color: colors.text,
            textAlign: 'center',
        },
        subtitle: {
            fontSize: 16,
            color: colors.textMuted,
            textAlign: 'center',
            marginTop: spacing.xs,
        },
        body: {
            fontSize: 15,
            color: colors.text,
            textAlign: 'center',
            marginTop: spacing.md,
            lineHeight: 22,
        },
        footer: {
            paddingHorizontal: spacing.xl,
            paddingBottom: spacing.lg,
            gap: spacing.md,
        },
        loadingContainer: {
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            gap: spacing.sm,
        },
        loadingText: {
            fontSize: 14,
            color: colors.textMuted,
        },
        dots: {
            flexDirection: 'row',
            justifyContent: 'center',
            gap: spacing.xs,
        },
        dot: {
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: colors.border,
        },
        dotActive: {
            backgroundColor: colors.primary,
            width: 20,
        },
        primaryButton: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: spacing.sm,
            backgroundColor: colors.primary,
            paddingVertical: spacing.md,
            borderRadius: radius.lg,
        },
        primaryButtonText: {
            color: colors.textInverted,
            fontSize: 16,
            fontWeight: '600',
        },
    });
