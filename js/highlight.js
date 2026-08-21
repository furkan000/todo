/* Syntax highlighting for the source text.
   It paints from the parse result, not from its own regexes — so the colours
   show exactly what the parser understood. A tag that does not light up is a
   tag that will not become a column. */
(function (global) {
  'use strict';

  var TT = global.TT;
  var MAX_CHARS = 150000;          // beyond this, plain text stays faster than pretty
  var ed = null, layer = null, wrap = null;

  function init(editor, layerEl, wrapEl) {
    ed = editor;
    layer = layerEl;
    wrap = wrapEl;
    global.Overlay.register(ed, layer);
  }

  function paint(doc) {
    if (!layer) return;
    if (ed.value.length > MAX_CHARS) {
      wrap.classList.remove('hl-on');
      layer.innerHTML = '';
      return;
    }
    wrap.classList.add('hl-on');
    // the trailing newline keeps the final line scrollable in step with the textarea
    layer.innerHTML = doc.lines.map(line).join('\n') + '\n';
    global.Overlay.sync();
  }

  function esc(t) {
    return t.replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; });
  }

  function line(ln) {
    // text is always a suffix of raw, so the prefix is the marker or hashes
    var prefixLen = ln.raw.length - ln.text.length;
    var prefix = ln.raw.slice(0, prefixLen);
    var body = tokens(ln);

    if (ln.kind === 'heading') {
      return '<span class="hl-hash">' + esc(prefix) + '</span><span class="hl-head">' + body + '</span>';
    }
    if (ln.kind === 'todo') {
      var state = ln.done ? ' done' : ln.order ? ' active ranked' : ln.active ? ' active' : '';
      var mark = '<span class="hl-mark' + state + '">' + esc(prefix) + '</span>';
      return mark + (ln.done ? '<span class="hl-done">' + body + '</span>'
                   : ln.active ? '<span class="hl-now">' + body + '</span>' : body);
    }
    if (ln.kind === 'bullet') {
      return '<span class="hl-mark">' + esc(prefix) + '</span>' + body;
    }
    return body;
  }

  // Wrap each token in place; everything between tokens is left alone.
  function tokens(ln) {
    var text = ln.text, out = '', at = 0;
    ln.tokens.forEach(function (t) {
      out += plain(text.slice(at, t.start));
      out += '<span class="' + cls(t) + '">' + esc(text.slice(t.start, t.end)) + '</span>';
      at = t.end;
    });
    return out + plain(text.slice(at));
  }

  // inline code is the one non-tag thing worth marking: it is literal to the parser
  function plain(s) {
    return esc(s).replace(/`[^`]*`/g, function (m) { return '<span class="hl-code">' + m + '</span>'; });
  }

  function cls(t) {
    if (t.kind === 'date') {
      return TT.parseDate(t.name) ? 'hl-date' : 'hl-date bad';
    }
    if (t.kind === 'bool') return 'hl-bool';
    if (t.kind === 'bare' && !t.resolved) return 'hl-label';

    var ns = t.kind === 'select' ? TT.key(t.ns) : t.resolved.ns;
    var val = t.kind === 'select' ? t.value : t.resolved.value;
    if (ns === 'priority') return 'hl-prio prio-' + (TT.canonicalPriority(val) || 'x');
    return 'hl-sel ns-h-' + hue(ns) + (t.kind === 'bare' ? ' taught' : '');
  }

  // same palette the chips use, so a namespace keeps one colour everywhere
  function hue(ns) {
    var h = 0, s = String(ns);
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    return [212, 268, 158, 24, 340, 190, 48, 120][h % 8];
  }

  global.Highlight = { init: init, paint: paint };
})(typeof window !== 'undefined' ? window : globalThis);
