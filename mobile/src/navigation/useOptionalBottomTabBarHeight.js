import React, { useMemo } from 'react';
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';

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

export default function useOptionalBottomTabBarHeight() {
    const navigation = useNavigation();
    const tabBarHeight = React.useContext(BottomTabBarHeightContext);
    const isInsideBottomTab = useMemo(
        () => hasBottomTabNavigationParent(navigation),
        [navigation]
    );

    return useMemo(() => ({
        isInsideBottomTab,
        tabBarHeight: isInsideBottomTab && typeof tabBarHeight === 'number' ? tabBarHeight : 0,
    }), [isInsideBottomTab, tabBarHeight]);
}
