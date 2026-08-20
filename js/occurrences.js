/* Selection echo: select some text and every other copy of it lights up.
   Purely visual and self-contained — it reads the textarea's selection and
   paints its own layer, sharing geometry with the other layers via Overlay. */
(function (global) {
  'use strict';

  var MIN_LEN = 2;          // a single character lights up half the document
  var MAX_LEN = 200;
  var MAX_TEXT = 150000;    // same ceiling the highlighter uses
  var MAX_MARKS = 500;

  var ed = null, layer = null, queued = false;
  var current = { query: '', count: 0 };

  function init(editor, layerEl) {
    ed = editor;
    layer = layerEl;
    global.Overlay.register(ed, layer);

    ['select', 'keyup', 'mouseup', 'input', 'focus'].forEach(function (evt) {
      ed.addEventListener(evt, schedule);
    });
    ed.addEventListener('blur', clear);
    // fires for textarea selections in current browsers; the events above cover the rest
    document.addEventListener('selectionchange', function () {
      if (document.activeElement === ed) schedule();
    });
  }

  // selection events arrive in bursts; one repaint per frame is plenty
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () {
      queued = false;
      refresh();
    });
  }

  function selection() {
    if (!ed || document.activeElement !== ed) return null;
    var a = ed.selectionStart, b = ed.selectionEnd;
    if (a === b) return null;
    var text = ed.value.slice(a, b);
    if (text.length < MIN_LEN || text.length > MAX_LEN) return null;
    if (/[\r\n]/.test(text)) return null;      // a multi-line selection is a range, not a word
    if (!text.trim()) return null;
    return { start: a, end: b, text: text };
  }

  function refresh() {
    if (!layer) return;
    var sel = selection();
    if (!sel || ed.value.length > MAX_TEXT) return clear();

    // exact, case-sensitive matching — the way editors echo a selection
    var text = ed.value, hits = [], at = 0, i;
    while ((i = text.indexOf(sel.text, at)) !== -1 && hits.length < MAX_MARKS) {
      hits.push(i);
      at = i + sel.text.length;
    }

    // the selection itself is already visible; only its siblings need marking
    var others = hits.filter(function (start) { return start !== sel.start; });
    current = { query: sel.text, count: others.length };
    if (!others.length) return paint([]);
    paint(others.map(function (start) { return [start, start + sel.text.length]; }));
  }

  function clear() {
    current = { query: '', count: 0 };
    if (layer) layer.innerHTML = '';
  }

  function esc(t) {
    return t.replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; });
  }

  function paint(ranges) {
    var text = ed.value, out = '', at = 0;
    ranges.forEach(function (r) {
      out += esc(text.slice(at, r[0])) + '<mark class="occ">' + esc(text.slice(r[0], r[1])) + '</mark>';
      at = r[1];
    });
    layer.innerHTML = out + esc(text.slice(at)) + '\n';
    global.Overlay.sync();
  }

  global.Occurrences = {
    init: init, refresh: refresh, clear: clear,
    state: function () { return { query: current.query, count: current.count }; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
