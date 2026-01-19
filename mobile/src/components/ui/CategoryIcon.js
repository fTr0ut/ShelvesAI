import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getIconConfig } from '../../utils/iconConfig';

/**
 * CategoryIcon - Renders an icon for a shelf/item category with appropriate color
 * 
 * @param {string} type - Category type (books, movies, games, etc.)
 * @param {number} size - Icon size (default: 24)
 * @param {string} color - Override color (optional, uses category color by default)
 * @param {object} style - Additional styles for the icon
 */
export default function CategoryIcon({
    type,
    size = 24,
    color,
    style
}) {
    const config = getIconConfig(type);
    const iconColor = color || config.color;

    return (
        <Ionicons
            name={config.icon}
            size={size}
            color={iconColor}
            style={style}
        />
    );
}

/**
 * CategoryIconBox - Icon with a tinted background container
 * 
 * @param {string} type - Category type
 * @param {number} size - Icon size (default: 24)
 * @param {number} boxSize - Container size (default: size * 2)
 * @param {number} borderRadius - Border radius (default: 8)
 * @param {object} style - Additional container styles
 */
export function CategoryIconBox({
    type,
    size = 24,
    boxSize,
    borderRadius = 8,
    style
}) {
    const config = getIconConfig(type);
    const containerSize = boxSize || size * 2;

    return (
        <View style={[
            styles.iconBox,
            {
                width: containerSize,
                height: containerSize,
                borderRadius,
                backgroundColor: config.color + '20', // 12% opacity
            },
            style
        ]}>
            <Ionicons name={config.icon} size={size} color={config.color} />
        </View>
    );
}

const styles = StyleSheet.create({
    iconBox: {
        justifyContent: 'center',
        alignItems: 'center',
    },
});
