/**
 * HomeHub service worker — minimal.
 *
 * Currently a placeholder so the browser can register it and grant
 * notification permission. Future: handle push events.
 */

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Click on a notification: focus the existing tab if open, else open a new one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // Prefer an existing HomeHub tab.
      for (const client of allClients) {
        if ('focus' in client) {
          await client.focus();
          // Tell the page to open the End of Day modal.
          client.postMessage({ type: 'open-end-of-day' });
          return;
        }
      }
      // Otherwise open the app.
      if (self.clients.openWindow) {
        await self.clients.openWindow('/');
      }
    })(),
  );
});