import React, { useCallback, useMemo } from 'react';
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function hasBottomTabNavigationParent(navigation) {
    let parent = navigation?.getParent?.();

    while (parent) {
        const parentState = parent.getState?.();
        if (parentState?.type === 'tab') {
            return true;
        }
        parent = parent.getParent?.();
    }

    return false;
}

export default function useBottomFooterLayout() {
    const navigation = useNavigation();
    const insets = useSafeAreaInsets();
    const contextTabBarHeight = React.useContext(BottomTabBarHeightContext);
    const isInsideBottomTab = useMemo(
        () => hasBottomTabNavigationParent(navigation),
        [navigation]
    );
    const tabBarHeight = isInsideBottomTab && typeof contextTabBarHeight === 'number'
        ? contextTabBarHeight
        : 0;
    const bottomSafeInset = insets?.bottom ?? 0;
    const footerClearance = isInsideBottomTab ? tabBarHeight : bottomSafeInset;

    const contentBottomPadding = useCallback((basePadding = 0, extraSpacing = 0) => (
        basePadding + footerClearance + extraSpacing
    ), [footerClearance]);

    const floatingBottomOffset = useCallback((baseOffset = 0, extraSpacing = 0) => (
        baseOffset + footerClearance + extraSpacing
    ), [footerClearance]);

    return useMemo(() => ({
        isInsideBottomTab,
        tabBarHeight,
        bottomSafeInset,
        footerClearance,
        contentBottomPadding,
        floatingBottomOffset,
    }), [
        bottomSafeInset,
        contentBottomPadding,
        floatingBottomOffset,
        footerClearance,
        isInsideBottomTab,
        tabBarHeight,
    ]);
}
