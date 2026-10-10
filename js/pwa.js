/* Installable: registers the service worker, where a browser allows one.

   That is only on a secure origin — https, or localhost itself. Plain http
   over a VPN or the LAN is not one, so there the app runs as before and is
   simply not installable; nothing breaks. */
(function (global) {
  'use strict';

  function available() {
    return 'serviceWorker' in global.navigator && global.isSecureContext && /^https?:$/.test(global.location.protocol);
  }

  var CACHE = 'ptt-shell-v1';   // the same name sw.js uses

  // The first visit is not seen by the worker — it was not running yet — so
  // the page hands it its own files once it is: the page, every script, the
  // stylesheet. Without this the app would only open offline after a second
  // visit.
  function warm() {
    if (!global.caches) return;
    var urls = [global.location.pathname, '/index.html'];
    Array.prototype.forEach.call(document.querySelectorAll('script[src], link[rel=stylesheet]'), function (el) {
      urls.push(el.getAttribute('src') || el.getAttribute('href'));
    });
    global.caches.open(CACHE).then(function (c) {
      urls.forEach(function (u) { c.add(new Request(u, { cache: 'reload' })).catch(function () {}); });
    });
  }

  function init() {
    if (!available()) return false;
    global.navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(function () {});
    global.navigator.serviceWorker.ready.then(warm).catch(function () {});
    return true;
  }

  global.PWA = { init: init, available: available };
})(typeof window !== 'undefined' ? window : globalThis);
