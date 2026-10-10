/* Everything as one file, and back.

   The export is every key the app keeps — the todo text, the activity log,
   every day of notes and of the work log, the reminders, the settings, the
   music catalogue, the timer — written into one JSON file exactly as stored.
   Nothing is converted, so nothing can be lost on the way out.

   The same file, given to "restore…" beside it, restores it: every key in it
   is written back, then the page reloads so every module reads its part afresh.
   Keys that are not in the file are left alone, so a day of notes written
   after the backup survives restoring it. */
(function (global) {
  'use strict';

  var FORMAT = 'plain-text-todo-backup';

  // What counts: everything under ptt., except this browser's own hints
  // (ptt.u.<name>.theme), which belong to the browser, not the record
  function keys() {
    return Store.keys('ptt.').filter(function (k) { return k.indexOf('ptt.u.') !== 0; });
  }

  function collect(now) {
    var out = {};
    keys().forEach(function (k) {
      var v = Store.getItem(k);
      if (v !== null) out[k] = v;
    });
    return {
      format: FORMAT, version: 1,
      exportedAt: (now || new Date()).toISOString(),
      name: Store.user() || null,
      keys: out
    };
  }

  function toJSON(now) { return JSON.stringify(collect(now), null, 2); }

  function fileName(now) {
    var d = TT.isoOf(now || new Date());
    return 'plain-text-todo' + (Store.user() ? '-' + Store.user() : '') + '-' + d + '.json';
  }

  function isBackup(data) {
    return !!data && data.format === FORMAT && data.keys && typeof data.keys === 'object';
  }

  // A short account of what is in a file, for the question before restoring it
  function describe(data) {
    var ks = Object.keys(data.keys || {});
    var notes = ks.filter(function (k) { return /^ptt\.note\.\d{8}$/.test(k); }).length;
    var work = ks.filter(function (k) { return /^ptt\.work\.\d{8}$/.test(k); }).length;
    return (data.exportedAt ? 'taken ' + data.exportedAt.slice(0, 16).replace('T', ' ') + ', ' : '') +
      'with the todo text' + (notes ? ', ' + notes + ' day' + (notes === 1 ? '' : 's') + ' of notes' : '') +
      (work ? ', ' + work + ' day' + (work === 1 ? '' : 's') + ' of work log' : '') + ' and the settings';
  }

  // Write every key back, then call `done` once the server has all of it —
  // reloading before that would drop what is still on its way
  function restore(data, done) {
    Object.keys(data.keys).forEach(function (k) {
      if (!/^ptt\.[a-z0-9]+(\.[a-z0-9]+)*$/.test(k) || k.indexOf('ptt.u.') === 0) return;
      if (typeof data.keys[k] !== 'string') return;
      try { Store.setItem(k, data.keys[k]); } catch (e) {}
    });
    Store.flush();
    var waited = 0;
    (function wait() {
      var s = Store.status();
      if (s === 'local' || s === 'saved' || waited > 15000) return done && done(s);
      waited += 100;
      setTimeout(wait, 100);
    })();
  }

  /* ---------- restoring from a file ---------- */

  var opts = {}, input = null;

  // Asks first, saying what is in the file, then writes it and reloads.
  // Returns false when it did not go ahead.
  function restoreText(name, raw) {
    var data = null;
    try { data = JSON.parse(raw); } catch (e) {}
    if (!isBackup(data)) {
      global.alert(name + ' is not a file made by Export everything.');
      return false;
    }
    if (!global.confirm('Restore everything from ' + name + '?\n\nIt was ' + describe(data) +
        '. What is in the file replaces what is here now; anything not in it is left as it is.')) return false;
    if (opts.before) opts.before();   // a save still pending must not land on top of it
    if (global.Log && Log.suppress) Log.suppress();
    if (opts.flash) opts.flash('Restoring…');
    restore(data, function (status) {
      if (status !== 'saved' && status !== 'local') {
        if (opts.flash) opts.flash('Restored here, but the server has not confirmed it yet');
        return;
      }
      if (opts.reload !== false) global.location.reload();
    });
    return true;
  }

  function pick() {
    if (!input) {
      input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.hidden = true;
      document.body.appendChild(input);
      input.addEventListener('change', function () {
        var f = input.files && input.files[0];
        if (!f) return;
        var r = new FileReader();
        r.onload = function () { restoreText(f.name, String(r.result)); };
        r.readAsText(f);
        input.value = '';
      });
    }
    input.click();
  }

  global.Backup = {
    FORMAT: FORMAT, keys: keys, collect: collect, toJSON: toJSON, fileName: fileName,
    isBackup: isBackup, describe: describe, restore: restore,
    init: function (o) { opts = o || {}; },
    pick: pick, restoreText: restoreText
  };
})(typeof window !== 'undefined' ? window : globalThis);
