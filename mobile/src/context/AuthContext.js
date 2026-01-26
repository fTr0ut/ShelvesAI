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
    visionQuota: null,
    setVisionQuota: () => { },
});
