import { createContext } from 'react';

export const AuthContext = createContext({
    token: '',
    setToken: () => { },
    apiBase: '',
    premiumEnabled: false,
    setPremiumEnabled: () => { },

    needsOnboarding: false,
    setNeedsOnboarding: () => { },
    user: null,
    setUser: () => { },
    onboardingConfig: null,
    setOnboardingConfig: () => { },
    onboardingConfigLoading: false,
    onboardingConfigError: null,
    refreshOnboardingConfig: async () => null,
    visionQuota: null,
    setVisionQuota: () => { },
});
