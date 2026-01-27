import React, { useCallback, useContext, useEffect } from 'react';
import { Dimensions, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
    Extrapolate,
    interpolate,
    useAnimatedStyle,
    useSharedValue,
    withSpring,
    withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { AuthContext } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import Avatar from './Avatar';

const SCREEN_WIDTH = Dimensions.get('window').width;
const MENU_WIDTH = SCREEN_WIDTH * 0.4;

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const MENU_ITEMS = [
    { key: 'wishlist', label: 'My Wishlist', icon: 'heart-outline', screen: 'Wishlists' },
    { key: 'favorites', label: 'My Favorites', icon: 'star-outline', screen: 'Favorites' },
    { key: 'lists', label: 'My Lists', icon: 'list-outline', screen: 'Profile', params: { tab: 'lists' } },
    { key: 'friends', label: 'My Friends', icon: 'people-outline', screen: 'FriendsList' },
    { key: 'settings', label: 'Account Settings', icon: 'settings-outline', screen: 'Account' },
];

export default function AccountSlideMenu({ isVisible, onClose, navigation, user }) {
    const { apiBase } = useContext(AuthContext);
    const { colors, spacing, typography, shadows, radius, isDark } = useTheme();
    const insets = useSafeAreaInsets();
    const menuProgress = useSharedValue(0);
    const nav = useNavigation();

    const overlayColor = isDark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.25)';

    // Get display name
    const displayName = user?.firstName && user?.lastName
        ? `${user.firstName} ${user.lastName}`
        : user?.firstName || user?.username || 'User';
    const username = user?.username ? `@${user.username}` : '';

    // Build avatar URL from profileMediaUrl, profileMediaPath, or picture
    let avatarUri = null;
    if (user?.profileMediaUrl) {
        avatarUri = user.profileMediaUrl;
    } else if (user?.profileMediaPath && apiBase) {
        avatarUri = `${apiBase}/media/${user.profileMediaPath}`;
    } else if (user?.picture) {
        avatarUri = user.picture;
    }

    // Animate on visibility change
    useEffect(() => {
        if (isVisible) {
            menuProgress.value = withSpring(1, { damping: 16, stiffness: 220 });
        } else {
            menuProgress.value = withTiming(0, { duration: 170 });
        }
    }, [isVisible, menuProgress]);

    // Close menu when navigating away (e.g., tab switch)
    useEffect(() => {
        const unsubscribe = nav.addListener('blur', () => {
            if (isVisible) {
                onClose();
            }
        });
        return unsubscribe;
    }, [nav, isVisible, onClose]);

    // Overlay fade animation
    const overlayStyle = useAnimatedStyle(() => ({
        opacity: interpolate(menuProgress.value, [0, 1], [0, 1], Extrapolate.CLAMP),
    }));

    // Panel slide animation
    const panelStyle = useAnimatedStyle(() => ({
        transform: [
            { translateX: interpolate(menuProgress.value, [0, 1], [MENU_WIDTH, 0], Extrapolate.CLAMP) },
        ],
    }));

    const handleMenuItemPress = useCallback((item) => {
        onClose();
        // Small delay to allow menu to close before navigation
        setTimeout(() => {
            navigation.navigate(item.screen, item.params || {});
        }, 50);
    }, [onClose, navigation]);

    const handleProfilePress = useCallback(() => {
        onClose();
        setTimeout(() => {
            navigation.navigate('Profile');
        }, 50);
    }, [onClose, navigation]);

    const styles = StyleSheet.create({
        overlay: {
            ...StyleSheet.absoluteFillObject,
            backgroundColor: overlayColor,
        },
        panel: {
            position: 'absolute',
            right: 0,
            top: 0,
            bottom: 0,
            width: MENU_WIDTH,
            backgroundColor: colors.surface,
            ...shadows.lg,
            paddingTop: insets.top + spacing.lg,
            paddingBottom: insets.bottom + spacing.lg,
            paddingHorizontal: spacing.md,
        },
        profileCard: {
            alignItems: 'center',
            paddingVertical: spacing.lg,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
            marginBottom: spacing.md,
        },
        displayName: {
            fontSize: 16,
            fontWeight: '600',
            color: colors.text,
            marginTop: spacing.sm,
            textAlign: 'center',
        },
        username: {
            fontSize: 13,
            color: colors.textMuted,
            marginTop: 2,
            textAlign: 'center',
        },
        menuItem: {
            flexDirection: 'row',
            alignItems: 'center',
            paddingVertical: spacing.sm + 2,
            paddingHorizontal: spacing.xs,
            borderRadius: radius.md,
            marginBottom: spacing.xs,
        },
        menuItemPressed: {
            backgroundColor: colors.surfaceElevated,
        },
        menuItemIcon: {
            marginRight: spacing.sm,
        },
        menuItemLabel: {
            fontSize: 14,
            color: colors.text,
            fontWeight: '500',
            flex: 1,
        },
    });

    if (!isVisible) {
        return null;
    }

    return (
        <View style={StyleSheet.absoluteFill} pointerEvents={isVisible ? 'auto' : 'none'}>
            {/* Overlay */}
            <AnimatedPressable
                onPress={onClose}
                style={[styles.overlay, overlayStyle]}
            />

            {/* Menu Panel */}
            <Animated.View style={[styles.panel, panelStyle]}>
                {/* Profile Card */}
                <Pressable
                    onPress={handleProfilePress}
                    style={({ pressed }) => [
                        styles.profileCard,
                        pressed && { opacity: 0.7 },
                    ]}
                >
                    <Avatar
                        uri={avatarUri}
                        name={displayName}
                        size="lg"
                    />
                    <Text style={styles.displayName} numberOfLines={1}>{displayName}</Text>
                    {username ? <Text style={styles.username} numberOfLines={1}>{username}</Text> : null}
                </Pressable>

                {/* Menu Items */}
                {MENU_ITEMS.map((item) => (
                    <Pressable
                        key={item.key}
                        onPress={() => handleMenuItemPress(item)}
                        style={({ pressed }) => [
                            styles.menuItem,
                            pressed && styles.menuItemPressed,
                        ]}
                    >
                        <Ionicons
                            name={item.icon}
                            size={20}
                            color={colors.text}
                            style={styles.menuItemIcon}
                        />
                        <Text style={styles.menuItemLabel}>{item.label}</Text>
                    </Pressable>
                ))}
            </Animated.View>
        </View>
    );
}
