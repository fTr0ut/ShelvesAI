/**
 * ShelvesAI Light Theme
 * Inspired by Goodreads + Threads aesthetic
 */

export const lightColors = {
    // Primary brand colors - Warm Amber
    primary: '#CA8A04',       // Warm amber
    primaryLight: '#EAB308',  // Bright yellow
    primaryDark: '#A16207',   // Deep amber

    // Backgrounds - Goodreads cream palette
    background: '#F4F1EA',    // Warm cream (Goodreads-inspired)
    surface: '#FFFFFF',       // Pure white cards
    surfaceElevated: '#FAFAF9', // Slightly off-white
    card: '#FFFFFF',

    // Text - Warm browns
    text: '#382110',          // Dark brown-black
    textSecondary: '#5C4033', // Medium brown
    textMuted: '#8B7355',     // Light brown
    textInverted: '#FFFFFF',  // White for dark buttons

    // Accents
    success: '#409D69',       // Goodreads green
    warning: '#D97706',       // Orange
    error: '#DC2626',         // Red
    info: '#6366F1',          // Indigo

    // Borders
    border: '#E5E0D8',        // Warm light grey
    borderLight: '#EEEBE4',

    // Gradients
    gradientStart: '#CA8A04',
    gradientEnd: '#EAB308',
};

export const lightTypography = {
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

export const lightSpacing = {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
    '2xl': 48,
    '3xl': 64,
};

export const lightRadius = {
    sm: 4,
    md: 8,
    lg: 12,
    xl: 16,
    full: 9999,
};

export const lightShadows = {
    sm: {
        shadowColor: '#382110',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.06,
        shadowRadius: 2,
        elevation: 1,
    },
    md: {
        shadowColor: '#382110',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 6,
        elevation: 3,
    },
    lg: {
        shadowColor: '#382110',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 12,
        elevation: 5,
    },
};
