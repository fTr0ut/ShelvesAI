import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';

// Screens
import SocialFeedScreen from '../screens/SocialFeedScreen';
import ShelvesScreen from '../screens/ShelvesScreen';

const Tab = createBottomTabNavigator();

function CustomTabBarButton({ children, onPress }) {
    const { colors, shadows } = useTheme();

    return (
        <TouchableOpacity
            style={{
                top: -20,
                justifyContent: 'center',
                alignItems: 'center',
                ...shadows.lg,
            }}
            onPress={onPress}
            activeOpacity={0.9}
        >
            <View
                style={{
                    width: 64,
                    height: 64,
                    borderRadius: 32,
                    backgroundColor: colors.primary,
                    borderWidth: 4,
                    borderColor: colors.surface,
                    justifyContent: 'center',
                    alignItems: 'center',
                }}
            >
                {children}
            </View>
        </TouchableOpacity>
    );
}

// Null component for Add tab (it's just a button)
const NullComponent = () => null;

export default function BottomTabNavigator() {
    const navigation = useNavigation();
    const { colors, spacing, shadows } = useTheme();

    return (
        <Tab.Navigator
            screenOptions={{
                headerShown: false,
                tabBarStyle: {
                    backgroundColor: colors.surface,
                    borderTopColor: colors.border,
                    borderTopWidth: 1,
                    height: 60,
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
                        navigation.navigate('ShelfCreateScreen');
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
                        <CustomTabBarButton {...props} />
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
    );
}
