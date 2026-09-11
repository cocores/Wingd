import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { listenForForegroundMessages } from '../lib/push.js';

const AUTO_DISMISS_MS = 8000;

// Background pushes (tab unfocused/closed) are handled by the service
// worker; this only covers the case where a push arrives while a tab
// showing the app is open and focused, which the browser won't otherwise
// surface as a system notification.
export default function PushToast() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (!user) return undefined;
    const unsubscribe = listenForForegroundMessages((payload) => {
      setToast({ title: payload.notification?.title, body: payload.notification?.body, url: payload.data?.url || '/' });
    });
    return unsubscribe;
  }, [user]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  if (!toast) return null;

  return (
    <div
      className="push-toast"
      onClick={() => {
        navigate(toast.url);
        setToast(null);
      }}
    >
      <div>
        <strong>{toast.title}</strong>
        <p>{toast.body}</p>
      </div>
      <button
        className="link-btn"
        onClick={(e) => {
          e.stopPropagation();
          setToast(null);
        }}
      >
        ✕
      </button>
    </div>
  );
}
