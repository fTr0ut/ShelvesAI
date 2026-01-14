import React, { useCallback, useState } from 'react';
import { View, Pressable, StyleSheet, Text } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
    Extrapolate,
    interpolate,
    useAnimatedStyle,
    useSharedValue,
    withSpring,
    withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../context/ThemeContext';

// Screens
import SocialFeedScreen from '../screens/SocialFeedScreen';
import ShelvesScreen from '../screens/ShelvesScreen';

const Tab = createBottomTabNavigator();

const TAB_BAR_HEIGHT = 60;
const FAB_SIZE = 64;
const FAB_OFFSET = 20;

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

function CustomTabBarButton({ children, onPress, onPressIn, menuProgress, style, ...props }) {
    const { colors, shadows } = useTheme();
    const iconStyle = useAnimatedStyle(() => ({
        transform: [
            { rotate: `${interpolate(menuProgress.value, [0, 1], [0, 45], Extrapolate.CLAMP)}deg` },
            { scale: interpolate(menuProgress.value, [0, 1], [1, 0.92], Extrapolate.CLAMP) },
        ],
    }));

    const buttonStyle = useAnimatedStyle(() => ({
        transform: [
            { scale: interpolate(menuProgress.value, [0, 1], [1, 0.98], Extrapolate.CLAMP) },
        ],
    }));

    return (
        <AnimatedPressable
            {...props}
            style={[
                styles.fabWrap,
                { ...shadows.lg },
                buttonStyle,
                style,
            ]}
            onPress={onPress}
            onPressIn={onPressIn}
            accessibilityRole="button"
        >
            <View
                style={[
                    styles.fab,
                    {
                        backgroundColor: colors.primary,
                        borderColor: colors.surface,
                    },
                ]}
            >
                <Animated.View style={iconStyle}>{children}</Animated.View>
            </View>
        </AnimatedPressable>
    );
}

// Null component for Add tab (it's just a button)
const NullComponent = () => null;

