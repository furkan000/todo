/* "Working on it" — a third checkbox state.

   `- [>] task` is the arrow pointing at what you are doing right now. It lives
   in the checkbox rather than trailing the line, so it cannot contradict
   itself: a task is open, in flight, or done, never two of those at once. It
   also means every part of the app that already reads the box — filters,
   archiving, the subtask cascade — sees the state without a new tag to learn. */
(function (global) {
  'use strict';

  var MARK = '>';
  var BOX = /\[([ xX>])\]/;

  function set(text, lineNo, on) {
    var lines = String(text).split('\n');
    if (lines[lineNo] === undefined || !BOX.test(lines[lineNo])) return null;
    lines[lineNo] = lines[lineNo].replace(BOX, on ? '[' + MARK + ']' : '[ ]');
    return lines.join('\n');
  }

  // Starting work on something finished reopens it — that is what picking it
  // back up means.
  function toggle(text, lineNo) {
    var lines = String(text).split('\n');
    var m = lines[lineNo] === undefined ? null : BOX.exec(lines[lineNo]);
    if (!m) return null;
    return set(text, lineNo, m[1] !== MARK);
  }

  function clear(text) {
    return String(text).split('\n').map(function (l) {
      return l.replace(BOX, function (whole, c) { return c === MARK ? '[ ]' : whole; });
    }).join('\n');
  }

  function active(doc) {
    return doc.todos.filter(function (t) { return t.active; });
  }

  global.Focus = { MARK: MARK, BOX: BOX, set: set, toggle: toggle, clear: clear, active: active };
})(typeof window !== 'undefined' ? window : globalThis);
