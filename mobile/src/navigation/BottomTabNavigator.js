import React, { useCallback, useContext, useState, useEffect } from 'react';
import { View, Pressable, StyleSheet, Text } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
    Extrapolate,
    interpolate,
    useAnimatedStyle,
    useSharedValue,
    withSpring,
    withTiming,
    withRepeat,
    withSequence,
    Easing,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../context/ThemeContext';
import { AuthContext } from '../context/AuthContext';
import { AccountSlideMenu } from '../components/ui';
import { ENABLE_PROFILE_IN_TAB_BAR } from '../config/featureFlags';

// Screens
import SocialFeedScreen from '../screens/SocialFeedScreen';
import ShelvesScreen from '../screens/ShelvesScreen';
import ShelfCreateScreen from '../screens/ShelfCreateScreen';
import ShelfSelectScreen from '../screens/ShelfSelectScreen';
import ShelfDetailScreen from '../screens/ShelfDetailScreen';
import ShelfEditScreen from '../screens/ShelfEditScreen';
import ItemSearchScreen from '../screens/ItemSearchScreen';
import CollectableDetailScreen from '../screens/CollectableDetailScreen';
import MarketValueSourcesScreen from '../screens/MarketValueSourcesScreen';

const Tab = createBottomTabNavigator();
const ShelvesStack = createNativeStackNavigator();

const TAB_BAR_HEIGHT = 60;
const FAB_SIZE = 80;
const FAB_OFFSET = 20;
const ENABLE_PERSISTENT_SHELVES_DETAIL_FOOTER = true;

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
                    shadows.lg,
                ]}
            >
                <Animated.View style={iconStyle}>{children}</Animated.View>
            </View>
        </AnimatedPressable>
    );
}

// Null component for Add tab (it's just a button)
const NullComponent = () => null;

function ShelvesTabStack() {
    return (
        <ShelvesStack.Navigator screenOptions={{ headerShown: false }}>
            <ShelvesStack.Screen name="ShelvesHome" component={ShelvesScreen} />
            <ShelvesStack.Screen name="ShelfCreateScreen" component={ShelfCreateScreen} />
            <ShelvesStack.Screen name="ShelfSelect" component={ShelfSelectScreen} />
            <ShelvesStack.Screen name="ShelfDetail" component={ShelfDetailScreen} />
            <ShelvesStack.Screen name="ShelfEdit" component={ShelfEditScreen} />
            <ShelvesStack.Screen name="ItemSearch" component={ItemSearchScreen} />
            <ShelvesStack.Screen name="CollectableDetail" component={CollectableDetailScreen} />
            <ShelvesStack.Screen name="MarketValueSources" component={MarketValueSourcesScreen} />
        </ShelvesStack.Navigator>
    );
}

