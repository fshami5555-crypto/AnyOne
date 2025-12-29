
const CACHE_NAME = 'anyone-v2';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});

// التعامل مع الأزرار داخل الإشعار
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  const action = event.action;
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // إذا كان التطبيق مفتوحاً، نركز عليه ونرسل له الأمر
      for (const client of clientList) {
        if (client.url.includes('/') && 'focus' in client) {
          client.focus();
          if (action === 'answer') {
            client.postMessage({ type: 'ACTION_ANSWER' });
          } else if (action === 'reject') {
            client.postMessage({ type: 'ACTION_REJECT' });
          }
          return;
        }
      }
      // إذا لم يكن مفتوحاً، نفتحه مع بارامتر خاص
      if (clients.openWindow) {
        let url = '/';
        if (action === 'answer') url += '?action=answer';
        return clients.openWindow(url);
      }
    })
  );
});