export default function BottomTabNavigator() {
    const navigation = useNavigation();
    const { colors, spacing, shadows, radius, typography, isDark } = useTheme();
    const insets = useSafeAreaInsets();
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const menuProgress = useSharedValue(0);

    const overlayColor = isDark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.25)';
    const actionBottom = TAB_BAR_HEIGHT + insets.bottom + spacing.lg;

    const overlayAnimatedStyle = useAnimatedStyle(() => ({
        opacity: interpolate(menuProgress.value, [0, 1], [0, 1], Extrapolate.CLAMP),
    }));

    const addItemStyle = useAnimatedStyle(() => ({
        opacity: interpolate(menuProgress.value, [0, 1], [0, 1], Extrapolate.CLAMP),
        transform: [
            { translateY: interpolate(menuProgress.value, [0, 1], [18, 0], Extrapolate.CLAMP) },
            { scale: interpolate(menuProgress.value, [0, 1], [0.96, 1], Extrapolate.CLAMP) },
        ],
    }));

    const checkInStyle = useAnimatedStyle(() => ({
        opacity: interpolate(menuProgress.value, [0, 1], [0, 1], Extrapolate.CLAMP),
        transform: [
            { translateY: interpolate(menuProgress.value, [0, 1], [26, 0], Extrapolate.CLAMP) },
            { scale: interpolate(menuProgress.value, [0, 1], [0.94, 1], Extrapolate.CLAMP) },
        ],
    }));

    const triggerHaptic = useCallback((style) => {
        Haptics.impactAsync(style).catch(() => {});
    }, []);

    const closeMenu = useCallback(() => {
        setIsMenuOpen(false);
        menuProgress.value = withTiming(0, { duration: 170 });
    }, [menuProgress]);

    const handleFabPressIn = useCallback(() => {
        triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
    }, [triggerHaptic]);

    const handleActionPressIn = useCallback(() => {
        triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
    }, [triggerHaptic]);

    const toggleMenu = useCallback(() => {
        setIsMenuOpen((prev) => {
            const next = !prev;
            menuProgress.value = next
                ? withSpring(1, { damping: 16, stiffness: 220 })
                : withTiming(0, { duration: 170 });
            return next;
        });
    }, [menuProgress]);

    const handleAddItem = useCallback(() => {
        closeMenu();
        navigation.navigate('ShelfSelect');
    }, [closeMenu, navigation]);

    const handleCheckIn = useCallback(() => {
        closeMenu();
        navigation.navigate('CheckIn');
    }, [closeMenu, navigation]);

    return (
        <View style={styles.screen}>
            <Tab.Navigator
                screenOptions={{
                    headerShown: false,
                    tabBarStyle: {
                        backgroundColor: colors.surface,
                        borderTopColor: colors.border,
                        borderTopWidth: 1,
                        height: TAB_BAR_HEIGHT,
                        paddingBottom: spacing.sm,
                        paddingTop: spacing.xs,
                        ...shadows.sm,
                    },
                    tabBarActiveTintColor: colors.primary,
                    tabBarInactiveTintColor: colors.textMuted,
                    tabBarShowLabel: true,
                    tabBarLabelStyle: {
                        fontSize: 12,
                        fontWeight: '500',
                    },
                }}
            >
                <Tab.Screen
                    name="Home"
                    component={SocialFeedScreen}
                    options={{
                        tabBarIcon: ({ color, size }) => (
                            <Ionicons name="home" size={size} color={color} />
                        ),
                    }}
                />

                <Tab.Screen
                    name="Add"
                    component={NullComponent}
                    listeners={() => ({
                        tabPress: (e) => {
                            e.preventDefault();
                        },
                    })}
                    options={{
                        tabBarIcon: () => (
                            <Ionicons
                                name="add"
                                size={32}
                                color={colors.textInverted}
                            />
                        ),
                        tabBarButton: (props) => (
                            <CustomTabBarButton
                                {...props}
                                onPress={toggleMenu}
                                onPressIn={handleFabPressIn}
                                menuProgress={menuProgress}
                            />
                        ),
                        tabBarLabel: () => null,
                    }}
                />

                <Tab.Screen
                    name="Shelves"
                    component={ShelvesScreen}
                    options={{
                        tabBarIcon: ({ color, size }) => (
                            <Ionicons name="library" size={size} color={color} />
                        ),
                    }}
                />
            </Tab.Navigator>

            <AnimatedPressable
                onPress={closeMenu}
                style={[
                    styles.overlay,
                    { backgroundColor: overlayColor },
                    overlayAnimatedStyle,
                ]}
                pointerEvents={isMenuOpen ? 'auto' : 'none'}
            />

            <View
                pointerEvents={isMenuOpen ? 'auto' : 'none'}
                style={[styles.actionContainer, { bottom: actionBottom }]}
            >
                <Animated.View style={[styles.actionItem, checkInStyle]}>
                    <Pressable
                        onPress={handleCheckIn}
                        onPressIn={handleActionPressIn}
                        style={({ pressed }) => [
                            styles.actionButton,
                            {
                                backgroundColor: colors.surface,
                                borderColor: colors.border,
                                borderRadius: radius.full,
                                ...shadows.md,
                            },
                            pressed && styles.actionButtonPressed,
                        ]}
                    >
                        <Ionicons name="checkbox-outline" size={18} color={colors.primary} />
                        <Text
                            style={[
                                styles.actionLabel,
                                { color: colors.text, fontFamily: typography.medium },
                            ]}
                        >
                            Check In
                        </Text>
                    </Pressable>
                </Animated.View>

                <Animated.View style={[styles.actionItem, styles.actionItemSpacer, addItemStyle]}>
                    <Pressable
                        onPress={handleAddItem}
                        onPressIn={handleActionPressIn}
                        style={({ pressed }) => [
                            styles.actionButton,
                            {
                                backgroundColor: colors.surface,
                                borderColor: colors.border,
                                borderRadius: radius.full,
                                ...shadows.md,
                            },
                            pressed && styles.actionButtonPressed,
                        ]}
                    >
                        <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
                        <Text
                            style={[
                                styles.actionLabel,
                                { color: colors.text, fontFamily: typography.medium },
                            ]}
                        >
                            Add Item
                        </Text>
                    </Pressable>
                </Animated.View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    screen: {
        flex: 1,
    },
    fabWrap: {
        top: -FAB_OFFSET,
        justifyContent: 'center',
        alignItems: 'center',
    },
    fab: {
        width: FAB_SIZE,
        height: FAB_SIZE,
        borderRadius: FAB_SIZE / 2,
        borderWidth: 4,
        justifyContent: 'center',
        alignItems: 'center',
    },
    overlay: {
        ...StyleSheet.absoluteFillObject,
    },
    actionContainer: {
        position: 'absolute',
        left: 0,
        right: 0,
        alignItems: 'center',
    },
    actionItem: {
        alignItems: 'center',
    },
    actionItemSpacer: {
        marginTop: 10,
    },
    actionButton: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 18,
        paddingVertical: 10,
        borderWidth: 1,
        gap: 8,
        minWidth: 160,
        justifyContent: 'center',
    },
    actionButtonPressed: {
        opacity: 0.9,
        transform: [{ scale: 0.98 }],
    },
    actionLabel: {
        fontSize: 14,
        fontWeight: '600',
    },
});