export default function BottomTabNavigator() {
    const navigation = useNavigation();
    const { colors, spacing, shadows, radius, typography, isDark } = useTheme();
    const insets = useSafeAreaInsets();
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [activeTabRoute, setActiveTabRoute] = useState('Home');
    const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
    const { user } = useContext(AuthContext);
    const menuProgress = useSharedValue(0);
    const addItemPulse = useSharedValue(1);

    const overlayColor = isDark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.25)';
    const bottomInset = insets.bottom;
    const tabBarHeight = TAB_BAR_HEIGHT + bottomInset;
    const actionBottom = tabBarHeight + spacing.lg;

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

    const addItemGlowStyle = useAnimatedStyle(() => ({
        opacity: interpolate(menuProgress.value, [0, 1], [0, 0.5], Extrapolate.CLAMP) *
            interpolate(addItemPulse.value, [1, 1.25], [0.7, 0], Extrapolate.CLAMP),
        transform: [
            { scale: addItemPulse.value },
        ],
    }));

    const checkInStyle = useAnimatedStyle(() => ({
        opacity: interpolate(menuProgress.value, [0, 1], [0, 1], Extrapolate.CLAMP),
        transform: [
            { translateY: interpolate(menuProgress.value, [0, 1], [26, 0], Extrapolate.CLAMP) },
            { scale: interpolate(menuProgress.value, [0, 1], [0.94, 1], Extrapolate.CLAMP) },
        ],
    }));

    const searchStyle = useAnimatedStyle(() => ({
        opacity: interpolate(menuProgress.value, [0, 1], [0, 1], Extrapolate.CLAMP),
        transform: [
            { translateY: interpolate(menuProgress.value, [0, 1], [34, 0], Extrapolate.CLAMP) },
            { scale: interpolate(menuProgress.value, [0, 1], [0.92, 1], Extrapolate.CLAMP) },
        ],
    }));

    const triggerHaptic = useCallback((style) => {
        Haptics.impactAsync(style).catch(() => { });
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
        if (ENABLE_PROFILE_IN_TAB_BAR) setIsProfileMenuOpen(false);
        setIsMenuOpen((prev) => {
            const next = !prev;
            menuProgress.value = next
                ? withSpring(1, { damping: 16, stiffness: 220 })
                : withTiming(0, { duration: 170 });
            return next;
        });
    }, [menuProgress]);

    // Start/stop the pulse animation when menu opens/closes
    useEffect(() => {
        if (isMenuOpen) {
            addItemPulse.value = withRepeat(
                withSequence(
                    withTiming(1.25, { duration: 700, easing: Easing.inOut(Easing.ease) }),
                    withTiming(1, { duration: 700, easing: Easing.inOut(Easing.ease) })
                ),
                -1,
                false
            );
        } else {
            addItemPulse.value = withTiming(1, { duration: 150 });
        }
    }, [isMenuOpen, addItemPulse]);

    const handleAddItem = useCallback(() => {
        closeMenu();
        if (ENABLE_PERSISTENT_SHELVES_DETAIL_FOOTER) {
            navigation.navigate('Main', {
                screen: 'Shelves',
                params: { screen: 'ShelfSelect' },
            });
            return;
        }
        navigation.navigate('ShelfSelect');
    }, [closeMenu, navigation]);

    const handleCheckIn = useCallback(() => {
        closeMenu();
        navigation.navigate('CheckIn', { originTab: activeTabRoute });
    }, [activeTabRoute, closeMenu, navigation]);

    const handleSearch = useCallback(() => {
        closeMenu();
        navigation.navigate('FriendSearch');
    }, [closeMenu, navigation]);

    const handleProfilePress = useCallback(() => {
        setIsProfileMenuOpen(true);
    }, []);

    const closeProfileMenu = useCallback(() => {
        setIsProfileMenuOpen(false);
    }, []);

    return (
        <View style={styles.screen}>
            <Tab.Navigator
                initialRouteName="Home"
                safeAreaInsets={{ bottom: bottomInset }}
                screenOptions={{
                    headerShown: false,
                    tabBarStyle: {
                        backgroundColor: colors.surface,
                        borderTopColor: colors.border,
                        borderTopWidth: 1,
                        height: tabBarHeight,
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
                {ENABLE_PROFILE_IN_TAB_BAR && (
                    <Tab.Screen
                        name="ProfileTab"
                        component={NullComponent}
                        listeners={() => ({
                            tabPress: (e) => {
                                e.preventDefault();
                                handleProfilePress();
                            },
                        })}
                        options={{
                            tabBarLabel: 'Profile',
                            tabBarItemStyle: { flex: 1 },
                            tabBarIcon: ({ color, size }) => (
                                <Ionicons name="person-circle-outline" size={size} color={color} />
                            ),
                        }}
                    />
                )}

                <Tab.Screen
                    name="Home"
                    component={SocialFeedScreen}
                    listeners={({ navigation }) => ({
                        focus: () => {
                            setActiveTabRoute('Home');
                        },
                        tabPress: (e) => {
                            if (navigation.isFocused()) {
                                navigation.setParams({ resetTab: Date.now() });
                            }
                        },
                    })}
                    options={{
                        ...(ENABLE_PROFILE_IN_TAB_BAR && {
                            tabBarItemStyle: { flex: 1 },
                        }),
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
                        ...(ENABLE_PROFILE_IN_TAB_BAR && {
                            tabBarItemStyle: { flex: 2 },
                        }),
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
                    component={ENABLE_PERSISTENT_SHELVES_DETAIL_FOOTER ? ShelvesTabStack : ShelvesScreen}
                    listeners={() => ({
                        focus: () => {
                            setActiveTabRoute('Shelves');
                        },
                    })}
                    options={{
                        ...(ENABLE_PROFILE_IN_TAB_BAR && {
                            tabBarItemStyle: { flex: 2, alignItems: 'flex-start', paddingLeft: 24 },
                        }),
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
                    {/* Pulse glow ring behind the button */}
                    <Animated.View
                        style={[
                            styles.addItemGlow,
                            { backgroundColor: colors.primary },
                            addItemGlowStyle,
                        ]}
                        pointerEvents="none"
                    />
                    <Pressable
                        onPress={handleAddItem}
                        onPressIn={handleActionPressIn}
                        style={({ pressed }) => [
                            styles.actionButton,
                            {
                                backgroundColor: colors.surface,
                                borderColor: colors.primary,
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
                            Add to your shelf
                        </Text>
                    </Pressable>
                </Animated.View>

                <Animated.View style={[styles.actionItem, styles.actionItemSpacer, searchStyle]}>
                    <Pressable
                        onPress={handleSearch}
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
                        <Ionicons name="search-outline" size={18} color={colors.primary} />
                        <Text
                            style={[
                                styles.actionLabel,
                                { color: colors.text, fontFamily: typography.medium },
                            ]}
                        >
                            Search
                        </Text>
                    </Pressable>
                </Animated.View>
            </View>

            {ENABLE_PROFILE_IN_TAB_BAR && (
                <AccountSlideMenu
                    isVisible={isProfileMenuOpen}
                    onClose={closeProfileMenu}
                    navigation={navigation}
                    user={user}
                    direction="left"
                />
            )}
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
    addItemGlow: {
        position: 'absolute',
        top: -6,
        left: -6,
        right: -6,
        bottom: -6,
        borderRadius: 999,
    },
    actionLabel: {
        fontSize: 14,
        fontWeight: '600',
    },
});
