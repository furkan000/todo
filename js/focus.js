/* "Working on it" — a third checkbox state, optionally ranked.

   `- [>] task` is the arrow pointing at what you are doing right now, and
   `- [1]`, `- [2]`, `- [3]` say the same thing in an order. Both live in the
   checkbox rather than trailing the line, so the state cannot contradict
   itself — a task is open, in flight, or done, never two of those at once —
   and every marker stays one character wide, which keeps the raw text in
   column. Everything that already reads the box sees the state without a new
   tag to learn. */
(function (global) {
  'use strict';

  var MARK = '>';
  var BOX = /\[([ xX>1-9])\]/;
  var MAX_RANK = 9;

  function boxOf(line) {
    var m = line === undefined ? null : BOX.exec(line);
    return m ? m[1] : null;
  }

  function write(text, lineNo, ch) {
    var lines = String(text).split('\n');
    if (boxOf(lines[lineNo]) === null) return null;
    lines[lineNo] = lines[lineNo].replace(BOX, '[' + ch + ']');
    return lines.join('\n');
  }

  // Starting work on something finished reopens it — that is what picking it
  // back up means.
  function toggle(text, lineNo) {
    var box = boxOf(String(text).split('\n')[lineNo]);
    if (box === null) return null;
    return write(text, lineNo, box === ' ' || box === 'x' || box === 'X' ? MARK : ' ');
  }

  function set(text, lineNo, on) {
    return write(text, lineNo, on ? MARK : ' ');
  }

  // The rank control walks – → 1 → 2 … → 9 → –. Ranking something that was not
  // in flight puts it in flight; dropping the rank leaves it there, unnumbered,
  // because losing your place in the queue is not the same as stopping work.
  function cycleRank(text, lineNo) {
    var box = boxOf(String(text).split('\n')[lineNo]);
    if (box === null) return null;
    var n = box >= '1' && box <= '9' ? +box : 0;
    var next = n + 1;
    return write(text, lineNo, next > MAX_RANK ? MARK : String(next));
  }

  function rank(text, lineNo, n) {
    if (!n) return write(text, lineNo, MARK);
    if (n < 1 || n > MAX_RANK) return null;
    return write(text, lineNo, String(n));
  }

  function clear(text) {
    return String(text).split('\n').map(function (l) {
      return l.replace(BOX, function (whole, c) { return c === ' ' || c === 'x' || c === 'X' ? whole : '[ ]'; });
    }).join('\n');
  }

  function active(doc) {
    return doc.todos.filter(function (t) { return t.active; });
  }

  // The queue: numbered work first in its own order, then the rest of what is
  // in flight in the order the document has it.
  function queue(todos) {
    return todos.filter(function (t) { return t.active; }).sort(function (a, b) {
      if (a.order && b.order && a.order !== b.order) return a.order - b.order;
      if (a.order && !b.order) return -1;
      if (b.order && !a.order) return 1;
      return a.line - b.line;
    });
  }

  global.Focus = {
    MARK: MARK, BOX: BOX, MAX_RANK: MAX_RANK,
    set: set, toggle: toggle, rank: rank, cycleRank: cycleRank,
    clear: clear, active: active, queue: queue
  };
})(typeof window !== 'undefined' ? window : globalThis);
