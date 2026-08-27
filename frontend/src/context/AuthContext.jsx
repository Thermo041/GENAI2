import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { authApi } from '../services/endpoints.js';
import { githubLoginUrl, onAuthExpired } from '../services/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, authenticated: false, user: null, installations: [], installUrl: '', hasInstallation: false });
  const [reconnectNeeded, setReconnectNeeded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await authApi.me();
      setState({
        loading: false,
        authenticated: Boolean(data.authenticated),
        user: data.user || null,
        installations: data.installations || [],
        installUrl: data.installUrl || '',
        hasInstallation: Boolean(data.hasInstallation),
        githubApp: data.githubApp,
      });
      if (data.authenticated) setReconnectNeeded(false);
      return data;
    } catch (error) {
      setState((prev) => ({ ...prev, loading: false, authenticated: false, user: null }));
      if (error.code === 'NETWORK_ERROR') toast.error('Cannot reach the CodeWeave API.', { id: 'api-down' });
      return null;
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(
    () =>
      onAuthExpired((error) => {
        if (error.code === 'GITHUB_AUTH_EXPIRED') {
          setReconnectNeeded(true);
          toast.error('Your GitHub connection needs to be refreshed.', { id: 'github-expired' });
        } else {
          setState((prev) => ({ ...prev, authenticated: false, user: null }));
        }
      }),
    [],
  );

  const login = useCallback((returnTo = '/dashboard') => {
    window.location.href = githubLoginUrl(returnTo);
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      setState({ loading: false, authenticated: false, user: null, installations: [], installUrl: state.installUrl, hasInstallation: false });
      window.location.href = '/';
    }
  }, [state.installUrl]);

  const value = useMemo(
    () => ({ ...state, reconnectNeeded, refresh, login, logout }),
    [state, reconnectNeeded, refresh, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
