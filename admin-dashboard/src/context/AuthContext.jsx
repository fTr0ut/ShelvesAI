import { createContext, useContext, useState, useEffect } from 'react';
import { login as apiLogin } from '../api/client';

const storage = typeof window !== 'undefined' ? window.sessionStorage : null;

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check for existing token on mount
    const token = storage?.getItem('adminToken');
    const userData = storage?.getItem('adminUser');
    if (token && userData) {
      try {
        const parsed = JSON.parse(userData);
        if (parsed?.isAdmin) {
          setUser(parsed);
        } else {
          storage?.removeItem('adminToken');
          storage?.removeItem('adminUser');
        }
      } catch (e) {
        storage?.removeItem('adminToken');
        storage?.removeItem('adminUser');
      }
    }
    setLoading(false);
  }, []);

  const login = async (username, password) => {
    const response = await apiLogin(username, password);
    const { token, user: userData } = response.data;

    if (!userData?.isAdmin) {
      storage?.removeItem('adminToken');
      storage?.removeItem('adminUser');
      throw new Error('Admin access required');
    }

    storage?.setItem('adminToken', token);
    storage?.setItem('adminUser', JSON.stringify(userData));
    setUser(userData);

    return userData;
  };

  const logout = () => {
    storage?.removeItem('adminToken');
    storage?.removeItem('adminUser');
    setUser(null);
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
