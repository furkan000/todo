/* Where the app keeps things.

   Every module used to talk to localStorage directly. They talk to this
   instead, through the same two calls — getItem and setItem — and it decides
   where that goes:

   - opened as a file, or at the server's root, it *is* localStorage, exactly as
     before. Nothing about that mode changed.
   - opened at /<name> on the server, it is that name's record on the server.
     The address bar is the whole of the identity: there is no login, so a name
     is an address, not a secret.

   Reads stay synchronous, which is what lets no other module care. The record
   is fetched whole before the app boots (`ready`), kept in memory, and writes
   are sent after the fact, one request per key, coalesced.

   Like pomodoro.js it is two layers: the bookkeeping below takes its transport
   as an argument, so the tests drive saves, failures and a second device
   without a network; the chip at the bottom only paints what that says.

   Two devices on one name is the case that needs care. Every key has a
   revision on the server. A *guarded* key — the text — is only written against
   the revision it was read at, so a stale copy cannot quietly overwrite a newer
   one: the server refuses, and the chip asks which to keep. Everything else is
   last-write-wins. Between saves the page asks the server what changed and
   takes in whatever it has not itself edited. */
(function (global) {
  'use strict';

  var NAME = /^\/([A-Za-z0-9][A-Za-z0-9_-]{0,39})$/;
  // a name is also a path on the server, so it may not be one the app needs
  var RESERVED = { api: 1, css: 1, js: 1, test: 1, scripts: 1, server: 1, data: 1, temp: 1, index: 1, favicon: 1 };
  var SEEDABLE = /^ptt\.[a-z0-9]+(\.[a-z0-9]+)*$/;
  var FLUSH_MS = 400;        // typing is coalesced into one request per pause
  var POLL_MS = 15000;       // how often a visible page asks what changed
  var RETRY_MS = 2000, RETRY_MAX = 30000;
  var KEEPALIVE_MAX = 60000; // what a request may carry and still outlive its page

  var user = null, transport = null, local = null;
  var mem = {}, revs = {};
  var dirty = {}, flying = {}, clash = {}, force = {}, guarded = {};
  var loaded = false, offline = false, seeded = false, checking = false;
  var flushTimer = null, retryDelay = RETRY_MS;
  var changeFns = [], remoteFns = [], settleFn = null;

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  // The name in the address bar, or null when there is no server to keep it on
  function userFrom(loc) {
    if (!loc || !/^https?:$/.test(loc.protocol)) return null;
    var m = NAME.exec(loc.pathname || '');
    if (!m) return null;
    var name = m[1].toLowerCase();
    return has(RESERVED, name) ? null : name;
  }

  /* ---------- the two calls everything else uses ---------- */

  function getItem(k) {
    if (!user) return local.getItem(k);
    return has(mem, k) ? mem[k] : null;
  }

  function setItem(k, v) {
    v = String(v);
    if (!user) return local.setItem(k, v);
    if (mem[k] === v) return;
    mem[k] = v;
    dirty[k] = true;
    schedule();
    changed();
  }

  // Every key held that starts with `prefix` — for a module that keeps one key
  // per thing, like a day of notes, and has to find them again
  function keys(prefix) {
    var all = [];
    if (!user) {
      try { for (var i = 0; i < local.length; i++) all.push(local.key(i)); } catch (e) {}
    } else all = Object.keys(mem);
    return all.filter(function (k) { return k && k.indexOf(prefix || '') === 0; }).sort();
  }

  /* ---------- loading ---------- */

  // Calls `ok` once there is something to read from. In server mode a failure
  // calls `fail` instead, and the app must not start: booting on an empty
  // record would show the sample, and the first edit would save it over the
  // real one.
  function ready(ok, fail) {
    if (!user) return ok();
    transport.load(user, function (err, keys) {
      if (err) return fail && fail(err);
      mem = {}; revs = {};
      Object.keys(keys || {}).forEach(function (k) {
        mem[k] = keys[k].value;
        revs[k] = keys[k].rev;
      });
      loaded = true;
      if (!Object.keys(mem).length) seed();
      changed();
      ok();
    });
  }

  // A name nobody has used yet starts from what this browser already had, so
  // moving onto the server is opening the address and nothing else.
  function seed() {
    try {
      for (var i = 0; i < local.length; i++) {
        var k = local.key(i);
        if (!SEEDABLE.test(k) || k.indexOf('ptt.u.') === 0) continue;
        mem[k] = local.getItem(k);
        dirty[k] = true;
        seeded = true;
      }
    } catch (e) {}
    if (seeded) schedule();
  }

  /* ---------- saving ---------- */

  function schedule(ms) {
    if (flushTimer) return;
    flushTimer = setTimeout(function () { flushTimer = null; flush(); }, ms || FLUSH_MS);
  }

  // `last` means the page is going away: ask for requests that outlive it
  function flush(last) {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    if (!user || !loaded) return;
    Object.keys(dirty).forEach(function (k) {
      if (flying[k] || clash[k]) return;   // one request per key at a time
      var value = mem[k];
      var rev = guarded[k] && !force[k] ? (revs[k] || 0) : null;
      delete dirty[k];
      delete force[k];
      flying[k] = true;
      transport.put(user, k, value, rev, !!last && value.length < KEEPALIVE_MAX, function (err, ok, now) {
        delete flying[k];
        if (err) {
          dirty[k] = true;
          offline = true;
          schedule(retryDelay);
          retryDelay = Math.min(retryDelay * 2, RETRY_MAX);
        } else {
          offline = false;
          retryDelay = RETRY_MS;
          if (ok) revs[k] = now;
          else { clash[k] = true; dirty[k] = true; }   // refused: mine is still unsaved
          if (dirty[k] && !clash[k]) schedule();       // edited again while in flight
        }
        changed();
      });
    });
    changed();
  }

  /* ---------- a second device ---------- */

  function settle() { if (settleFn) { try { settleFn(); } catch (e) {} } }
  function mine(k) { return dirty[k] || flying[k] || clash[k]; }

  // Ask what changed on the server and take in whatever was not edited here.
  // A key edited on both sides is left alone: its save will be refused, and
  // that is where the question gets asked.
  function check(done) {
    done = done || function () {};
    if (!user || !loaded || checking) return done([]);
    settle();
    checking = true;
    transport.revs(user, function (err, theirs) {
      checking = false;
      if (err) return done([]);
      var stale = Object.keys(theirs || {}).filter(function (k) {
        return theirs[k] > (revs[k] || 0) && !mine(k);
      });
      if (!stale.length) return done([]);
      checking = true;
      transport.load(user, function (err, keys) {
        checking = false;
        if (err) return done([]);
        settle();
        var took = [];
        stale.forEach(function (k) {
          if (!keys || !keys[k] || mine(k) || keys[k].rev <= (revs[k] || 0)) return;
          revs[k] = keys[k].rev;
          if (mem[k] === keys[k].value) return;
          mem[k] = keys[k].value;
          took.push(k);
        });
        if (took.length) remoteFns.forEach(function (fn) { fn(took); });
        changed();
        done(took);
      });
    });
  }

  // The answer to "changed on another device": keep 'mine' or load 'theirs'
  function resolve(which, done) {
    done = done || function () {};
    settle();
    var keys = Object.keys(clash);
    if (!keys.length) return done([]);
    if (which === 'mine') {
      keys.forEach(function (k) { delete clash[k]; force[k] = true; dirty[k] = true; });
      flush();
      return done(keys);
    }
    transport.load(user, function (err, all) {
      if (err) { offline = true; changed(); return done([]); }
      keys.forEach(function (k) {
        delete clash[k];
        delete dirty[k];
        if (all && all[k]) { mem[k] = all[k].value; revs[k] = all[k].rev; }
      });
      remoteFns.forEach(function (fn) { fn(keys); });
      changed();
      done(keys);
    });
  }

  /* ---------- what the chip reads ---------- */

  function status() {
    if (!user) return 'local';
    if (Object.keys(clash).length) return 'conflict';
    if (offline) return 'offline';
    if (Object.keys(dirty).length || Object.keys(flying).length) return 'saving';
    return 'saved';
  }

  function changed() {
    paint();
    changeFns.forEach(function (fn) { fn(status()); });
  }

  // Closing the tab is fine when the last requests can outlive it. It is worth
  // a warning when they cannot: the server is unreachable, the text is waiting
  // on an answer about a conflict, or it is too big to be carried out.
  function atRisk() {
    return Object.keys(guarded).some(function (k) {
      return clash[k] || (offline && dirty[k]) ||
        ((dirty[k] || flying[k]) && String(mem[k] || '').length >= KEEPALIVE_MAX);
    });
  }

  /* ---------- the network ---------- */

  function request(method, path, body, headers, keepalive, cb) {
    var opts = { method: method, headers: headers || {}, cache: 'no-store' };
    if (body !== null) opts.body = body;
    if (keepalive) opts.keepalive = true;
    var p;
    try { p = global.fetch('/api/' + path, opts); } catch (e) { return cb(e); }
    p.then(function (r) {
      return r.json().then(function (j) { return { status: r.status, json: j }; });
    }).then(function (res) { return res; }, function (e) { return { err: e || new Error('network') }; })
      .then(function (res) { res.err ? cb(res.err) : cb(null, res.status, res.json); });
  }

  var http = {
    load: function (name, cb) {
      request('GET', name, null, null, false, function (err, status, j) {
        if (err || status !== 200) return cb(err || new Error('HTTP ' + status));
        cb(null, j.keys || {});
      });
    },
    revs: function (name, cb) {
      request('GET', name + '/revs', null, null, false, function (err, status, j) {
        if (err || status !== 200) return cb(err || new Error('HTTP ' + status));
        cb(null, j || {});
      });
    },
    // rev null writes regardless; a number makes the write conditional on it
    put: function (name, key, value, rev, keepalive, cb) {
      var headers = { 'Content-Type': 'text/plain; charset=utf-8' };
      if (rev !== null) headers['If-Match'] = String(rev);
      request('PUT', name + '/' + key, value, headers, keepalive, function (err, status, j) {
        if (err || (status !== 200 && status !== 409)) return cb(err || new Error('HTTP ' + status));
        cb(null, status === 200, j.rev);
      });
    }
  };

  /* ---------- the chip ---------- */

  var slot = null, painted = null;

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function chipHTML() {
    if (!user) return '';
    var s = status(), name = esc(user);
    // saving is drawn as saved — the markup does not change at all: it happens
    // every time you pause typing, and anything that changes that often
    // flickers. Only trouble shows. (beforeunload still warns if it matters.)
    if (s === 'saving') s = 'saved';
    var tip = s === 'saved' ? 'Kept on the server as “' + name + '”'
      : s === 'offline' ? 'The server cannot be reached. Your changes are kept in this tab and will be sent when it can.'
      : 'This text was changed somewhere else since this tab loaded it.';
    var html = '<span class="sync sync-' + s + '" title="' + tip + '"><i></i>' + name;
    if (s === 'offline') html += '<em>not saved — retrying</em>';
    if (s === 'conflict') {
      html += '<em>changed on another device</em>' +
        '<button data-sync="theirs" title="Drop what is in this tab and load the newer text">load theirs</button>' +
        '<u>/</u>' +
        '<button data-sync="mine" title="Save what is in this tab over the newer text">keep mine</button>';
    }
    return html + '</span>';
  }

  function paint() {
    if (!slot) return;
    var html = chipHTML();
    if (html === painted) return;   // leave a hovered button alone
    painted = html;
    slot.innerHTML = html;
  }

  function mount(el) {
    slot = el;
    painted = null;
    el.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-sync]') : null;
      if (b) resolve(b.getAttribute('data-sync'));
    });
    paint();
  }

  /* ---------- wiring ---------- */

  function reset(o) {
    o = o || {};
    user = o.user || null;
    transport = o.transport || http;
    try { local = o.storage || global.localStorage; } catch (e) { local = null; }
    mem = {}; revs = {}; dirty = {}; flying = {}; clash = {}; force = {}; guarded = {};
    loaded = false; offline = false; seeded = false; checking = false;
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = null; retryDelay = RETRY_MS;
    changeFns = []; remoteFns = []; settleFn = null;
    painted = null;
  }

  try { reset({ user: userFrom(global.location) }); } catch (e) { reset(); }

  if (global.addEventListener) {
    global.addEventListener('pagehide', function () { settle(); flush(true); });
    global.addEventListener('beforeunload', function (e) {
      if (!user) return;
      settle();
      flush(true);
      if (atRisk()) { e.preventDefault(); e.returnValue = ''; }
    });
    global.addEventListener('focus', function () { check(); });
    if (global.document) {
      global.document.addEventListener('visibilitychange', function () {
        if (global.document.visibilityState === 'visible') check(); else flush();
      });
      setInterval(function () {
        if (user && global.document.visibilityState === 'visible') check();
      }, POLL_MS);
    }
  }

  global.Store = {
    getItem: getItem, setItem: setItem, keys: keys, ready: ready,
    user: function () { return user; },
    seeded: function () { return seeded; },
    // a guarded key is never written over a revision this tab has not seen
    guard: function (k) { guarded[k] = true; },
    // called before anything is sent or compared, so the app can hand over what
    // it is still holding back — the text is saved a beat after you stop typing
    settle: function (fn) { settleFn = fn; },
    onchange: function (fn) { changeFns.push(fn); },
    onremote: function (fn) { remoteFns.push(fn); },
    status: status, flush: flush, check: check, resolve: resolve, atRisk: atRisk,
    mount: mount, chipHTML: chipHTML,
    userFrom: userFrom, configure: reset
  };
})(typeof window !== 'undefined' ? window : globalThis);
