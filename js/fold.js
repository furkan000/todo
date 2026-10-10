/* Folding the Done section out of the text.

   Archive moves finished todos to a `# Done` section at the end. That section
   only grows, and in the editor it is mostly something to scroll past. Folded,
   it is taken out of the textarea and held here, and a bar under the editor
   says it is there; unfolded, it is ordinary text again. Folded is how it
   starts, and opening it is remembered.

   This bends the app's one rule — the textarea is the whole text — so every
   reader of "the text" asks for it whole: the editor's content and the folded
   part after it (`full`), and every write goes back through `take`, which
   splits the whole text again and hands the editor its part. Only the end can
   fold, and only a `# Done` with no other top-level heading after it, so the
   two parts are always joined by plain concatenation and line numbers in the
   editor are line numbers in the text.

   Ctrl+Z only knows the textarea. So the fold remembers which folded part
   went with which editor content, and when an undo brings back an earlier
   content it brings back the folded part that belonged to it: undoing an
   archive puts the todos back in place *and* takes them out of Done, rather
   than leaving a copy in each. */
(function (global) {
  'use strict';

  var DONE = /^#\s+Done\s*$/;
  var TOP = /^#\s/;
  var MEMORY = 60;

  var hidden = '';            // the folded part, '' when nothing is folded
  var folded = true;          // the choice: fold when there is something to fold
  var memory = [];            // [editor content, folded part], newest last

  // The Done section at the end of `text`, if there is one to fold.
  // `visible + hidden === text`; the folded part starts with the newline
  // before `# Done`, so the editor's last line is the last line above it.
  function split(text) {
    var lines = String(text).split('\n'), at = -1;
    for (var i = lines.length - 1; i >= 0; i--) {
      if (DONE.test(lines[i])) { at = i; break; }
      if (TOP.test(lines[i])) return null;      // another top-level heading after it
    }
    if (at <= 0) return null;                   // none, or nothing above it to show
    var cut = lines.slice(0, at).join('\n').length;
    return { visible: text.slice(0, cut), hidden: text.slice(cut) };
  }

  function remember(visible) {
    for (var i = 0; i < memory.length; i++) {
      if (memory[i][0] === visible) { memory.splice(i, 1); break; }
    }
    memory.push([visible, hidden]);
    if (memory.length > MEMORY) memory.shift();
  }

  // The whole text, given what the editor holds
  function full(visible) { return visible + hidden; }

  // The whole text in, the editor's part out. `before` is what the editor
  // holds now, remembered with the folded part that goes with it.
  function take(text, before) {
    if (before !== undefined) remember(before);
    var s = folded ? split(text) : null;
    hidden = s ? s.hidden : '';
    var visible = s ? s.visible : text;
    remember(visible);
    return visible;
  }

  // The editor changed by itself — typing, or an undo. An undo that lands on
  // a content written earlier takes back the folded part it had then.
  function input(visible) {
    for (var i = memory.length - 1; i >= 0; i--) {
      if (memory[i][0] === visible) { hidden = memory[i][1]; return true; }
    }
    return false;
  }

  // How many finished todos are folded away, for the bar
  function count() {
    return hidden.split('\n').filter(function (l) { return /^\s*[-*+]\s+\[[xX]\]/.test(l); }).length;
  }

  global.Fold = {
    split: split, full: full, take: take, input: input, count: count,
    hidden: function () { return hidden; },
    active: function () { return hidden !== ''; },
    folded: function () { return folded; },
    setFolded: function (on) { folded = !!on; },
    // something to fold, whether or not it is folded now
    foldable: function (text) { return !!split(text); },
    reset: function () { hidden = ''; memory = []; folded = true; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
