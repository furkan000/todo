/* Find & replace over the source text.
   Self-contained: it owns its panel and listeners, and writes back through the
   host's setText so the app stays the single writer of the document. */
(function (global) {
  'use strict';

  var cfg = null;
  var els = {};
  var matches = [];
  var index = -1;
  var bad = false;

  var IDS = {
    panel: 'find', q: 'find-q', r: 'find-r', count: 'find-count',
    matchCase: 'find-case', wholeWord: 'find-word', regex: 'find-re',
    marks: 'find-marks'
  };

  function init(options) {
    cfg = options;
    Object.keys(IDS).forEach(function (k) { els[k] = document.getElementById(IDS[k]); });

    els.q.addEventListener('input', function () { refresh(true); });
    [els.matchCase, els.wholeWord, els.regex].forEach(function (c) {
      c.addEventListener('change', function () { refresh(true); els.q.focus(); });
    });

    els.q.addEventListener('keydown', function (e) { onFieldKey(e, 'find'); });
    els.r.addEventListener('keydown', function (e) { onFieldKey(e, 'replace'); });

    // keep the overlay aligned with whatever the textarea is doing
    cfg.editor.addEventListener('scroll', syncMarks);
    cfg.editor.addEventListener('input', function () { if (isOpen()) refresh(false); });
    window.addEventListener('resize', function () { if (isOpen()) syncMarks(); });

    els.panel.addEventListener('click', function (e) {
      var b = e.target.closest('[data-find]');
      if (!b) return;
      var act = b.dataset.find;
      if (act === 'next') go(1);
      else if (act === 'prev') go(-1);
      else if (act === 'one') replaceOne();
      else if (act === 'all') replaceAll();
      else if (act === 'close') close();
    });
  }

  function onFieldKey(e, field) {
    if (e.key === 'Escape') { e.preventDefault(); return close(); }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (field === 'replace') return replaceOne();
    go(e.shiftKey ? -1 : 1);
  }

  function isOpen() { return !els.panel.hidden; }

  function open() {
    if (cfg.ensureVisible) cfg.ensureVisible();
    els.panel.hidden = false;
    // seed from a one-line selection, the way editors do
    var ed = cfg.editor;
    var sel = ed.value.slice(ed.selectionStart, ed.selectionEnd);
    if (sel && sel.indexOf('\n') === -1) els.q.value = sel;
    refresh(true);
    els.q.focus();
    els.q.select();
  }

  function close() {
    els.panel.hidden = true;
    els.marks.innerHTML = '';
    cfg.editor.focus();
  }

  /* ---------- matching ---------- */
  function pattern(global_) {
    var q = els.q.value;
    if (!q) return null;
    var src = els.regex.checked ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (els.wholeWord.checked) src = '\\b(?:' + src + ')\\b';
    try {
      return new RegExp(src, (global_ ? 'g' : '') + (els.matchCase.checked ? '' : 'i'));
    } catch (e) {
      return 'bad';
    }
  }

  function collect() {
    matches = [];
    bad = false;
    var re = pattern(true);
    if (!re) return;
    if (re === 'bad') { bad = true; return; }

    var text = cfg.editor.value, m, guard = 0;
    while ((m = re.exec(text)) !== null && guard++ < 20000) {
      matches.push([m.index, m.index + m[0].length]);
      if (m[0] === '') re.lastIndex++;          // never spin on a zero-length match
    }
  }

  // fromCaret: jump to the first match at or after the caret rather than keeping place
  function refresh(fromCaret) {
    collect();
    if (!matches.length) index = -1;
    else if (fromCaret) {
      var at = cfg.editor.selectionStart;
      index = 0;
      for (var i = 0; i < matches.length; i++) {
        if (matches[i][0] >= at) { index = i; break; }
      }
    } else if (index >= matches.length) index = matches.length - 1;

    paintCount();
    paintMarks();
    if (index >= 0) select();
  }

  function paintCount() {
    els.q.classList.toggle('bad', bad);
    els.count.classList.toggle('bad', bad);
    els.count.textContent = bad ? 'bad pattern'
      : !els.q.value ? ''
      : !matches.length ? 'no matches'
      : (index + 1) + ' of ' + matches.length;
  }

  function select() {
    var m = matches[index];
    if (!m) return;
    var ed = cfg.editor;
    ed.setSelectionRange(m[0], m[1]);
    scrollTo(m[0]);
  }

  function scrollTo(offset) {
    var ed = cfg.editor;
    var line = ed.value.slice(0, offset).split('\n').length - 1;
    var lh = parseFloat(getComputedStyle(ed).lineHeight) || 21;
    var top = line * lh;
    if (top < ed.scrollTop || top > ed.scrollTop + ed.clientHeight - lh * 2) {
      ed.scrollTop = Math.max(0, top - ed.clientHeight / 2);
    }
  }

  function go(delta) {
    collect();
    if (!matches.length) { paintCount(); paintMarks(); return; }
    index = (index + delta + matches.length) % matches.length;
    paintCount();
    paintMarks();
    select();
  }

  /* ---------- highlight overlay ---------- */
  function esc(t) {
    return t.replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; });
  }

  function paintMarks() {
    if (!isOpen()) { els.marks.innerHTML = ''; return; }
    var text = cfg.editor.value, out = '', at = 0;
    matches.forEach(function (m, i) {
      out += esc(text.slice(at, m[0])) +
        '<mark' + (i === index ? ' class="current"' : '') + '>' + esc(text.slice(m[0], m[1])) + '</mark>';
      at = m[1];
    });
    // the trailing newline keeps the last line scrollable in step with the textarea
    els.marks.innerHTML = out + esc(text.slice(at)) + '\n';
    syncMarks();
  }

  // mirror the textarea's box exactly, whatever the layout is doing to it
  function syncMarks() {
    if (!isOpen()) return;
    var ed = cfg.editor, m = els.marks, cs = getComputedStyle(ed);
    m.style.fontFamily = cs.fontFamily;
    m.style.fontSize = cs.fontSize;
    m.style.lineHeight = cs.lineHeight;
    m.style.letterSpacing = cs.letterSpacing;
    m.style.tabSize = cs.tabSize;
    m.style.padding = cs.padding;
    m.style.width = ed.clientWidth + 'px';
    m.scrollTop = ed.scrollTop;
  }

  /* ---------- replacing ---------- */
  // $1 style backreferences only make sense in regex mode; elsewhere it is literal
  function expand(matched) {
    var rep = els.r.value;
    if (!els.regex.checked) return rep;
    var re = pattern(false);
    return re === 'bad' || !re ? rep : matched.replace(re, rep);
  }

  function replaceOne() {
    collect();
    if (bad || !matches.length) return paintCount();
    if (index < 0 || index >= matches.length) index = 0;

    var m = matches[index];
    var text = cfg.editor.value;
    var rep = expand(text.slice(m[0], m[1]));
    cfg.setText(text.slice(0, m[0]) + rep + text.slice(m[1]), m[0] + rep.length);

    // land on the first match after what we just wrote
    collect();
    var after = m[0] + rep.length;
    index = -1;
    for (var i = 0; i < matches.length; i++) {
      if (matches[i][0] >= after) { index = i; break; }
    }
    if (index === -1 && matches.length) index = 0;
    paintCount();
    paintMarks();
    if (index >= 0) select();
  }

  function replaceAll() {
    collect();
    if (bad || !matches.length) return paintCount();

    var n = matches.length;
    var re = pattern(true);
    var rep = els.r.value;
    var out = els.regex.checked
      ? cfg.editor.value.replace(re, rep)
      : cfg.editor.value.replace(re, function () { return rep; });

    cfg.setText(out, 0);
    refresh(true);
    if (cfg.flash) cfg.flash('Replaced ' + n + ' occurrence' + (n === 1 ? '' : 's'));
  }

  global.Find = {
    init: init, open: open, close: close, isOpen: isOpen,
    state: function () { return { matches: matches.slice(), index: index, bad: bad }; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
