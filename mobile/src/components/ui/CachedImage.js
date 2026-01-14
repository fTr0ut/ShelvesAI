import { Image } from 'expo-image';
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { colors } from '../../../../shared/theme/tokens';

export default function CachedImage({
    source,
    style,
    contentFit = 'cover',
    placeholder,
    transition = 200,
    ...props
}) {
    const [hasError, setHasError] = useState(false);

    // If source is a string URI, ensure it's an object as expo-image expects
    // or pass directly if it handles strings (expo-image handles both, but objects allow headers)
    // We'll pass it through but ensure caching policy

    const imageSource = typeof source === 'string'
        ? { uri: source }
        : source;

    if (hasError) {
        return (
            <View style={[styles.errorContainer, style]}>
                {/* You could render a fallback icon here if passed as children or prop */}
            </View>
        );
    }

    return (
        <Image
            source={imageSource}
            style={style}
            contentFit={contentFit}
            placeholder={placeholder}
            transition={transition}
            cachePolicy="memory-disk"
            onError={() => setHasError(true)}
            {...props}
        />
    );
}

const styles = StyleSheet.create({
    errorContainer: {
        backgroundColor: colors.surfaceHighlight,
        justifyContent: 'center',
        alignItems: 'center',
        overflow: 'hidden',
    },
});
