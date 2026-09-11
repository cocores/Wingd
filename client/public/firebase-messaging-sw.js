// Static file — not processed by Vite, so it can't read import.meta.env.
// The Firebase web config is passed as query params when this is
// registered (see src/lib/push.js registerServiceWorker()).
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

const params = new URLSearchParams(self.location.search);
firebase.initializeApp({
  apiKey: params.get('apiKey'),
  authDomain: params.get('authDomain'),
  projectId: params.get('projectId'),
  storageBucket: params.get('storageBucket'),
  messagingSenderId: params.get('messagingSenderId'),
  appId: params.get('appId'),
});

const messaging = firebase.messaging();

// Background messages (tab not focused, or app closed) surface as a system
// notification. Foreground messages are handled separately in
// src/lib/push.js, since onMessage() there only fires while the tab is open.
messaging.onBackgroundMessage((payload) => {
  const { title, body } = payload.notification || {};
  self.registration.showNotification(title || 'Wingd', {
    body,
    icon: '/favicon.ico',
    data: { url: payload.data?.url || '/' },
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      const existing = clients.find((c) => c.url.startsWith(self.location.origin));
      return existing ? existing.focus() : self.clients.openWindow(url);
    })
  );
});
