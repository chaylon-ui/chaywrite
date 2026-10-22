/* Exor Games alerts - the service worker behind /alerts (src/push.js).
   It only shows the notification it is handed and opens the link on tap. */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: 'Exor Games', body: e.data ? e.data.text() : '' }; }
  var opts = { body: d.body || '', data: { url: d.url || 'https://exorgames.com/' }, tag: d.tag || undefined, renotify: false };
  if (d.icon) opts.icon = d.icon;
  e.waitUntil(self.registration.showNotification(d.title || 'Exor Games', opts));
});
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || 'https://exorgames.com/';
  e.waitUntil(self.clients.openWindow(url));
});
