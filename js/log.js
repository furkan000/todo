/* Completion log.
   Watches consecutive parses and records the moment a todo goes open -> done,
   wherever that happened: a checkbox, the table, the calendar, or the letter x
   typed straight into the text. Entries are an append-only history — they keep a
   snapshot of the todo, so later edits to the document never rewrite the past. */
(function (global) {
  'use strict';

  var KEY = 'ptt.log.v1';
  var CAP = 5000;

  var entries = [];      // newest last
  var prev = null;       // todo snapshot from the previous parse
  var skip = false;
  var removed = {};      // id -> true: taken out, but still inside its undo grace
  var seq = 0;

  // Entries need a name to be removed by. Older logs were written without one,
  // so they are given theirs the first time they are read back.
  function uid() { return (++seq).toString(36) + '-' + Date.now().toString(36); }
  function identify(list) {
    list.forEach(function (e) { if (e && !e.id) e.id = uid(); });
    return list;
  }

  function init() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) entries = identify(JSON.parse(raw) || []);
    } catch (e) { entries = []; }
  }

  // What is written out is what `all()` says, so an entry inside its grace is
  // already gone from storage: closing the tab is one way of meaning it.
  function save() {
    if (entries.length > CAP) entries = entries.slice(entries.length - CAP);
    try { localStorage.setItem(KEY, JSON.stringify(all())); } catch (e) {}
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function stamp(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function snapshot(doc) {
    return doc.todos.map(function (t) {
      return { line: t.line, title: t.title, done: t.done };
    });
  }

  // A todo is "the same todo" across two parses if it sits on the same line with
  // the same words, or — when a line was inserted above it — if its words are
  // unique in both. Anything vaguer would invent completions.
  function wasOpen(before, todo) {
    var i, exact = null, byTitle = [], hit;
    for (i = 0; i < before.length; i++) {
      hit = before[i];
      if (hit.line === todo.line && hit.title === todo.title) exact = hit;
      if (hit.title === todo.title) byTitle.push(hit);
    }
    if (exact) return exact.done === false;
    if (byTitle.length === 1) return byTitle[0].done === false;
    return false;
  }

  // Called after every parse. The first call only establishes a baseline: todos
  // that are already done when the document loads were not done *now*.
  function observe(doc) {
    var now = snapshot(doc);
    if (skip) { skip = false; prev = now; return 0; }
    if (!prev) { prev = now; return 0; }

    var added = 0;
    doc.todos.forEach(function (t) {
      if (!t.done) return;
      if (!wasOpen(prev, t)) return;
      entries.push({
        id: uid(),
        ts: Date.now(),
        at: stamp(new Date()),
        event: 'done',
        title: t.title,
        parent: t.parent ? t.parent.title : '',
        section: t.section ? t.section.title : '',
        due: t.due || '',
        priority: t.priority || ''
      });
      added++;
    });
    prev = now;
    if (added) save();
    return added;
  }

  // Wholesale replacements (import, sample, clear) are not acts of completing work
  function suppress() { skip = true; }

  // Anything else worth remembering the moment of — a finished focus session,
  // say. The log is a history of what happened, not only of what got ticked.
  function record(entry) {
    if (!entry || !entry.event) return null;
    var d = new Date();
    var e = {
      id: uid(), ts: d.getTime(), at: stamp(d), event: entry.event,
      title: entry.title || '', parent: entry.parent || '', section: entry.section || '',
      due: entry.due || '', priority: entry.priority || ''
    };
    if (entry.minutes) e.minutes = entry.minutes;
    entries.push(e);
    save();
    return e;
  }

  function all() {
    return entries.filter(function (e) { return !removed[e.id]; });
  }
  function count() { return all().length; }

  /* ---------- removing an entry ---------- */
  // The log is a history, so a line in it is only ever removed on purpose — but
  // the purpose can be a slipped click. Removal happens at once and is staged
  // with Undo; the row stays on the page, struck through, until the grace runs
  // out. Nothing here knows how long that is; Undo owns the clock.
  var TAG = 'log:';

  function indexOf(id) {
    for (var i = 0; i < entries.length; i++) if (entries[i].id === id) return i;
    return -1;
  }

  function commitRemoval(id) {
    delete removed[id];
    var i = indexOf(id);
    if (i >= 0) entries.splice(i, 1);
    save();
  }

  function remove(id) {
    var i = indexOf(id);
    if (i < 0 || removed[id]) return null;
    var entry = entries[i];
    removed[id] = true;
    save();
    if (!global.Undo) { commitRemoval(id); return entry; }
    global.Undo.stage({
      id: TAG + id, label: entry.title || 'entry',
      commit: function () { commitRemoval(id); },
      revert: function () { delete removed[id]; save(); }
    });
    return entry;
  }

  // Put one back. Works whether or not Undo is around to be asked.
  function restore(id) {
    if (global.Undo && global.Undo.undo(TAG + id)) return true;
    if (!removed[id]) return false;
    delete removed[id];
    save();
    return true;
  }

  function forgetPending() {
    Object.keys(removed).forEach(function (id) {
      if (global.Undo) global.Undo.drop(TAG + id);
    });
    removed = {};
  }

  function clear() {
    forgetPending();
    entries = [];
    save();
  }

  function load(list) {
    if (!Array.isArray(list)) return false;
    forgetPending();
    entries = identify(list.filter(function (e) { return e && e.at && e.event; }));
    save();
    return true;
  }

  /* ---------- views and exports ---------- */
  // byDay is for the view only — unlike `all()`, this keeps the entries that are waiting
  // out their grace, flagged, so the page can offer them back rather than
  // making a row vanish under the pointer that clicked it.
  function byDay() {
    var days = [], index = {};
    entries.slice().reverse().forEach(function (e) {
      var day = e.at.slice(0, 10);
      if (!index[day]) { index[day] = { day: day, items: [] }; days.push(index[day]); }
      if (!removed[e.id]) return index[day].items.push(e);
      var copy = {}, k;
      for (k in e) if (Object.prototype.hasOwnProperty.call(e, k)) copy[k] = e[k];
      copy.pending = true;
      copy.left = global.Undo ? global.Undo.remaining(TAG + e.id) : 0;
      copy.grace = global.Undo && global.Undo.find(TAG + e.id) ? global.Undo.find(TAG + e.id).grace : 0;
      index[day].items.push(copy);
    });
    return days;
  }

  function toMarkdown() {
    var out = ['# Activity log', ''];
    byDay().forEach(function (d) {
      // an entry inside its undo grace is on its way out; a history is not a draft
      var live = d.items.filter(function (e) { return !e.pending; });
      if (!live.length) return;
      out.push('## ' + d.day, '');
      live.forEach(function (e) {
        out.push('- ' + e.at.slice(11) + ' — ' + (e.event === 'done' ? '' : e.event + ': ') +
          (e.parent ? e.parent + ' › ' : '') + e.title +
          (e.minutes ? '  (' + e.minutes + ' min)' : '') +
          (e.section ? '  *(' + e.section + ')*' : ''));
      });
      out.push('');
    });
    if (!count()) out.push('_Nothing logged yet._');
    return out.join('\n');
  }

  function cell(s) {
    s = s === null || s === undefined ? '' : String(s);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCSV() {
    var rows = ['when,event,task,parent,section,due,priority,minutes'];
    all().forEach(function (e) {
      rows.push([e.at, e.event, e.title, e.parent || '', e.section, e.due, e.priority, e.minutes || ''].map(cell).join(','));
    });
    return rows.join('\n') + '\n';
  }

  function toJSON() {
    return JSON.stringify({ format: 'plain-text-todo-log', version: 1, entries: all() }, null, 2);
  }

  global.Log = {
    init: init, observe: observe, suppress: suppress, record: record,
    all: all, count: count, clear: clear, load: load, byDay: byDay,
    remove: remove, restore: restore, pending: function () { return Object.keys(removed); },
    toMarkdown: toMarkdown, toCSV: toCSV, toJSON: toJSON, stamp: stamp
  };
})(typeof window !== 'undefined' ? window : globalThis);
