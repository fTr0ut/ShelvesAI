import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';

/**
 * StarRating component for displaying and setting ratings
 * Supports half-star ratings (0, 0.5, 1, 1.5, ... 5)
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

    const handlePress = (starIndex) => {
        if (!isInteractive) return;

        const currentStarValue = starIndex + 1;

        // If tapping on a star that's already fully filled, go to half
        // If tapping on a half-filled star, clear it
        // If tapping on an empty star, fill it fully
        let newRating;

        if (rating >= currentStarValue) {
            // Star is fully filled, reduce to half or previous full
            newRating = currentStarValue - 0.5;
        } else if (rating >= currentStarValue - 0.5) {
            // Star is half filled, clear to previous full
            newRating = currentStarValue - 1;
        } else {
            // Star is empty, fill it fully
            newRating = currentStarValue;
        }

        // Clamp to valid range
        newRating = Math.max(0, Math.min(maxStars, newRating));

        onRatingChange(newRating);
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

        const StarComponent = isInteractive ? TouchableOpacity : View;

        return (
            <StarComponent
                key={index}
                onPress={() => handlePress(index)}
                activeOpacity={0.7}
                style={styles.star}
            >
                <Ionicons name={iconName} size={size} color={iconColor} />
            </StarComponent>
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
    },
});

export default StarRating;
