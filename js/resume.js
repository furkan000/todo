/* Resume: where you were in a track, so a reload does not send you back to
   the start of it.

   Kept apart from the catalogue on purpose. `ptt.music.v1` is a catalogue —
   stable data you write when you add or remove a row. A play position is the
   opposite: it changes every few seconds for as long as something is playing,
   and re-serialising the whole library that often to record one number would be
   the wrong shape. So positions live under their own key, keyed by the same
   entry key the library uses.

   It knows nothing about YouTube, the player or the DOM: you hand it a number
   of seconds and it hands one back. That is the whole surface, and it is what
   makes the rules below testable.

   Two rules decide whether a position is worth keeping at all:

   - Nearly finished is finished. Stopping ten seconds from the end and coming
     back to those ten seconds is worse than starting over, so a mark that close
     to the duration is dropped.
   - Barely started is not started. A few seconds in, the position is noise;
     resuming there feels like a glitch rather than a memory.

   A playlist keeps its place either way. The track you are on and the seconds
   into it are separate facts — a playlist five tracks deep that has only just
   begun the fifth should still come back to the fifth, even though those first
   seconds are not worth restoring. */
(function (global) {
  'use strict';

  var KEY = 'ptt.resume.v1';
  var TAIL = 10;   // this close to the end counts as having finished
  var FLOOR = 5;   // this early counts as not having started
  var CAP = 200;   // marks kept; the oldest fall off the end

  var marks = null;

  function num(v) {
    var n = typeof v === 'number' ? v : parseFloat(v);
    return typeof n === 'number' && isFinite(n) ? n : null;
  }

  function load() {
    if (marks) return marks;
    marks = {};
    try {
      var raw = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (raw && typeof raw === 'object') {
        Object.keys(raw).forEach(function (k) {
          var m = raw[k];
          if (!m || typeof m !== 'object') return;
          var t = num(m.t);
          if (t === null || t < 0) return;
          marks[k] = { t: Math.floor(t), v: m.v || null, i: num(m.i), at: num(m.at) || 0 };
        });
      }
    } catch (e) {}
    return marks;
  }

  function save() {
    var m = load(), keys = Object.keys(m);
    if (keys.length > CAP) {
      keys.sort(function (a, b) { return (m[b].at || 0) - (m[a].at || 0); })
          .slice(CAP).forEach(function (k) { delete m[k]; });
    }
    try { localStorage.setItem(KEY, JSON.stringify(m)); } catch (e) {}
  }

  function get(key) {
    var m = load()[key];
    return m ? { t: m.t, videoId: m.v, index: m.i, at: m.at } : null;
  }

  function forget(key) {
    var m = load();
    if (!(key in m)) return false;
    delete m[key];
    save();
    return true;
  }

  function forgetAll() { marks = {}; save(); }

  // Drop marks for anything no longer in the catalogue, so removing rows does
  // not leave their positions behind for good.
  function keep(keys) {
    var m = load(), live = {}, gone = 0;
    (keys || []).forEach(function (k) { live[k] = true; });
    Object.keys(m).forEach(function (k) { if (!live[k]) { delete m[k]; gone++; } });
    if (gone) save();
    return gone;
  }

  // pos: { t, duration, videoId, index }. Returns the stored mark, or null when
  // there was nothing worth storing — in which case any older mark is dropped,
  // since a stale position is worse than none.
  function mark(key, pos) {
    if (!key || !pos) return null;
    var t = num(pos.t);
    if (t === null || t < 0) return null;

    var d = num(pos.duration) || 0;
    var done = d > 0 && t >= d - TAIL;
    var at = (done || t < FLOOR) ? 0 : Math.floor(t);

    var i = num(pos.index);
    if (i === null || i < 0) i = null;
    var v = typeof pos.videoId === 'string' && pos.videoId ? pos.videoId : null;

    // nothing to come back to: no seconds worth keeping and no place in a list
    if (!at && i === null && !v) { forget(key); return null; }

    var m = load();
    m[key] = { t: at, v: v, i: i, at: Date.now() };
    save();
    return get(key);
  }

  // 3:24, or 1:02:03 once it needs the hours
  function format(seconds) {
    var t = num(seconds);
    if (t === null || t < 0) return '';
    t = Math.floor(t);
    var s = t % 60, m = Math.floor(t / 60) % 60, h = Math.floor(t / 3600);
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return h ? h + ':' + pad(m) + ':' + pad(s) : m + ':' + pad(s);
  }

  global.Resume = {
    KEY: KEY, TAIL: TAIL, FLOOR: FLOOR, CAP: CAP,
    get: get, mark: mark, forget: forget, forgetAll: forgetAll, keep: keep,
    format: format,
    all: function () { return load(); },
    // a seam for the tests: forget what was read so storage is re-read
    reload: function () { marks = null; return load(); }
  };
})(typeof window !== 'undefined' ? window : globalThis);
