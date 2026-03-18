import { createContext, useContext, useState, useEffect } from 'react';
import { login as apiLogin, logout as apiLogout, getMe as apiGetMe } from '../api/client';

const AuthContext = createContext(null);
// UI auth state is informational only; API routes enforce JWT + admin role server-side.
const IDLE_TIMEOUT_MINUTES = Number(import.meta.env.VITE_ADMIN_IDLE_TIMEOUT_MINUTES || 20);
const IDLE_TIMEOUT_MS = Number.isFinite(IDLE_TIMEOUT_MINUTES) && IDLE_TIMEOUT_MINUTES > 0
  ? IDLE_TIMEOUT_MINUTES * 60 * 1000
  : 20 * 60 * 1000;
const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'touchstart', 'scroll'];

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function bootstrapSession() {
      try {
        // Server-validated bootstrap check; avoids trusting client-stored auth state.
        const response = await apiGetMe();
        const userData = response?.data?.user;
        if (!cancelled && userData?.isAdmin) {
          setUser(userData);
        }
      } catch (_err) {
        if (!cancelled) {
          setUser(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    bootstrapSession();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!user) return undefined;

    let timerId = null;
    const resetIdleTimer = () => {
      if (timerId) {
        window.clearTimeout(timerId);
      }
      timerId = window.setTimeout(() => {
        logout();
      }, IDLE_TIMEOUT_MS);
    };

    ACTIVITY_EVENTS.forEach((eventName) => {
      window.addEventListener(eventName, resetIdleTimer, { passive: true });
    });
    resetIdleTimer();

    return () => {
      if (timerId) {
        window.clearTimeout(timerId);
      }
      ACTIVITY_EVENTS.forEach((eventName) => {
        window.removeEventListener(eventName, resetIdleTimer);
      });
    };
  }, [user]);

  const login = async (username, password) => {
    const response = await apiLogin(username, password);
    const { user: userData } = response.data;

    if (!userData?.isAdmin) {
      throw new Error('Admin access required');
    }

    setUser(userData);

    return userData;
  };

  const logout = async () => {
    try {
      await apiLogout();
    } finally {
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
