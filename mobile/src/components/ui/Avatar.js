import React from 'react';
import { StyleSheet, View, Text } from 'react-native';
import CachedImage from './CachedImage';
import { colors, radius, typography } from '../../theme';

export default function Avatar({ uri, name = 'User', size = 'md', style }) {
    const sizeMap = { sm: 32, md: 40, lg: 56, xl: 80 };
    const d = sizeMap[size];
    const fontSize = d * 0.4;

    const initials = name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .substring(0, 2)
        .toUpperCase();

    return (
        <View style={[styles.container, { width: d, height: d, borderRadius: d / 2 }, style]}>
            {uri ? (
                <CachedImage source={{ uri }} style={{ width: d, height: d, borderRadius: d / 2 }} contentFit="cover" />
            ) : (
                <View style={[styles.fallback, { width: d, height: d, borderRadius: d / 2 }]}>
                    <Text style={[styles.initials, { fontSize }]}>{initials}</Text>
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        overflow: 'hidden',
        backgroundColor: colors.surfaceElevated,
    },
    fallback: {
        backgroundColor: colors.primary,
        justifyContent: 'center',
        alignItems: 'center',
    },
    initials: {
        fontFamily: typography.fontFamily.bold,
        color: colors.text,
    },
});
