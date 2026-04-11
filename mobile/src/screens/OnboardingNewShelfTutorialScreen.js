import React, { useCallback, useContext, useMemo } from 'react';
import {
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
import OnboardingConfigGate from '../components/onboarding/OnboardingConfigGate';

function NewShelfTutorialContent({ navigation, config }) {
    const { setNeedsOnboarding } = useContext(AuthContext);
    const { colors, spacing, typography, radius, shadows, isDark } = useTheme();

    const styles = useMemo(
        () => createStyles({ colors, spacing, typography, radius, shadows }),
        [colors, spacing, typography, radius, shadows]
    );

    const handlePress = useCallback(() => {
        setNeedsOnboarding(false);
        setTimeout(() => {
            navigation.reset({
                index: 1,
                routes: [{ name: 'Main' }, { name: 'ShelfCreateScreen' }],
            });
        }, 0);
    }, [navigation, setNeedsOnboarding]);

    return (
        <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
            <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />

            <View style={styles.page}>
                <View style={styles.iconWrap}>
                    <Ionicons name={config.icon} size={44} color={colors.primary} />
                </View>
                <Text style={styles.title}>{config.title}</Text>
                <Text style={styles.subtitle}>{config.subtitle}</Text>
                <Text style={styles.body}>{config.body}</Text>
            </View>

            <View style={styles.footer}>
                <TouchableOpacity style={styles.primaryButton} onPress={handlePress} activeOpacity={0.85}>
                    <Text style={styles.primaryButtonText}>{config.buttonLabel}</Text>
                    <Ionicons name="arrow-forward" size={18} color={colors.textInverted} />
                </TouchableOpacity>
            </View>
        </SafeAreaView>
    );
}

export default function OnboardingNewShelfTutorialScreen({ navigation }) {
    const { onboardingConfig } = useContext(AuthContext);

    return (
        <OnboardingConfigGate section="newShelfTutorial">
            <NewShelfTutorialContent navigation={navigation} config={onboardingConfig?.newShelfTutorial} />
        </OnboardingConfigGate>
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
