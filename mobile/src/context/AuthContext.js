import { createContext } from 'react';

export const AuthContext = createContext({
    token: '',
    setToken: () => { },
    apiBase: '',

    needsOnboarding: false,
    setNeedsOnboarding: () => { },
    user: null,
    setUser: () => { },
});
