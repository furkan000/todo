/* The day a todo was finished, written into the line itself.

   No new syntax was needed: a completion date is an ordinary namespaced select,
   `#done:2026-08-26`, so the parser already reads it, the table already gives it
   a column, the Tags view already lists it, and clicking one already filters by
   the day. The log keeps the same fact with the time attached; this is the half
   that belongs to the text, and it travels with the line — through an export,
   through an archive, into any other editor you open the file in.

   Adding is bound to the moment a todo is finished, exactly like the log:
   opening a file full of finished work must not date all of it today. Removing
   is not bound to anything, because an open todo wearing a completion date is
   simply wrong, however it came to. */
(function (global) {
  'use strict';

  var KEY = 'ptt.donedate.v1';
  var NS = 'done';

  var HAS = /#done:\d{4}-\d{2}-\d{2}\b/;
  var STRIP = /[ \t]*#done:\d{4}-\d{2}-\d{2}\b/g;

  var on = true;   // he asked for it; the cog is where it goes away again

  function init() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw !== null) on = raw === '1';
    } catch (e) {}
    return on;
  }

  function enabled() { return on; }

  function setEnabled(v) {
    on = !!v;
    try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (e) {}
    return on;
  }

  function tag(iso) { return '#' + NS + ':' + iso; }
  function stamped(raw) { return HAS.test(raw); }

  // Read the date back off a line, for anything that would rather ask than parse
  function dateOf(raw) {
    var m = /#done:(\d{4}-\d{2}-\d{2})\b/.exec(String(raw));
    return m ? m[1] : null;
  }

  /* The whole document's stamps, reconciled in one pass. `finished` is what the
     log just saw being ticked off — the only todos allowed to gain a date.
     Returns the new text, or null when nothing needed changing, so the caller
     can leave the editor alone rather than rewrite it with itself. */
  function sync(text, doc, finished, iso) {
    if (!on) return null;
    var lines = String(text).split('\n');
    var justDone = {}, changed = false;
    (finished || []).forEach(function (t) { justDone[t.line] = true; });

    doc.todos.forEach(function (t) {
      var raw = lines[t.line];
      if (raw === undefined) return;
      if (t.done) {
        if (!justDone[t.line] || stamped(raw)) return;
        lines[t.line] = raw + (/\s$/.test(raw) ? '' : ' ') + tag(iso);
        changed = true;
      } else if (stamped(raw)) {
        lines[t.line] = raw.replace(STRIP, '');
        changed = true;
      }
    });
    return changed ? lines.join('\n') : null;
  }

  global.DoneDate = {
    init: init, enabled: enabled, setEnabled: setEnabled,
    sync: sync, tag: tag, stamped: stamped, dateOf: dateOf, NS: NS
  };
})(typeof window !== 'undefined' ? window : globalThis);
