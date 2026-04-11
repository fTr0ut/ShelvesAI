import React, { useCallback, useContext, useMemo, useState } from 'react';
import {
    Dimensions,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
    StatusBar,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withTiming,
    Easing,
} from 'react-native-reanimated';
import { AuthContext } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import OnboardingConfigGate from '../components/onboarding/OnboardingConfigGate';

const { width: screenWidth } = Dimensions.get('window');

const TAB_BAR_HEIGHT = 60;
const FAB_SIZE = 56;
const FAB_OFFSET = 18;

// Tab flex widths matching BottomTabNavigator with ENABLE_PROFILE_IN_TAB_BAR=true
// [Profile(1), Home(1), Add(2), Shelves(2)]
const TAB_FLEXES = [1, 1, 2, 2];

function UITourContent({ navigation, tourConfig }) {
    const { colors, spacing, typography, radius, shadows } = useTheme();
    const insets = useSafeAreaInsets();
    const [step, setStep] = useState(0);

    const tooltipOpacity = useSharedValue(1);
    const tooltipTranslateY = useSharedValue(0);

    const tabBarHeight = TAB_BAR_HEIGHT + insets.bottom;
    const steps = tourConfig.steps || [];

    const styles = useMemo(
        () => createStyles({ colors, spacing, typography, radius, shadows, tabBarHeight }),
        [colors, spacing, typography, radius, shadows, tabBarHeight]
    );

    const tooltipAnimStyle = useAnimatedStyle(() => ({
        opacity: tooltipOpacity.value,
        transform: [{ translateY: tooltipTranslateY.value }],
    }));

    const animateToStep = useCallback((nextStep) => {
        tooltipOpacity.value = withTiming(0, { duration: 140, easing: Easing.out(Easing.ease) });
        tooltipTranslateY.value = withTiming(-6, { duration: 140, easing: Easing.out(Easing.ease) });
        setTimeout(() => {
            setStep(nextStep);
            tooltipTranslateY.value = 6;
            tooltipOpacity.value = withTiming(1, { duration: 180, easing: Easing.out(Easing.ease) });
            tooltipTranslateY.value = withTiming(0, { duration: 180, easing: Easing.out(Easing.ease) });
        }, 150);
    }, [tooltipOpacity, tooltipTranslateY]);

    const handleNext = useCallback(() => {
        if (step < steps.length - 1) {
            animateToStep(step + 1);
        } else {
            navigation.navigate('OnboardingNewShelfTutorial');
        }
    }, [step, steps.length, animateToStep, navigation]);

    const currentStep = steps[step];
    const isLastStep = step === steps.length - 1;

    // Compute tooltip anchor center X for each tab slot
    const totalFlex = TAB_FLEXES.reduce((a, b) => a + b, 0);
    const tabCenters = TAB_FLEXES.reduce((acc, flex, i) => {
        const prevEnd = i === 0 ? 0 : acc[i - 1].end;
        const width = (flex / totalFlex) * screenWidth;
        acc.push({ end: prevEnd + width, center: prevEnd + width / 2 });
        return acc;
    }, []);

    const activeCenter = tabCenters[step]?.center ?? screenWidth / 2;
    const tooltipWidth = Math.min(280, screenWidth - spacing.xl * 2);
    const tooltipLeft = Math.max(
        spacing.md,
        Math.min(activeCenter - tooltipWidth / 2, screenWidth - tooltipWidth - spacing.md)
    );
    const caretLeft = activeCenter - tooltipLeft - 8;

    if (!currentStep) return null;

    return (
        <View style={styles.screen}>
            <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

            <SafeAreaView style={styles.safeArea} edges={['top']}>
                <View style={styles.header}>
                    <Text style={styles.headerTitle}>{tourConfig.screenTitle}</Text>
                    <Text style={styles.headerSubtitle}>{tourConfig.screenSubtitle}</Text>
                </View>
                <View style={styles.dots}>
                    {steps.map((s, i) => (
                        <View key={s.key} style={[styles.dot, i === step && styles.dotActive]} />
                    ))}
                </View>
            </SafeAreaView>

            {/* Tooltip card anchored above the active tab */}
            <Animated.View
                style={[
                    styles.tooltipWrap,
                    { bottom: tabBarHeight + spacing.sm, left: tooltipLeft, width: tooltipWidth },
                    tooltipAnimStyle,
                ]}
                pointerEvents="none"
            >
                <View style={[styles.tooltipCard, shadows.md]}>
                    <Text style={styles.tooltipTitle}>{currentStep.title}</Text>
                    <Text style={styles.tooltipBody}>{currentStep.body}</Text>
                </View>
                <View style={[styles.caret, { left: Math.max(8, Math.min(caretLeft, tooltipWidth - 24)) }]} />
            </Animated.View>

            {/* Mock tab bar */}
            <View style={[styles.tabBar, { height: tabBarHeight, paddingBottom: insets.bottom }]}>
                {steps.map((tabStep, i) => {
                    const isActive = i === step;
                    if (tabStep.isFab) {
                        return (
                            <View key={tabStep.key} style={styles.fabTabSlot}>
                                <View
                                    style={[
                                        styles.fabButton,
                                        {
                                            backgroundColor: colors.primary,
                                            borderColor: isActive ? colors.background : colors.surface,
                                        },
                                        isActive && styles.fabActive,
                                        shadows.md,
                                    ]}
                                >
                                    <Ionicons name="add" size={28} color={colors.textInverted} />
                                </View>
                                {isActive && (
                                    <View style={[styles.tabSpotlightFab, { borderColor: colors.primary }]} />
                                )}
                            </View>
                        );
                    }
                    return (
                        <View
                            key={tabStep.key}
                            style={[
                                styles.tabItem,
                                isActive && {
                                    borderWidth: 1.5,
                                    borderColor: colors.primary,
                                    backgroundColor: colors.primary + '18',
                                    borderRadius: radius.md,
                                },
                            ]}
                        >
                            <Ionicons
                                name={tabStep.icon}
                                size={24}
                                color={isActive ? colors.primary : colors.textMuted + '55'}
                            />
                            {tabStep.label ? (
                                <Text style={[styles.tabLabel, { color: isActive ? colors.primary : colors.textMuted + '55' }]}>
                                    {tabStep.label}
                                </Text>
                            ) : null}
                        </View>
                    );
                })}
            </View>

            {/* Next / Done button — vertically centered */}
            <View style={styles.ctaWrap}>
                <TouchableOpacity
                    style={[styles.ctaButton, { backgroundColor: colors.primary }]}
                    onPress={handleNext}
                    activeOpacity={0.85}
                >
                    <Text style={[styles.ctaLabel, { color: colors.textInverted }]}>
                        {isLastStep ? tourConfig.doneButtonLabel : tourConfig.nextButtonLabel}
                    </Text>
                    <Ionicons
                        name={isLastStep ? 'checkmark' : 'arrow-forward'}
                        size={18}
                        color={colors.textInverted}
                    />
                </TouchableOpacity>
            </View>
        </View>
    );
}

