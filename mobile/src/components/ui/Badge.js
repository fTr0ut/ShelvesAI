import React from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { colors, radius, typography, spacing } from '../../theme';

export default function Badge({ label, count, color = colors.primary, style }) {
    const text = count !== undefined ? (count > 99 ? '99+' : count.toString()) : label;

    if (!text) return null;

    return (
        <View style={[styles.container, { backgroundColor: color }, style]}>
            <Text style={styles.text}>{text}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        paddingHorizontal: spacing.xs + 2,
        paddingVertical: 2,
        borderRadius: radius.full,
        alignSelf: 'flex-start',
        minWidth: 20,
        alignItems: 'center',
        justifyContent: 'center',
    },
    text: {
        fontSize: 10,
        fontFamily: typography.fontFamily.bold,
        color: '#FFF',
    },
});
