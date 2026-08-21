/* Whole-line editing for the source textarea: move lines with Alt+Up/Down, and
   cut the current line with Ctrl+X when nothing is selected.

   Each operation is worked out as one contiguous span to replace, so the caller
   can push it through execCommand and keep the browser's own undo stack — a
   line you moved by mistake has to be one Ctrl+Z away. */
(function (global) {
  'use strict';

  function lineStart(text, pos) { return text.lastIndexOf('\n', pos - 1) + 1; }
  function lineEnd(text, pos) {
    var i = text.indexOf('\n', pos);
    return i === -1 ? text.length : i;
  }

  // Swap the selected line (or lines) with its neighbour. Returns the span to
  // replace and where the selection should land, or null at the ends of the
  // document where there is nothing to swap with.
  function move(text, selStart, selEnd, dir) {
    text = String(text);
    var a = lineStart(text, selStart);
    var b = lineEnd(text, selEnd);
    var block = text.slice(a, b);

    if (dir < 0) {
      if (a === 0) return null;
      var prevStart = lineStart(text, a - 1);
      var prev = text.slice(prevStart, a - 1);
      return {
        from: prevStart, to: b, text: block + '\n' + prev,
        start: prevStart, end: prevStart + block.length
      };
    }
    if (b >= text.length) return null;
    var nextEnd = lineEnd(text, b + 1);
    var next = text.slice(b + 1, nextEnd);
    var at = a + next.length + 1;
    return {
      from: a, to: nextEnd, text: next + '\n' + block,
      start: at, end: at + block.length
    };
  }

  // The whole line, newline included, so pasting it back puts a line back
  // rather than splicing text into whatever line the caret is on.
  function cutLine(text, pos) {
    text = String(text);
    var a = lineStart(text, pos), b = lineEnd(text, pos);
    var content = text.slice(a, b);
    var from = a, to = b;
    if (b < text.length) to = b + 1;             // take the newline after it
    else if (a > 0) from = a - 1;                // last line: take the one before it
    return { from: from, to: to, cut: content + '\n', caret: from };
  }

  global.Lines = { move: move, cutLine: cutLine, lineStart: lineStart, lineEnd: lineEnd };
})(typeof window !== 'undefined' ? window : globalThis);
