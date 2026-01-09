/**
 * ShelvesAI Design System
 * Dark Mode Theme
 */

export const colors = {
    // Primary brand colors - Warm Wood/Amber
    primary: '#D4A373',      // Warm Amber/Latte
    primaryLight: '#E9C46A', // Golden
    primaryDark: '#AC8153',  // Darker Wood

    // Backgrounds - Dark Coffee Shop Mood
    background: '#1C1917',   // Very Dark Warm Grey (Espresso)
    surface: '#292524',      // Dark Warm Grey (Americano)
    surfaceElevated: '#44403C', // Lighter Warm Grey
    card: '#292524',         // Same as surface

    // Text - Cream/Paper
    text: '#F5EFE6',         // Off-white/Cream
    textSecondary: '#A8A29E', // Warm Grey text
    textMuted: '#78716C',    // Muted Warm Grey
    textInverted: '#1C1917', // Dark for light buttons

    // Accents
    success: '#84A98C',      // Sage Green
    warning: '#CA6702',      // Burnt Orange/Cinnamon
    error: '#BC4749',        // Muted Red
    info: '#6D6875',         // Muted Purple/Info

    // Borders
    border: '#44403C',       // Warm Grey Border
    borderLight: '#57534E',

    // Gradients (Optional usage)
    gradientStart: '#D4A373',
    gradientEnd: '#E9C46A',
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