export default function OnboardingUITourScreen({ navigation }) {
    const { onboardingConfig } = useContext(AuthContext);

    return (
        <OnboardingConfigGate section="uiTour">
            <UITourContent navigation={navigation} tourConfig={onboardingConfig?.uiTour} />
        </OnboardingConfigGate>
    );
}

const createStyles = ({ colors, spacing, typography, radius, shadows, tabBarHeight }) =>
    StyleSheet.create({
        screen: {
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.88)',
        },
        safeArea: {
            paddingHorizontal: spacing.xl,
            paddingTop: spacing.lg,
        },
        header: {
            alignItems: 'center',
            marginBottom: spacing.lg,
        },
        headerTitle: {
            fontSize: 22,
            fontWeight: '700',
            color: '#fff',
            textAlign: 'center',
        },
        headerSubtitle: {
            fontSize: 14,
            color: 'rgba(255,255,255,0.6)',
            marginTop: spacing.xs,
            textAlign: 'center',
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
            backgroundColor: 'rgba(255,255,255,0.25)',
        },
        dotActive: {
            backgroundColor: colors.primary,
            width: 20,
        },
        tooltipWrap: {
            position: 'absolute',
        },
        tooltipCard: {
            backgroundColor: colors.surface,
            borderRadius: radius.lg,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.md,
            borderWidth: 1,
            borderColor: colors.border,
        },
        tooltipTitle: {
            fontSize: 16,
            fontWeight: '700',
            color: colors.text,
            marginBottom: spacing.xs,
        },
        tooltipBody: {
            fontSize: 14,
            color: colors.textMuted,
            lineHeight: 20,
        },
        caret: {
            position: 'absolute',
            bottom: -8,
            width: 0,
            height: 0,
            borderLeftWidth: 8,
            borderRightWidth: 8,
            borderTopWidth: 8,
            borderLeftColor: 'transparent',
            borderRightColor: 'transparent',
            borderTopColor: colors.border,
        },
        tabBar: {
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            flexDirection: 'row',
            backgroundColor: colors.surface,
            borderTopWidth: 1,
            borderTopColor: colors.border,
            alignItems: 'center',
        },
        tabItem: {
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            paddingTop: spacing.xs,
            paddingVertical: spacing.xs,
            marginHorizontal: 2,
            gap: 2,
        },
        tabLabel: {
            fontSize: 11,
            fontWeight: '500',
        },
        fabTabSlot: {
            flex: 2,
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
        },
        fabButton: {
            width: FAB_SIZE,
            height: FAB_SIZE,
            borderRadius: FAB_SIZE / 2,
            borderWidth: 3,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: FAB_OFFSET,
        },
        fabActive: {
            shadowColor: colors.primary,
            shadowOpacity: 0.5,
            shadowRadius: 12,
            shadowOffset: { width: 0, height: 0 },
            elevation: 10,
        },
        tabSpotlightFab: {
            position: 'absolute',
            top: -4,
            left: '50%',
            marginLeft: -(FAB_SIZE / 2 + 6),
            width: FAB_SIZE + 12,
            height: FAB_SIZE + 12,
            borderRadius: (FAB_SIZE + 12) / 2,
            borderWidth: 2,
            backgroundColor: 'transparent',
        },
        ctaWrap: {
            position: 'absolute',
            left: spacing.xl,
            right: spacing.xl,
            top: '50%',
            transform: [{ translateY: -24 }],
            alignItems: 'center',
        },
        ctaButton: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: spacing.sm,
            paddingVertical: spacing.md,
            paddingHorizontal: spacing.xl,
            borderRadius: radius.lg,
            minWidth: 160,
        },
        ctaLabel: {
            fontSize: 16,
            fontWeight: '600',
        },
    });
