/* The service worker that makes the app installable.

   Network first, always: there is no build step and no version number, so
   whatever the server has is the app. The cache is only a fallback, so that
   an installed app still opens, and says the server cannot be reached, when
   it cannot be. Nothing under /api/ is ever touched: the data lives on the
   server, and a stale copy of it is exactly what the app is built to refuse. */
'use strict';

var CACHE = 'ptt-shell-v1';

self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

function shell(req) {
  var url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return false;
  if (url.pathname.indexOf('/api/') === 0) return false;
  return true;
}

self.addEventListener('fetch', function (e) {
  if (!shell(e.request)) return;
  e.respondWith(fetch(e.request).then(function (res) {
    // a proxy in front (tailscale serve) answers 502 when the app is down:
    // that is the server out of reach too
    if (res.status >= 500) throw new Error('server ' + res.status);
    if (res.ok) {
      var copy = res.clone(), page = e.request.mode === 'navigate' ? res.clone() : null;
      caches.open(CACHE).then(function (c) {
        c.put(e.request, copy);
        // every name is the same page: keep it once more under one key, so
        // a name never opened offline before still gets it
        if (page) c.put('/index.html', page);
      });
    }
    return res;
  }).catch(function () {
    return caches.match(e.request).then(function (hit) {
      // any page of the app is the same page; a name never opened offline
      // still gets the app, which then says the server is out of reach
      if (hit) return hit;
      if (e.request.mode !== 'navigate') return Response.error();
      return caches.match('/index.html').then(function (page) { return page || Response.error(); });
    });
  }));
});
