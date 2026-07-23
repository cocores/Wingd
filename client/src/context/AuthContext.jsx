import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, setAuthToken } from '../api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [hasProfile, setHasProfile] = useState(false);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState(() => localStorage.getItem('wingd_token'));

  const refreshMe = useCallback(async () => {
    try {
      const { data } = await api.get('/auth/me');
      setUser(data.user);
      setHasProfile(data.hasProfile);
    } catch {
      setUser(null);
      setHasProfile(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      if (token) {
        setAuthToken(token);
        await refreshMe();
      }
      setLoading(false);
    })();
  }, [token, refreshMe]);

  function loginWithToken(newToken, newUser) {
    localStorage.setItem('wingd_token', newToken);
    setAuthToken(newToken);
    setToken(newToken);
    setUser(newUser);
  }

  function logout() {
    localStorage.removeItem('wingd_token');
    setAuthToken(null);
    setToken(null);
    setUser(null);
    setHasProfile(false);
  }

  return (
    <AuthContext.Provider value={{ user, token, hasProfile, loading, loginWithToken, logout, refreshMe, setHasProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
