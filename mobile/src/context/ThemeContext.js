import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Import both themes
import * as darkTheme from '../theme/index';
import * as lightTheme from '../theme/theme_light';

const THEME_KEY = '@shelvesai_theme';

// Create context
const ThemeContext = createContext(null);

// Flatten typography to have fontFamily properties at top level for convenience
const flattenTypography = (typo) => ({
    ...typo,
    // Flatten fontFamily to top level
    regular: typo?.fontFamily?.regular || 'System',
    medium: typo?.fontFamily?.medium || 'System',
    semibold: typo?.fontFamily?.semibold || 'System',
    bold: typo?.fontFamily?.bold || 'System',
});

// Map theme names to theme objects
const themes = {
    dark: {
        colors: darkTheme.colors,
        typography: flattenTypography(darkTheme.typography),
        spacing: darkTheme.spacing,
        radius: darkTheme.radius,
        shadows: darkTheme.shadows,
        isDark: true,
    },
    light: {
        colors: lightTheme.lightColors,
        typography: flattenTypography(lightTheme.lightTypography),
        spacing: lightTheme.lightSpacing,
        radius: lightTheme.lightRadius,
        shadows: lightTheme.lightShadows,
        isDark: false,
    },
};

export function ThemeProvider({ children }) {
    const [themeName, setThemeName] = useState('light'); // Default to light
    const [isLoading, setIsLoading] = useState(true);

    // Load saved theme preference on mount
    useEffect(() => {
        (async () => {
            try {
                const saved = await AsyncStorage.getItem(THEME_KEY);
                if (saved && themes[saved]) {
                    setThemeName(saved);
                }
            } catch (e) {
                console.warn('Failed to load theme preference:', e);
            } finally {
                setIsLoading(false);
            }
        })();
    }, []);

    // Toggle between light and dark
    const toggleTheme = async () => {
        const newTheme = themeName === 'light' ? 'dark' : 'light';
        setThemeName(newTheme);
        try {
            await AsyncStorage.setItem(THEME_KEY, newTheme);
        } catch (e) {
            console.warn('Failed to save theme preference:', e);
        }
    };

    // Set a specific theme
    const setTheme = async (name) => {
        if (themes[name]) {
            setThemeName(name);
            try {
                await AsyncStorage.setItem(THEME_KEY, name);
            } catch (e) {
                console.warn('Failed to save theme preference:', e);
            }
        }
    };

    const value = useMemo(() => ({
        ...themes[themeName],
        themeName,
        toggleTheme,
        setTheme,
        isLoading,
    }), [themeName, isLoading]);

    return (
        <ThemeContext.Provider value={value}>
            {children}
        </ThemeContext.Provider>
    );
}

// Hook to access theme
export function useTheme() {
    const context = useContext(ThemeContext);
    if (!context) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
}

export default ThemeContext;
