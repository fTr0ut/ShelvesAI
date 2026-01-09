/**
 * ShelvesAI Design System
 * Dark Mode Theme
 */

export const colors = {
    // Primary brand colors
    primary: '#6366F1',      // Indigo
    primaryLight: '#818CF8',
    primaryDark: '#4F46E5',

    // Backgrounds
    background: '#0F0F0F',
    surface: '#1A1A1A',
    surfaceElevated: '#252525',
    card: '#1F1F1F',

    // Text
    text: '#FFFFFF',
    textSecondary: '#A1A1AA',
    textMuted: '#71717A',
    textInverted: '#000000',

    // Accents
    success: '#10B981',
    warning: '#F59E0B',
    error: '#EF4444',
    info: '#3B82F6',

    // Borders
    border: '#2A2A2A',
    borderLight: '#3A3A3A',

    // Gradients (Optional usage, keeping for reference)
    gradientStart: '#6366F1',
    gradientEnd: '#8B5CF6',
};

export const typography = {
    fontFamily: {
        regular: 'Inter_400Regular',
        medium: 'Inter_500Medium',
        semibold: 'Inter_600SemiBold',
        bold: 'Inter_700Bold',
    },

    sizes: {
        xs: 12,
        sm: 14,
        base: 16,
        lg: 18,
        xl: 20,
        '2xl': 24,
        '3xl': 30,
        '4xl': 36,
    },

    lineHeights: {
        tight: 1.2,
        normal: 1.5,
        relaxed: 1.75,
    },
};

export const spacing = {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
    '2xl': 48,
    '3xl': 64,
};

export const radius = {
    sm: 4,
    md: 8,
    lg: 12,
    xl: 16,
    full: 9999,
};

export const shadows = {
    sm: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.2,
        shadowRadius: 2,
        elevation: 2,
    },
    md: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 4,
    },
    lg: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.4,
        shadowRadius: 16,
        elevation: 8,
    },
};
