import { initializeApp, getApps } from 'firebase/app';
import { getMessaging, getToken, onMessage, isSupported } from 'firebase/messaging';
import { api } from '../api';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY;

export function pushConfigured() {
  return Object.values(firebaseConfig).every(Boolean) && !!VAPID_KEY;
}

let appInstance = null;
function getFirebaseApp() {
  if (!appInstance) appInstance = getApps()[0] || initializeApp(firebaseConfig);
  return appInstance;
}

// public/firebase-messaging-sw.js is a static file the Vite bundler never
// touches, so it can't read import.meta.env — the config is passed as
// query params on the registration URL instead.
function registerServiceWorker() {
  const params = new URLSearchParams(firebaseConfig);
  return navigator.serviceWorker.register(`/firebase-messaging-sw.js?${params}`);
}

export async function pushSupported() {
  if (!pushConfigured()) return false;
  if (!('serviceWorker' in navigator) || !('Notification' in window)) return false;
  return isSupported();
}

export function currentPermission() {
  return typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';
}

export async function enablePushNotifications() {
  if (!(await pushSupported())) {
    throw new Error('Push notifications are not supported in this browser');
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Notification permission was not granted');
  }

  const registration = await registerServiceWorker();
  const messaging = getMessaging(getFirebaseApp());
  const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
  if (!token) throw new Error('Could not get a push token');

  await api.post('/notifications/register-token', { token });
  return token;
}

// Background messages are handled by the service worker; this only fires
// while a tab showing the app is focused.
export function listenForForegroundMessages(onMessageReceived) {
  if (!pushConfigured()) return () => {};
  const messaging = getMessaging(getFirebaseApp());
  return onMessage(messaging, onMessageReceived);
}
