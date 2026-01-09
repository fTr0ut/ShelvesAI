import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors, shadows, spacing } from '../theme';

// Screens
import SocialFeedScreen from '../screens/SocialFeedScreen';
import ShelvesScreen from '../screens/ShelvesScreen';
import ShelfCreateScreen from '../screens/ShelfCreateScreen'; // Or a dedicated Add modal wrapper

// Create a dummy component for the 'Add' action since we might want it to open a modal
const NullComponent = () => null;

const Tab = createBottomTabNavigator();

function CustomTabBarButton({ children, onPress }) {
    return (
        <TouchableOpacity
            style={{
                top: -20, // Float above
                justifyContent: 'center',
                alignItems: 'center',
                ...shadows.md,
            }}
            onPress={onPress}
            activeOpacity={0.9}
        >
            <View
                style={{
                    width: 64,
                    height: 64,
                    borderRadius: 32,
                    backgroundColor: colors.primary, // Solid indigo
                    borderWidth: 4,
                    borderColor: colors.background, // Match background to create "cutout" effect
                }}
            >
                {children}
            </View>
        </TouchableOpacity>
    );
}

export default function BottomTabNavigator() {
    const navigation = useNavigation();

    return (
        <Tab.Navigator
            screenOptions={{
                headerShown: true, // We want headers for the Account icon
                headerStyle: {
                    backgroundColor: colors.background,
                    borderBottomColor: colors.border,
                    borderBottomWidth: 1,
                },
                headerTintColor: colors.text,
                tabBarStyle: {
                    backgroundColor: colors.surface,
                    borderTopColor: colors.border,
                    height: 60,
                    paddingBottom: spacing.sm,
                    paddingTop: spacing.xs,
                },
                tabBarActiveTintColor: colors.primary,
                tabBarInactiveTintColor: colors.textMuted,
                tabBarShowLabel: true,
            }}
        >
            <Tab.Screen
                name="Home"
                component={SocialFeedScreen}
                options={{
                    tabBarIcon: ({ color, size }) => (
                        <Ionicons name="home" size={size} color={color} />
                    ),
                    headerRight: () => (
                        <TouchableOpacity onPress={() => navigation.navigate('Account')} style={{ marginRight: spacing.md }}>
                            <Ionicons name="person-circle-outline" size={28} color={colors.text} />
                        </TouchableOpacity>
                    ),
                }}
            />

            <Tab.Screen
                name="Add"
                component={NullComponent}
                listeners={() => ({
                    tabPress: (e) => {
                        e.preventDefault(); // Prevent navigation
                        navigation.navigate('ShelfCreateScreen'); // Or a generic "Add" modal
                    },
                })}
                options={{
                    tabBarIcon: ({ focused }) => (
                        <Ionicons name="add" size={32} color="#FFF" />
                    ),
                    tabBarButton: (props) => (
                        <CustomTabBarButton {...props} />
                    ),
                    tabBarLabel: () => null, // No label for button
                }}
            />

            <Tab.Screen
                name="Shelves"
                component={ShelvesScreen}
                options={{
                    tabBarIcon: ({ color, size }) => (
                        <Ionicons name="library" size={size} color={color} />
                    ),
                    headerRight: () => (
                        <TouchableOpacity onPress={() => navigation.navigate('Account')} style={{ marginRight: spacing.md }}>
                            <Ionicons name="person-circle-outline" size={28} color={colors.text} />
                        </TouchableOpacity>
                    ),
                }}
            />
        </Tab.Navigator>
    );
}
