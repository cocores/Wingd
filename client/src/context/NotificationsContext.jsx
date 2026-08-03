import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useAuth } from './AuthContext.jsx';

const NotificationsContext = createContext(null);

const EMPTY = { newMatches: 0, unreadMessages: 0, newCopilotAcceptances: 0, pendingVotes: 0 };
const POLL_MS = 15000;

export function NotificationsProvider({ children }) {
  const { user } = useAuth();
  const [summary, setSummary] = useState(EMPTY);
  const intervalRef = useRef(null);

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      const { data } = await api.get('/notifications/summary');
      setSummary(data);
    } catch {
      // ignore transient failures; next poll will retry
    }
  }, [user]);

  useEffect(() => {
    if (!user) {
      setSummary(EMPTY);
      return;
    }
    refresh();
    intervalRef.current = setInterval(refresh, POLL_MS);
    return () => clearInterval(intervalRef.current);
  }, [user, refresh]);

  return <NotificationsContext.Provider value={{ summary, refresh }}>{children}</NotificationsContext.Provider>;
}

export function useNotifications() {
  return useContext(NotificationsContext);
}
