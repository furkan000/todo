/* App wiring. The textarea is the single source of truth; every view is a
   projection of it, and every interaction edits the text back. */
(function () {
  'use strict';
  var TT = window.TT, Views = window.Views;
  var STORE = 'ptt.doc.v1', PREFS = 'ptt.prefs.v1';

  var els = {};
  var state = {
    view: 'doc',
    filter: 'all',
    query: '',
    sort: { col: null, dir: null },   // null = the order the text is written in
    group: true,             // table view: one table per heading
    split: 40,               // editor width in split mode, as a % of the pane row
    month: new Date(),
    layout: 'split',         // 'text' | 'split' | 'view'
    theme: 'auto'            // 'auto' | 'light' | 'dark'
  };
  var doc = null, saveTimer = null;

  /* ---------- boot ---------- */
  function init() {
    ['editor', 'stage', 'search', 'stats', 'app', 'file', 'status-tools', 'resizer', 'panes'].forEach(function (id) {
      els[id.replace(/-(\w)/g, function (_, c) { return c.toUpperCase(); })] = document.getElementById(id);
    });
    var saved = null;
    try { saved = Store.getItem(STORE); } catch (e) {}
    // the text is the one thing two devices must never silently overwrite
    Store.guard(STORE);
    Store.settle(saveNow);
    Store.onremote(onRemote);
    Store.mount(document.getElementById('sync-slot'));
    Log.init();
    DoneDate.init();
    Notes.init({ vocab: function () { return doc && doc.vocab; } });
    // when a staged removal's grace runs out, the page saying so is stale
    Undo.onchange(function () { if (state.view === 'log') render(); });
    els.editor.value = saved === null ? SAMPLE : saved;
    try {
      var p = JSON.parse(Store.getItem(PREFS) || '{}');
      // the table used to sort by due date out of the box; one-time, drop that
      // stored choice so the new default — document order — actually shows up
      if (p.sortV !== 2) delete p.sort;
      ['view', 'filter', 'sort', 'layout', 'theme', 'group', 'split'].forEach(function (k) { if (p[k] !== undefined) state[k] = p[k]; });
    } catch (e) {}

    els.editor.addEventListener('input', function () { if (typing) return; queueSave(); render(); });
    els.editor.addEventListener('keydown', onEditorKey);
    els.editor.addEventListener('cut', onCut);
    els.search.addEventListener('input', function () { state.query = els.search.value; render(); });
    document.addEventListener('click', onClick);
    document.addEventListener('change', onChange);
    document.addEventListener('keydown', onKey);
    els.file.addEventListener('change', onFile);
    applyLayout();
    applyTheme();
    watchSystemTheme();
    applySplit();
    initResizer();
    Highlight.init(els.editor, document.getElementById('syntax-layer'),
                   document.getElementById('editor-wrap'));
    Occurrences.init(els.editor, document.getElementById('occ-marks'));
    Find.init({
      editor: els.editor,
      setText: setText,
      flash: flash,
      ensureVisible: function () { if (state.layout === 'view') setLayout('split'); }
    });
    Music.init({
      // the catalogue is a projection like any other view, so a change to it is
      // just another render; the status bar transport repaints itself
      refresh: function () { if (state.view === 'music') render(); },
      show: showView
    });
    Pomodoro.init({
      mount: document.querySelector('.statusbar'),
      before: document.getElementById('pomo-slot'),
      // whatever you have marked as in flight is what the session is spent on
      taskOf: function () {
        var q = doc ? Focus.queue(doc.todos) : [];
        return q.length ? q[0].title : '';
      },
      onFinish: function (phase, s) {
        flash(phase === 'work'
          ? 'Focus session done' + (s.task ? ' — ' + s.task : '') + ' · take ' + s.cfg[s.phase] + ' min'
          : 'Break over — back to it');
        render();
      }
    });
    render();
    rememberTheme();
    if (Store.seeded()) flash('Started “' + Store.user() + '” from what this browser had');
  }

  // The server could not be asked for the record. Starting anyway would show
  // the sample, and the first keystroke would save it over the real text.
  function unreachable() {
    document.getElementById('editor').disabled = true;
    document.getElementById('stage').innerHTML =
      '<div class="empty"><b>The server did not answer.</b>' +
      '<span>Nothing was loaded for “' + Views.esc(Store.user()) + '”, so nothing is shown and nothing will be saved.</span>' +
      '<button class="link" onclick="location.reload()">Try again</button></div>';
  }

  function queueSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 250);
  }
  // Also what Store calls before it sends or compares anything, so text typed
  // in the last quarter second is never mistaken for text that was not edited.
  function saveNow() {
    if (saveTimer === null) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    try { Store.setItem(STORE, els.editor.value); } catch (e) {}
  }

  // Another device changed something under this name. The text and the log are
  // taken in where they stand; the rest is read again the next time the page
  // loads, which is when those modules read anything.
  function onRemote(keys) {
    if (keys.indexOf('ptt.log.v1') !== -1) Log.init();
    Notes.onRemote(keys);
    if (keys.indexOf(STORE) !== -1) {
      var next = Store.getItem(STORE);
      if (next !== null && next !== els.editor.value) {
        Log.suppress();   // it was finished over there, and logged over there
        // an edit like any other: Ctrl+Z takes it back, and keeps working past it
        var sel = Math.min(els.editor.selectionStart, next.length);
        if (!writeKeepingUndo(next, sel, sel) && els.editor.value !== next) assign(next, sel, sel);
        flash('Updated from another device');
      }
    }
    render();
  }

  // The theme is resolved before first paint, which is before the server has
  // been asked anything — so this browser keeps its own note of it per name.
  function rememberTheme() {
    if (!Store.user()) return;
    try { localStorage.setItem('ptt.u.' + Store.user() + '.theme', state.theme); } catch (e) {}
  }

  function savePrefs() {
    rememberTheme();
    try {
      Store.setItem(PREFS, JSON.stringify({
        view: state.view, filter: state.filter, sort: state.sort,
        layout: state.layout, theme: state.theme, group: state.group,
        split: state.split, sortV: 2
      }));
    } catch (e) {}
  }

  /* ---------- filtering ---------- */
  function haystack(t) {
    var parts = [t.title];
    t.tokens.forEach(function (tk) {
      parts.push(tk.raw);
      if (tk.kind === 'select') parts.push('#' + TT.key(tk.ns) + ':' + tk.value);
      if (tk.kind === 'bare' && tk.resolved) parts.push('#' + tk.resolved.ns + ':' + tk.resolved.value);
    });
    if (t.due) parts.push(t.due);
    return parts.join(' ').toLowerCase();
  }

  function visibleTodos() {
    var q = state.query.trim().toLowerCase();
    return doc.todos.filter(function (t) {
      if (state.filter === 'now' && !t.active) return false;
      if (state.filter === 'open' && t.done) return false;
      if (state.filter === 'done' && !t.done) return false;
      return !q || haystack(t).indexOf(q) !== -1;
    });
  }

  /* ---------- render ---------- */
  function render() {
    var now = new Date();
    doc = Subtasks.build(TT.parseDocument(els.editor.value, now));
    var ctx = {
      today: now, todayISO: TT.isoOf(now), sort: state.sort,
      month: state.month, visible: visibleTodos(), query: state.query,
      group: state.group, filter: state.filter
    };

    var finished = Log.observe(doc);   // catches open -> done however it happened
    ctx.log = Log.byDay();

    var html = state.view === 'doc' ? Views.document(doc, ctx)
      : state.view === 'table' ? Views.table(doc, ctx)
      : state.view === 'cal' ? Views.calendar(doc, ctx)
      : state.view === 'log' ? Views.log(doc, ctx)
      // the timer and the player own their own markup; the stage gives them room
      : state.view === 'focus' ? Pomodoro.panelHTML()
      : state.view === 'music' ? Music.catalogueHTML()
      : state.view === 'notes' ? null
      : Views.discovery(doc, ctx);
    els.stage.className = 'stage view-' + state.view;
    // the notes keep their own panel, so a note being typed is never redrawn
    if (state.view === 'notes') Notes.mount(els.stage, { query: state.query });
    else els.stage.innerHTML = html;
    if (state.view === 'focus') Pomodoro.step();   // fill the fresh markup now, not in 250ms
    Highlight.paint(doc);
    Occurrences.refresh();

    var onText = state.layout === 'text';
    Array.prototype.forEach.call(document.querySelectorAll('[data-view]'), function (b) {
      b.classList.toggle('on', !onText && b.dataset.view === state.view);
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-filter]'), function (b) {
      b.classList.toggle('on', b.dataset.filter === state.filter);
    });

    var open = doc.todos.filter(function (t) { return !t.done; }).length;
    var overdue = doc.todos.filter(function (t) { return !t.done && t.due && t.due < ctx.todayISO; }).length;
    var inFlight = Focus.active(doc).length;
    var shown = ctx.visible.length;
    els.stats.innerHTML =
      (inFlight ? '<b class="now">' + inFlight + '</b> in progress <span>·</span> ' : '') +
      '<b>' + open + '</b> open <span>·</span> <b>' + (doc.todos.length - open) + '</b> done' +
      (overdue ? ' <span>·</span> <b class="bad">' + overdue + '</b> overdue' : '') +
      ((state.query || state.filter !== 'all') ? ' <span>·</span> showing <b>' + shown + '</b>' : '') +
      ((state.view === 'table' && state.group && shown)
        ? ' <span>·</span> <b>' + Views.sectionCount(ctx.visible) + '</b> sections' : '');
    document.getElementById('clear-search').hidden = !state.query;
    // a search with something in it is in use, so it keeps its box
    els.search.parentNode.classList.toggle('has-q', !!state.query);

    var canArchive = Archive.pending(doc).length;
    var archiveBtn = document.getElementById('archive-btn');
    archiveBtn.hidden = !canArchive;
    archiveBtn.textContent = 'Archive done (' + canArchive + ')';
    archiveBtn.title = 'Move ' + canArchive + ' finished item' + (canArchive === 1 ? '' : 's') +
      ' — with their subtasks — to a Done section at the end, grouped by the section each came from';

    // the table's grouping switch lives down here, where it can't compete with the data
    els.statusTools.innerHTML = state.view !== 'table' ? '' :
      '<span class="lbl">Tables</span>' +
      '<button data-group="1"' + (state.group ? ' class="on"' : '') + '>by section</button>' +
      '<span class="sep">/</span>' +
      '<button data-group="0"' + (state.group ? '' : ' class="on"') + '>one</button>';

    Array.prototype.forEach.call(document.querySelectorAll('[data-donedate]'), function (b) {
      b.classList.toggle('on', (b.dataset.donedate === 'on') === DoneDate.enabled());
    });

    // Last, because it edits the text: the page is already painted, and the
    // write it may make re-renders over the top of it.
    stampDates(finished);
  }

  /* The text's own record of when something was finished. It is written after
     the parse that noticed, rather than by each of the places you can tick a
     box, so the x you type by hand is stamped exactly like the checkbox you
     click. One re-render follows; the second pass sees the todo as already done
     and stops there. */
  var stamping = false;

  function stampDates(finished) {
    if (stamping) return;
    var next = DoneDate.sync(els.editor.value, doc, finished, TT.isoOf(new Date()));
    if (next === null) return;
    stamping = true;
    try { writeStamps(next); } finally { stamping = false; }
  }

  // Stamps only ever land at the end of a line, so a caret keeps its line and
  // column even when the line above it grew.
  function caretAcross(before, after, pos) {
    var head = before.slice(0, pos).split('\n');
    var row = head.length - 1, col = head[row].length;
    var lines = after.split('\n');
    if (row >= lines.length) return after.length;
    var at = 0;
    for (var i = 0; i < row; i++) at += lines[i].length + 1;
    return at + Math.min(col, lines[row].length);
  }

  function writeStamps(next) {
    setText(next, caretAcross(els.editor.value, next, els.editor.selectionStart));
  }

  /* ---------- text mutation ---------- */
  /* Type a string in at the selection, through the editor itself, so the
     browser's own undo stack survives. One call is not one input event: Chrome
     fires two for every line of what it inserts, and each used to be a full
     parse and render of a half-written document — a stamp on a few hundred
     lines froze the page for seconds. The listener is deaf while this runs;
     every caller saves and renders once, itself, when the text is whole. */
  var typing = false;

  function typeInto(str) {
    var ok = false;
    typing = true;
    try { ok = document.execCommand('insertText', false, str); } catch (e) { ok = false; }
    typing = false;
    return ok;
  }

  /* Make the editor hold `next`, as an edit the browser can undo. Assigning to
     `value` empties Chrome's undo history, so every write the app makes —
     ticking a box in any view, a stamp, Tab, a change from another device —
     comes through here instead. Only the span that differs is retyped: a stamp
     is a few characters, and the cost of typing text in grows much faster than
     its length. The editor has to hold focus for that, so it borrows it and
     hands it back. Returns false when it could not (the editor is hidden), and
     the caller assigns, which is the only time history is lost. */
  function writeKeepingUndo(next, selStart, selEnd) {
    var ed = els.editor, was = ed.value;
    if (was === next) { ed.setSelectionRange(selStart, selEnd); return true; }
    var back = document.activeElement, top = ed.scrollTop;
    if (back !== ed) {
      try { ed.focus({ preventScroll: true }); } catch (e) { ed.focus(); }
      if (document.activeElement !== ed) return false;
    }
    var a = 0, z = 0, max = Math.min(was.length, next.length);
    while (a < max && was.charCodeAt(a) === next.charCodeAt(a)) a++;
    while (z < max - a && was.charCodeAt(was.length - 1 - z) === next.charCodeAt(next.length - 1 - z)) z++;
    ed.setSelectionRange(a, was.length - z);
    var ok = typeInto(next.slice(a, next.length - z)) && ed.value === next;
    if (!ok && ed.value !== was) ed.value = next;   // half-applied: finish it plainly
    ed.setSelectionRange(selStart, selEnd);
    ed.scrollTop = top;
    if (back !== ed) {
      // the view may have been redrawn under it; then nobody gets focus, which
      // is where it was — never the editor, or the next keystroke lands in it
      if (back && back.isConnected && back !== document.body) {
        try { back.focus({ preventScroll: true }); } catch (e) { back.focus(); }
      } else ed.blur();
    }
    return ok;
  }

  function assign(next, selStart, selEnd) {
    var top = els.editor.scrollTop;
    els.editor.value = next;
    els.editor.setSelectionRange(selStart, selEnd);
    els.editor.scrollTop = top;
  }

  function setText(next, caret) {
    var sel = Math.min(caret !== undefined ? caret : els.editor.selectionStart, next.length);
    if (!writeKeepingUndo(next, sel, sel) && els.editor.value !== next) assign(next, sel, sel);
    queueSave();
    render();
  }

  // Replace one span through the editor itself, so the browser's own undo stack
  // survives. Everything that rearranges text — moving lines, cutting one —
  // goes through here, because those are exactly the edits you undo.
  function replaceSpan(from, to, str, selStart, selEnd) {
    els.editor.focus();
    els.editor.setSelectionRange(from, to);
    if (!typeInto(str)) {
      var v = els.editor.value;
      els.editor.value = v.slice(0, from) + str + v.slice(to);
    }
    els.editor.setSelectionRange(selStart, selEnd);
    queueSave();
    render();
  }

  // Rewrite the whole document through the editor itself, so the browser's own
  // undo stack survives — assigning to value would throw it away.
  function replaceKeepingUndo(next) {
    els.editor.focus();
    els.editor.setSelectionRange(0, els.editor.value.length);
    if (!typeInto(next)) return setText(next, 0);
    els.editor.setSelectionRange(0, 0);
    queueSave();
    render();
  }

  // Ticking is a statement about a whole subtree, not one line: finishing a task
  // finishes its subtasks, and finishing the last subtask finishes the task.
  function toggleLine(lineNo) {
    var cascaded = Subtasks.toggle(doc, lineNo);
    if (cascaded !== null) return setText(cascaded);
    var lines = els.editor.value.split('\n');
    var raw = lines[lineNo];
    if (raw === undefined) return;
    lines[lineNo] = raw.replace(/\[([ xX>1-9])\]/, function (_, c) { return c === 'x' || c === 'X' ? '[ ]' : '[x]'; });
    setText(lines.join('\n'));
  }

  // Flag the line you are working on right now, wherever you clicked from.
  function markNow(lineNo) {
    var next = Focus.toggle(els.editor.value, lineNo);
    if (next !== null) setText(next);
  }

  function bumpRank(lineNo) {
    var next = Focus.cycleRank(els.editor.value, lineNo);
    if (next !== null) setText(next);
  }

  function gotoLine(lineNo) {
    if (state.layout === 'view') setLayout('split');
    var lines = els.editor.value.split('\n');
    var start = 0;
    for (var i = 0; i < lineNo && i < lines.length; i++) start += lines[i].length + 1;
    var end = start + (lines[lineNo] || '').length;
    els.editor.focus();
    els.editor.setSelectionRange(start, end);
    // rough scroll-to-line for a uniform-line-height textarea
    var lh = parseFloat(getComputedStyle(els.editor).lineHeight) || 21;
    els.editor.scrollTop = Math.max(0, lineNo * lh - els.editor.clientHeight / 2);
  }

  /* ---------- events ---------- */
  function onChange(e) {
    var el = e.target.closest && e.target.closest('[data-toggle]');
    if (el && el.type === 'checkbox') toggleLine(+el.dataset.toggle);
  }

  function onClick(e) {
    var pop = document.getElementById('settings-menu');
    if (pop && !pop.hidden && !e.target.closest('.menu')) closeMenu();
    var el = e.target.closest ? e.target.closest('[data-view],[data-layout],[data-filter],[data-group],[data-sort],[data-q],[data-month],[data-goto],[data-act],[data-now],[data-rank],[data-theme-set],[data-donedate],[data-log-remove],[data-log-undo],.dot[data-toggle]') : null;
    if (!el) return;

    // The log is not the text, so its rows cannot ride the browser's undo stack.
    // They are staged instead: gone at once, and reversible until the grace lapses.
    if (el.dataset.logRemove) { Log.remove(el.dataset.logRemove); return render(); }
    if (el.dataset.logUndo) { Log.restore(el.dataset.logUndo); return render(); }

    if (el.dataset.now !== undefined) { e.preventDefault(); e.stopPropagation(); return markNow(+el.dataset.now); }
    if (el.dataset.rank !== undefined) { e.preventDefault(); e.stopPropagation(); return bumpRank(+el.dataset.rank); }
    if (el.matches('.dot[data-toggle]')) { e.stopPropagation(); return toggleLine(+el.dataset.toggle); }
    if (el.dataset.themeSet) { state.theme = el.dataset.themeSet; applyTheme(); return savePrefs(); }
    if (el.dataset.donedate) { DoneDate.setEnabled(el.dataset.donedate === 'on'); return render(); }
    if (el.dataset.view) return showView(el.dataset.view);
    if (el.dataset.layout) return setLayout(el.dataset.layout);
    if (el.dataset.group) { state.group = el.dataset.group === '1'; savePrefs(); return render(); }
    if (el.dataset.filter) { state.filter = el.dataset.filter; savePrefs(); return render(); }
    if (el.dataset.sort) {
      // ascending, descending, then back to the order you wrote them in
      var col = el.dataset.sort;
      state.sort = state.sort.col !== col ? { col: col, dir: 'asc' }
        : state.sort.dir === 'asc' ? { col: col, dir: 'desc' }
        : { col: null, dir: null };
      savePrefs();
      return render();
    }
    if (el.dataset.month !== undefined) {
      var d = +el.dataset.month;
      state.month = d === 0 ? new Date() : new Date(state.month.getFullYear(), state.month.getMonth() + d, 1);
      return render();
    }
    if (el.dataset.q) {
      var q = el.dataset.q;
      state.query = (state.query.trim().toLowerCase() === q.toLowerCase()) ? '' : q; // click again to clear
      els.search.value = state.query;
      return render();
    }
    if (el.dataset.goto !== undefined) return gotoLine(+el.dataset.goto);
    if (el.dataset.act) return action(el.dataset.act);
  }

  function action(name) {
    if (name === 'search') { els.search.focus(); return els.search.select(); }
    if (name === 'sidebar') return setLayout(state.layout === 'view' ? 'split' : 'view');
    if (name === 'menu') return toggleMenu();
    if (name === 'copy') {
      closeMenu();
      var t = els.editor.value;
      if (navigator.clipboard) navigator.clipboard.writeText(t).then(function () { flash('Copied ' + t.length + ' characters'); });
      else { els.editor.select(); document.execCommand('copy'); flash('Copied'); }
      return;
    }
    if (name === 'export-md') return closeMenu(), save('todo.md', 'text/markdown', els.editor.value);
    if (name === 'export-json') return closeMenu(), save('todo.json', 'application/json', toJSON());
    if (name === 'export-csv') return closeMenu(), save('todo.csv', 'text/csv', toCSV());
    if (name === 'log-md') return closeMenu(), save('activity-log.md', 'text/markdown', Log.toMarkdown());
    if (name === 'log-csv') return closeMenu(), save('activity-log.csv', 'text/csv', Log.toCSV());
    if (name === 'clear-log') {
      if (!confirm('Clear the whole activity log? The entries cannot be recovered.')) return;
      Log.clear();
      return render();
    }
    if (name === 'import') return closeMenu(), els.file.click();
    if (name === 'archive') {
      var moved = Archive.pending(doc).length;
      var next = Archive.apply(doc);
      if (!next) return flash('Nothing to archive');
      replaceKeepingUndo(next);
      return flash('Archived ' + moved + ' todo' + (moved === 1 ? '' : 's') + ' — undo with Ctrl+Z');
    }
    if (name === 'clear-search') { state.query = ''; els.search.value = ''; return render(); }
  }

  function onFile(e) {
    var f = e.target.files && e.target.files[0];
    if (!f) return;
    var r = new FileReader();
    r.onload = function () { importText(f.name, String(r.result)); };
    r.readAsText(f);
    e.target.value = '';
  }

  // Shift whole lines when the caret sits on a list item or several lines are
  // selected; anywhere else a Tab is still just two spaces.
  function indent(out) {
    var v = els.editor.value, s = els.editor.selectionStart, en = els.editor.selectionEnd;
    var from = v.lastIndexOf('\n', s - 1) + 1;
    var lineNo = v.slice(0, from).split('\n').length - 1;
    var lastNo = v.slice(0, en).split('\n').length - 1;
    var eol = v.indexOf('\n', from);
    var onList = /^\s*(?:[-*+]\s|\[[ xX>1-9]\])/.test(v.slice(from, eol === -1 ? v.length : eol));

    if (!out && s === en && !onList) {
      return setText(v.slice(0, s) + '  ' + v.slice(en), s + 2);
    }
    var r = Subtasks.shiftLines(v, lineNo, lastNo, out);
    if (!r.delta) return;
    if (s === en) return setText(r.text, Math.max(from, s + r.firstDelta));
    var s1 = Math.max(from, s + r.firstDelta), s2 = en + r.delta;
    if (!writeKeepingUndo(r.text, s1, s2) && els.editor.value !== r.text) assign(r.text, s1, s2);
    queueSave();
    render();
  }

  // Ctrl+X with nothing selected takes the whole line, newline and all, so
  // pasting it puts a line back rather than splicing it into another one.
  // With a real selection the browser's own cut is left alone.
  function onCut(e) {
    if (els.editor.selectionStart !== els.editor.selectionEnd) return;
    if (!e.clipboardData) return;
    var r = Lines.cutLine(els.editor.value, els.editor.selectionStart);
    e.preventDefault();
    e.clipboardData.setData('text/plain', r.cut);
    replaceSpan(r.from, r.to, '', r.caret, r.caret);
  }

  function onEditorKey(e) {
    // Tab indents instead of leaving the field. On a list line it shifts the
    // whole line, which is how a todo becomes a subtask of the one above it;
    // Shift+Tab promotes it back out.
    if (e.key === 'Tab') {
      e.preventDefault();
      return indent(e.shiftKey);
    }
    // Alt+Up/Down moves the line, or the whole selected run of lines
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      var v0 = els.editor.value, s0 = els.editor.selectionStart, s1 = els.editor.selectionEnd;
      var m = Lines.move(v0, s0, s1, e.key === 'ArrowUp' ? -1 : 1);
      if (!m) return;
      if (s0 === s1) {
        // a plain caret keeps its column rather than selecting the line it rode on
        var col = s0 - Lines.lineStart(v0, s0);
        return replaceSpan(m.from, m.to, m.text, m.start + col, m.start + col);
      }
      return replaceSpan(m.from, m.to, m.text, m.start, m.end);
    }
    // Enter continues a todo/bullet list
    if (e.key === 'Enter' && !e.shiftKey) {
      var val = els.editor.value, pos = els.editor.selectionStart;
      if (pos !== els.editor.selectionEnd) return;
      var lineStart = val.lastIndexOf('\n', pos - 1) + 1;
      var cur = val.slice(lineStart, pos);
      var m = /^(\s*)([-*+] \[[ xX>1-9]\] |[-*+] )/.exec(cur);
      if (!m) return;
      e.preventDefault();
      if (cur.trim() === m[2].trim()) {           // empty item: end the list
        var cleared = val.slice(0, lineStart) + val.slice(pos);
        return setText(cleared, lineStart);
      }
      var lead = m[1] + m[2].replace(/\[[xX>1-9]\]/, '[ ]');
      var next = val.slice(0, pos) + '\n' + lead + val.slice(pos);
      setText(next, pos + 1 + lead.length);
    }
  }

  function onKey(e) {
    if (e.key === 'Escape') { closeMenu(); if (Find.isOpen()) Find.close(); return; }
    if ((e.metaKey || e.ctrlKey) && e.key === 'f') { e.preventDefault(); return Find.open(); }
    if ((e.metaKey || e.ctrlKey) && e.key === '.') {
      e.preventDefault();
      if (document.activeElement === Notes.editor()) return;   // notes have no todos
      var v = els.editor.value;
      return markNow(v.slice(0, els.editor.selectionStart).split('\n').length - 1);
    }
    if (!(e.metaKey || e.ctrlKey)) return;
    var map = { '2': 'doc', '3': 'table', '4': 'cal', '5': 'tags', '6': 'log', '7': 'focus', '8': 'music', '9': 'notes' };
    if (e.key === '1') { e.preventDefault(); setLayout('text'); }
    else if (map[e.key]) { e.preventDefault(); showView(map[e.key]); }
    else if (e.key === 'k') { e.preventDefault(); els.search.focus(); els.search.select(); }
    else if (e.key === ';') { e.preventDefault(); Pomodoro.act('toggle'); }
    else if (e.key === '\\') {
      e.preventDefault();
      setLayout(state.layout === 'view' ? 'split' : 'view');
    }
  }

  // Asking for a view while in text-only means you want to see it — go back to
  // whichever editor arrangement you were last in.
  function showView(v) {
    state.view = v;
    if (state.layout === 'text') {
      state.layout = state.prevLayout || 'split';
      applyLayout();
    }
    savePrefs();
    render();
    if (v === 'notes') Notes.focus();   // opening the page is wanting to write on it
  }

  function setLayout(next) {
    if (next !== 'text') state.prevLayout = next;
    state.layout = next;
    applyLayout();
    savePrefs();
    render();               // keeps the tab lighting and the (possibly stale) view honest
    if (next === 'text') els.editor.focus();
  }

  // 'auto' is resolved here rather than in CSS, so the stylesheet only ever
  // deals with a concrete data-theme value
  function resolvedTheme() {
    if (state.theme !== 'auto') return state.theme;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function applyTheme() {
    var root = document.documentElement;
    root.classList.add('theme-switching');
    root.dataset.theme = resolvedTheme();
    void root.offsetHeight;                       // commit the new palette un-animated
    requestAnimationFrame(function () { root.classList.remove('theme-switching'); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-theme-set]'), function (b) {
      b.classList.toggle('on', b.dataset.themeSet === state.theme);
    });
  }

  function watchSystemTheme() {
    if (!window.matchMedia) return;
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var onChange = function () { if (state.theme === 'auto') applyTheme(); };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }

  function applyLayout() {
    els.app.classList.remove('layout-text', 'layout-split', 'layout-view');
    els.app.classList.add('layout-' + state.layout);
    Overlay.sync();
    Array.prototype.forEach.call(document.querySelectorAll('[data-layout]'), function (b) {
      b.classList.toggle('on', b.dataset.layout === state.layout);
    });
    var side = document.querySelector('[data-act="sidebar"]');
    if (side) {
      var open = state.layout !== 'view';
      side.classList.toggle('on', open);
      side.setAttribute('aria-pressed', String(open));
      side.title = (open ? 'Hide' : 'Show') + ' the editor (Ctrl+\\)';
    }
  }

  /* ---------- split resizing ---------- */
  var MIN_PANE = 260;   // px — neither side is allowed to collapse to nothing

  function applySplit() {
    els.app.style.setProperty('--split', state.split + '%');
  }

  function clampSplit(pct) {
    var w = els.panes.getBoundingClientRect().width || 1;
    var divider = els.resizer.getBoundingClientRect().width || 0;
    // --split sizes the first column against the whole row, so the divider has
    // to come out of the right-hand side's budget
    var min = (MIN_PANE / w) * 100;
    var max = ((w - divider - MIN_PANE) / w) * 100;
    if (min >= max) return 50;                       // window too narrow to argue about
    return Math.max(min, Math.min(max, pct));
  }

  function setSplit(pct, persist) {
    state.split = Math.round(clampSplit(pct) * 100) / 100;
    applySplit();
    Overlay.sync();          // synchronous, so the text rewraps during the drag
    if (persist) savePrefs();
  }

  function initResizer() {
    var r = els.resizer;

    r.addEventListener('pointerdown', function (e) {
      if (state.layout !== 'split') return;
      e.preventDefault();
      r.setPointerCapture(e.pointerId);
      els.app.classList.add('resizing');

      var box = els.panes.getBoundingClientRect();
      function move(ev) { setSplit(((ev.clientX - box.left) / box.width) * 100, false); }
      function up() {
        r.releasePointerCapture(e.pointerId);
        els.app.classList.remove('resizing');
        r.removeEventListener('pointermove', move);
        r.removeEventListener('pointerup', up);
        r.removeEventListener('pointercancel', up);
        savePrefs();
      }
      r.addEventListener('pointermove', move);
      r.addEventListener('pointerup', up);
      r.addEventListener('pointercancel', up);
    });

    r.addEventListener('dblclick', function () { setSplit(40, true); });

    r.addEventListener('keydown', function (e) {
      var step = e.shiftKey ? 5 : 2;
      if (e.key === 'ArrowLeft') { e.preventDefault(); setSplit(state.split - step, true); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); setSplit(state.split + step, true); }
      else if (e.key === 'Home') { e.preventDefault(); setSplit(40, true); }
    });

    // a window resize can invalidate the clamp that was fine at the old width
    window.addEventListener('resize', function () { setSplit(state.split, false); });
  }

  /* ---------- menu ---------- */
  function toggleMenu() {
    var pop = document.getElementById('settings-menu');
    pop.hidden = !pop.hidden;
    document.querySelector('[data-act="menu"]').setAttribute('aria-expanded', String(!pop.hidden));
  }
  function closeMenu() {
    var pop = document.getElementById('settings-menu');
    if (pop) pop.hidden = true;
    var b = document.querySelector('[data-act="menu"]');
    if (b) b.setAttribute('aria-expanded', 'false');
  }
  function flash(msg) {
    var el = document.getElementById('stats');
    var prev = el.innerHTML;
    el.innerHTML = '<b>' + msg + '</b>';
    setTimeout(function () { if (el.innerHTML.indexOf(msg) !== -1) el.innerHTML = prev; }, 2200);
  }

  /* ---------- export ---------- */
  function save(filename, mime, content) {
    var blob = new Blob([content], { type: mime + ';charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    flash('Exported ' + filename);
  }

  function toJSON() {
    var v = doc.vocab, ns = {};
    v.namespaces.forEach(function (vals, name) {
      ns[name] = {
        multi: v.multi.has(name),
        values: Array.from(vals.keys()).map(function (k) {
          return { value: vals.get(k).display, count: vals.get(k).count };
        })
      };
    });
    return JSON.stringify({
      format: 'plain-text-todo', version: 1,
      exportedAt: new Date().toISOString(),
      text: els.editor.value,                       // the source of truth round-trips whole
      vocabulary: {
        namespaces: ns,
        booleans: Array.from(v.bools.values()).map(function (b) { return { name: b.display, count: b.count }; }),
        labels: Array.from(v.labels.values()).map(function (l) { return { name: l.display, count: l.count }; })
      },
      log: Log.all(),
      todos: doc.todos.map(function (t) {
        return {
          line: t.line + 1, done: t.done, active: t.active, order: t.order, title: t.title,
          depth: t.depth, parentLine: t.parent ? t.parent.line + 1 : null,
          subtasks: t.subTotal ? { done: t.subDone, total: t.subTotal } : null,
          due: t.due, priority: t.priority,
          select: Object.keys(t.values).reduce(function (o, k) {
            o[k] = v.multi.has(k) ? t.values[k].slice() : t.selects[k];
            return o;
          }, {}), boolean: t.bools, labels: t.labels,
          source: t.text
        };
      })
    }, null, 2);
  }

  function csvCell(s) {
    s = s === null || s === undefined ? '' : String(s);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCSV() {
    var cols = Views.columns(doc);
    var head = cols.map(function (c) { return c.kind === 'done' ? 'done' : c.label; });
    var rows = [head.map(csvCell).join(',')];
    doc.todos.forEach(function (t) {
      rows.push(cols.map(function (c) {
        switch (c.kind) {
          case 'done': return csvCell(t.done ? 'x' : '');
          case 'title': return csvCell(t.title);
          case 'sub': return csvCell(t.subTotal ? t.subDone + '/' + t.subTotal : '');
          case 'due': return csvCell(t.due || '');
          case 'select':
            return csvCell(c.multi ? (t.values[c.ns] || []).join('; ') : (t.selects[c.ns] || ''));
          case 'bool': return csvCell(t.bools[c.name] ? 'yes' : 'no');
          case 'labels': return csvCell(t.labels.map(function (l) { return '#' + l; }).join(' '));
        }
        return '';
      }).join(','));
    });
    return rows.join('\n') + '\n';
  }

  /* ---------- import ---------- */
  function parseCSV(text) {
    var rows = [], row = [], cell = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (c === '"') q = false;
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else if (c !== '\r') cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (c) { return c.trim(); }); });
  }

  function tagValue(ns, value) {
    var v = String(value).trim();
    return '#' + ns + ':' + (/[\s]/.test(v) ? '"' + v + '"' : v);
  }

  // Rebuild plain text from an exported table. Only columns we recognise are used.
  function csvToText(rows) {
    var head = rows[0].map(function (h) { return TT.key(h); });
    var ti = head.indexOf('task'); if (ti < 0) ti = head.indexOf('title');
    if (ti < 0) return null;
    var di = head.indexOf('done'), ui = head.indexOf('due'), li = head.indexOf('labels');
    var si = head.indexOf('sub');            // progress is a readout, not a tag to rebuild
    var out = ['# Imported ' + new Date().toISOString().slice(0, 10), ''];
    rows.slice(1).forEach(function (r) {
      var line = '- [' + (di >= 0 && /^(x|yes|true|done)$/i.test((r[di] || '').trim()) ? 'x' : ' ') + '] ' + (r[ti] || '').trim();
      if (ui >= 0 && (r[ui] || '').trim()) line += ' @' + r[ui].trim();
      head.forEach(function (h, i) {
        var val = (r[i] || '').trim();
        if (!val || i === ti || i === di || i === ui || i === li || i === si) return;
        if (h.charAt(0) === '~') { if (/^(yes|true|x|1)$/i.test(val)) line += ' ~' + h.slice(1); }
        else if (h === 'priority') line += ' !' + val;
        else {
          val.split(';').forEach(function (one) {
            if (one.trim()) line += ' ' + tagValue(h, one);
          });
        }
      });
      if (li >= 0 && (r[li] || '').trim()) {
        line += ' ' + r[li].trim().split(/\s+/).map(function (l) { return l.charAt(0) === '#' ? l : '#' + l; }).join(' ');
      }
      out.push(line);
    });
    return out.join('\n') + '\n';
  }

  function importText(name, raw) {
    var text = raw, note = '';
    if (/\.json$/i.test(name)) {
      var data;
      try { data = JSON.parse(raw); } catch (e) { return alert('That JSON file could not be parsed.'); }
      if (Array.isArray(data.log) && data.log.length && confirm('This file carries an activity log of ' + data.log.length + ' entries. Replace the current log with it?')) {
        Log.load(data.log);
      }
      if (typeof data.text === 'string') { text = data.text; note = ' (from JSON source)'; }
      else if (Array.isArray(data.todos)) {
        text = ['# Imported ' + new Date().toISOString().slice(0, 10), ''].concat(data.todos.map(function (t) {
          return typeof t.source === 'string'
            ? '- [' + (t.done ? 'x' : ' ') + '] ' + t.source
            : '- [' + (t.done ? 'x' : ' ') + '] ' + (t.title || '');
        })).join('\n') + '\n';
        note = ' (rebuilt from todos)';
      } else return alert('That JSON has no "text" or "todos" to import.');
    } else if (/\.csv$/i.test(name)) {
      var rebuilt = csvToText(parseCSV(raw));
      if (!rebuilt) return alert('That CSV needs a header row with a "task" or "title" column.');
      text = rebuilt;
      note = ' (rebuilt from CSV)';
    }
    if (els.editor.value.trim() && !confirm('Replace the current text with ' + name + '?')) return;
    Log.suppress();
    setText(text, 0);
    flash('Imported ' + name + note);
  }

  /* ---------- sample ---------- */
  var SAMPLE = [
    '# Studio — week of Aug 17',
    '',
    'Plain text is the whole database. Tags below turn into columns on the right.',
    '',
    '## Shipping',
    '',
    '- [x] Rewrite the tag scanner @2026-08-18 !high #status:"in progress" #proj:atlas ~billable',
    '- [ ] Two-pass resolver: learn, then resolve @2026-08-20 !high #status:review #atlas ~billable',
    '  - [x] Scan the whole document first',
    '  - [x] Index every namespaced value',
    '  - [ ] Resolve bare tags against the index',
    '- [ ] Write the calendar view @2026-08-21 #med #status:todo #proj:atlas',
    '- [ ] Sweep the copy for typos @fri #low #status:todo #atlas #writing',
    '',
    '## Client work',
    '',
    '- [ ] Invoice for July retainer @2026-08-25 !high #client:northwind ~billable ~sent',
    '- [ ] Northwind kickoff deck @tomorrow #status:blocked #northwind #client-work',
    '- [x] Refund the duplicate charge @2026-08-14 #client:vega ~billable',
    '- [ ] Chase Vega for assets @2026-08-28 #low #vega #waiting',
    '',
    '## Around the house',
    '',
    '- [ ] Repaint the shed #blue #home',
    '- [ ] Pick up two litres of #color:blue emulsion @sat #home',
    '- [ ] Book the boiler service @2026-09-02 #med #home',
    '- [ ] Renew car insurance @2026-09-15 #home',
    '',
    'Indent a todo under another one and it becomes a subtask: tick the parent and',
    'the whole group is done, tick the last child and the parent finishes itself.',
    '',
    'Notes: `#blue` on the shed line resolves to *color:blue* even though the paint',
    'line that taught it comes later — vocabulary is learned across the whole document',
    'before anything is resolved. `#atlas`, `#northwind` and `#vega` work the same way.',
    '`#home`, `#writing` and `#waiting` were never namespaced, so they stay plain labels.'
  ].join('\n');

  // handy from the console, and what the browser tests drive
  window.PTT = {
    toJSON: toJSON, toCSV: toCSV, importText: importText,
    parseCSV: parseCSV, csvToText: csvToText,
    doc: function () { return doc; }, state: state, sample: SAMPLE,
    applyTheme: applyTheme, resolvedTheme: resolvedTheme, archive: function () { return action('archive'); },
    showView: showView, setLayout: setLayout, setSplit: setSplit
  };

  function boot() { Store.ready(init, unreachable); }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
