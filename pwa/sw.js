self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open('paisa-v1').then(cache => cache.addAll([
      '/',
      '/index.html',
      '/manifest.json',
      '/icon-192.png',
      '/icon-512.png',
      '/sw.js'
    ]))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    })
  );
});
