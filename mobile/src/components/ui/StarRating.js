import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';

/**
 * StarRating component for displaying and setting ratings
 * Supports half-star ratings via tap position (left half vs right half)
 * 
 * @param {number} rating - Current rating value (0-5)
 * @param {function} onRatingChange - Callback when rating changes (optional, makes component interactive)
 * @param {number} size - Star size in pixels (default: 20)
 * @param {number} maxStars - Maximum number of stars (default: 5)
 * @param {boolean} disabled - Whether interaction is disabled
 * @param {object} style - Additional container styles
 */
export function StarRating({
    rating = 0,
    onRatingChange,
    size = 20,
    maxStars = 5,
    disabled = false,
    style,
}) {
    const { colors } = useTheme();
    const isInteractive = !!onRatingChange && !disabled;

    const handlePress = (event, index) => {
        if (!isInteractive) return;

        // Get tap position relative to the star
        const { locationX } = event.nativeEvent;
        // Approximate width of the touch target (size + margins) or just assume center split
        // Since we don't have exact layout width here easily without onLayout, 
        // we can assume the star icon is roughly square and fills the target.
        // A simple heuristic: if locationX < (size / 2), it's a half star.

        const isHalf = locationX < (size / 2);
        const value = index + (isHalf ? 0.5 : 1);

        onRatingChange(value);
    };

    const renderStar = (index) => {
        const starValue = index + 1;
        let iconName = 'star-outline';
        let iconColor = colors.textMuted;

        if (rating >= starValue) {
            // Full star
            iconName = 'star';
            iconColor = colors.warning || '#FFB800';
        } else if (rating >= starValue - 0.5) {
            // Half star
            iconName = 'star-half';
            iconColor = colors.warning || '#FFB800';
        }

        if (isInteractive) {
            return (
                <Pressable
                    key={index}
                    onPress={(e) => handlePress(e, index)}
                    style={({ pressed }) => [
                        styles.star,
                        { opacity: pressed ? 0.7 : 1 }
                    ]}
                    hitSlop={4}
                >
                    <Ionicons name={iconName} size={size} color={iconColor} />
                </Pressable>
            );
        }

        return (
            <View key={index} style={styles.star}>
                <Ionicons name={iconName} size={size} color={iconColor} />
            </View>
        );
    };

    return (
        <View style={[styles.container, style]}>
            {Array.from({ length: maxStars }, (_, index) => renderStar(index))}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    star: {
        marginHorizontal: 1,
        padding: 2, // Slight padding for easier touch
    },
});

export default StarRating;
