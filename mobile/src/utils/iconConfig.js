/**
 * Centralized Category Icon Configuration
 * Maps shelf/item types to Ionicons names and unique colors
 */

export const CATEGORY_ICONS = {
    // Plural forms (shelf types)
    books: { icon: 'book', color: '#3B82F6' }, // Blue
    movies: { icon: 'film', color: '#141313ff' }, // Red
    games: { icon: 'game-controller', color: '#10B981' }, // Emerald
    music: { icon: 'musical-notes', color: '#8B5CF6' }, // Purple
    vinyl: { icon: 'disc', color: '#F59E0B' }, // Amber
    tv: { icon: 'tv', color: '#EC4899' }, // Pink
    other: { icon: 'library', color: '#ef7314ff' }, // Gray

    // Singular forms (item types) - aliases
    book: { icon: 'book', color: '#3B82F6' },
    movie: { icon: 'film', color: '#141313ff' },
    game: { icon: 'game-controller', color: '#10B981' },
    album: { icon: 'disc', color: '#F59E0B' },
};

const DEFAULT_CONFIG = { icon: 'library', color: '#6B7280' };

/**
 * Get icon configuration for a category type
 * @param {string} type - Category type (e.g., 'books', 'book', 'movies')
 * @returns {{ icon: string, color: string }}
 */
export const getIconConfig = (type) => {
    const normalized = type?.toLowerCase()?.trim();
    return CATEGORY_ICONS[normalized] || DEFAULT_CONFIG;
};

/**
 * Get just the icon name for a category type (backward compatible)
 * @param {string} type - Category type
 * @returns {string} Ionicons icon name
 */
export const getIconForType = (type) => getIconConfig(type).icon;

/**
 * Get just the color for a category type
 * @param {string} type - Category type
 * @returns {string} Hex color string
 */
export const getColorForType = (type) => getIconConfig(type).color;
