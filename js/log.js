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

  function init() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) entries = JSON.parse(raw) || [];
    } catch (e) { entries = []; }
  }

  function save() {
    if (entries.length > CAP) entries = entries.slice(entries.length - CAP);
    try { localStorage.setItem(KEY, JSON.stringify(entries)); } catch (e) {}
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

  function all() { return entries.slice(); }
  function count() { return entries.length; }

  function clear() {
    entries = [];
    save();
  }

  function load(list) {
    if (!Array.isArray(list)) return false;
    entries = list.filter(function (e) { return e && e.at && e.event; });
    save();
    return true;
  }

  /* ---------- exports ---------- */
  function byDay() {
    var days = [], index = {};
    all().slice().reverse().forEach(function (e) {
      var day = e.at.slice(0, 10);
      if (!index[day]) { index[day] = { day: day, items: [] }; days.push(index[day]); }
      index[day].items.push(e);
    });
    return days;
  }

  function toMarkdown() {
    var out = ['# Activity log', ''];
    byDay().forEach(function (d) {
      out.push('## ' + d.day, '');
      d.items.forEach(function (e) {
        out.push('- ' + e.at.slice(11) + ' — ' + (e.parent ? e.parent + ' › ' : '') + e.title +
          (e.section ? '  *(' + e.section + ')*' : ''));
      });
      out.push('');
    });
    if (!entries.length) out.push('_Nothing logged yet._');
    return out.join('\n');
  }

  function cell(s) {
    s = s === null || s === undefined ? '' : String(s);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCSV() {
    var rows = ['when,event,task,parent,section,due,priority'];
    all().forEach(function (e) {
      rows.push([e.at, e.event, e.title, e.parent || '', e.section, e.due, e.priority].map(cell).join(','));
    });
    return rows.join('\n') + '\n';
  }

  function toJSON() {
    return JSON.stringify({ format: 'plain-text-todo-log', version: 1, entries: all() }, null, 2);
  }

  global.Log = {
    init: init, observe: observe, suppress: suppress,
    all: all, count: count, clear: clear, load: load, byDay: byDay,
    toMarkdown: toMarkdown, toCSV: toCSV, toJSON: toJSON, stamp: stamp
  };
})(typeof window !== 'undefined' ? window : globalThis);
