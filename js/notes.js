/* Notes — a blank page every day.

   Each day is its own plain text, kept under its own key (`ptt.note.20261010`,
   one file per day on the server), so there is no long document to scroll and
   nothing to clear: a new day simply has no text yet. A day you never wrote in
   does not exist.

   A day runs from 02:00 to 02:00. A call that ends at half past midnight still
   belongs to the evening it started in.

   `## ` starts a conversation, and everything up to the next one belongs to
   it. Tags anywhere in it — on the heading or in the body — tag the whole
   conversation, and they are the todo list's tags: `#vega` resolves to
   `client:vega` here exactly as it does there. Notes only ever *read* that
   vocabulary. Nothing written here can create a column in the table.

   No todos: a `- [ ]` in a note is just text.

   Like pomodoro.js it is two layers. The functions on top are pure and take
   the moment and the texts as arguments, which is what the tests drive. The
   panel below them is built once and kept: render() re-attaches it rather than
   rebuilding it, so typing in the todo text never takes focus, the caret or
   Ctrl+Z away from a note. */
(function (global) {
  'use strict';

  var PREFIX = 'ptt.note.';
  var ROLLOVER_H = 2;
  var KEY_RE = /^ptt\.note\.(\d{4})(\d{2})(\d{2})$/;
  var HEAD = /^##\s(.*)$/;              // '## ' — and not '###', which is a sub-heading
  var TIME = /^(\d{1,2}:\d{2})\s*/;
  var IDLE_MS = 60000;                  // a day does not turn over under your hands
  var TOPICS_MAX = 24;

  /* ---------- days ---------- */

  function dayOf(now) {
    return TT.isoOf(new Date(now.getTime() - ROLLOVER_H * 3600e3));
  }
  function keyOf(day) { return PREFIX + day.replace(/-/g, ''); }
  function dayOfKey(k) {
    var m = KEY_RE.exec(k);
    return m ? m[1] + '-' + m[2] + '-' + m[3] : null;
  }
  function dateOf(day) {
    var p = day.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }
  function shiftDay(day, n) {
    var d = dateOf(day);
    d.setDate(d.getDate() + n);
    return TT.isoOf(d);
  }

  // 'Today', 'Yesterday', 'Fri 9 Oct' — and the year only when it is not this one
  function shortLabel(day, today) {
    if (day === today) return 'Today';
    if (day === shiftDay(today, -1)) return 'Yesterday';
    var o = { weekday: 'short', day: 'numeric', month: 'short' };
    if (day.slice(0, 4) !== today.slice(0, 4)) o.year = 'numeric';
    return dateOf(day).toLocaleDateString('en-GB', o);
  }
  function longLabel(day, today) {
    var o = { weekday: 'long', day: 'numeric', month: 'long' };
    if (day.slice(0, 4) !== today.slice(0, 4)) o.year = 'numeric';
    return dateOf(day).toLocaleDateString('en-GB', o);
  }

  /* ---------- conversations ---------- */

  // Text before the first '## ' is a section of its own, untitled, and only
  // kept when there is something in it.
  function sections(text) {
    var out = [], cur = null;
    String(text).split('\n').forEach(function (raw, i) {
      var m = HEAD.exec(raw);
      if (m || !cur) {
        cur = { line: i, heading: m ? m[1] : null, lines: [] };
        out.push(cur);
      }
      cur.lines.push(raw);
    });
    return out.filter(function (s) {
      return s.heading !== null || s.lines.join('').trim();
    }).map(function (s) {
      var head = s.heading || '';
      var tm = TIME.exec(head);
      var rest = tm ? head.slice(tm[0].length) : head;
      var body = s.heading === null ? s.lines : s.lines.slice(1);
      return {
        line: s.line,
        time: tm ? tm[1] : '',
        heading: s.heading,
        title: TT.stripTokens(rest, TT.scanTokens(rest)).trim(),
        body: body,
        text: s.lines.join('\n'),
        tokens: TT.scanTokens(s.lines.join('\n'))
      };
    });
  }

  // What a bare tag resolves to: the todo list's vocabulary first, then values
  // the notes namespaced themselves. Priority stays out — "#low" in a note is
  // about a mood, not a ranking.
  function vocabulary(base, texts) {
    var idx = new Map();
    if (base && base.valueIndex) {
      base.valueIndex.forEach(function (ns, vk) {
        if (ns === 'priority') return;
        var vals = base.namespaces.get(ns), hit = vals && vals.get(vk);
        idx.set(vk, { ns: ns, value: hit ? hit.display : vk });
      });
    }
    (texts || []).forEach(function (text) {
      TT.scanTokens(text).forEach(function (t) {
        if (t.kind !== 'select') return;
        var vk = TT.key(t.value);
        if (!idx.has(vk)) idx.set(vk, { ns: TT.key(t.ns), value: t.value });
      });
    });
    return idx;
  }

  // A conversation's tags, as the same search strings the todo chips carry, so
  // clicking a tag finds it in both places.
  function tagsOf(section, idx) {
    var seen = {}, out = [];
    section.tokens.forEach(function (t) {
      var tag;
      if (t.kind === 'select') tag = { kind: 'select', ns: TT.key(t.ns), value: t.value };
      else if (t.kind === 'bare') {
        var hit = idx && idx.get(TT.key(t.name));
        tag = hit ? { kind: 'select', ns: hit.ns, value: hit.value } : { kind: 'bare', name: t.name };
      } else return;
      tag.q = tag.kind === 'select' ? '#' + tag.ns + ':' + tag.value : '#' + tag.name;
      var k = tag.q.toLowerCase();
      if (seen[k]) return;
      seen[k] = true;
      out.push(tag);
    });
    return out;
  }

  // The words of a query, each one a term on its own
  function terms(query) {
    var seen = {};
    return String(query || '').toLowerCase().split(/\s+/).filter(function (t) {
      if (!t || seen[t]) return false;
      return (seen[t] = true);
    });
  }

  function occurrences(hay, t) {
    var n = 0, i = 0;
    while ((i = hay.indexOf(t, i)) !== -1) { n++; i += t.length; }
    return n;
  }

  // Full-text search over conversations, not days: every one that holds all
  // the words of the query, in any order and on any of its lines, or as a tag.
  // Each hit carries the line that holds the most of them, which is where
  // opening it puts you, and a score: a word in the title counts for more
  // than one in the body.
  function search(notes, query, idx) {
    var ts = terms(query);
    if (!ts.length) return [];
    var hits = [];
    notes.forEach(function (n) {
      sections(n.text).forEach(function (s) {
        var hay = s.text.toLowerCase() + '\n' +
          tagsOf(s, idx).map(function (t) { return t.q.toLowerCase(); }).join(' ');
        if (!ts.every(function (t) { return hay.indexOf(t) !== -1; })) return;
        var title = s.title.toLowerCase(), score = 0;
        ts.forEach(function (t) { score += occurrences(hay, t) + (title.indexOf(t) !== -1 ? 5 : 0); });
        var best = s.line, most = 0, lines = s.text.split('\n');
        lines.forEach(function (l, i) {
          var low = l.toLowerCase(), k = 0;
          ts.forEach(function (t) { if (low.indexOf(t) !== -1) k++; });
          // a tie goes to the body: the title is on show anyway
          if (k > most || (k && k === most && best === s.line && s.heading !== null)) { most = k; best = s.line + i; }
        });
        hits.push({ day: n.day, section: s, line: best, text: lines[best - s.line], score: score });
      });
    });
    return hits;
  }

  // Every tag used in the notes, most used first
  function topics(notes, idx) {
    var count = {}, tag = {};
    notes.forEach(function (n) {
      sections(n.text).forEach(function (s) {
        tagsOf(s, idx).forEach(function (t) {
          var k = t.q.toLowerCase();
          count[k] = (count[k] || 0) + 1;
          tag[k] = tag[k] || t;
        });
      });
    });
    return Object.keys(count).sort(function (a, b) {
      return count[b] - count[a] || (a < b ? -1 : 1);
    }).map(function (k) { tag[k].count = count[k]; return tag[k]; });
  }

  // Every day as one Markdown file, newest first, each under its date
  function toMarkdown(notes) {
    var out = ['# Notes', ''];
    notes.forEach(function (n) {
      out.push('# ' + n.day + ' — ' + dateOf(n.day).toLocaleDateString('en-GB', { weekday: 'long' }), '');
      out.push(n.text.replace(/\s+$/, ''), '');
    });
    if (!notes.length) out.push('_Nothing written yet._');
    return out.join('\n') + '\n';
  }

  /* ---------- what is kept ---------- */

  function read(day) {
    var v = null;
    try { v = Store.getItem(keyOf(day)); } catch (e) {}
    return v === null ? '' : v;
  }

  // Every day with something written in it, newest first
  function all() {
    return Store.keys(PREFIX).map(function (k) {
      return { day: dayOfKey(k), text: read(dayOfKey(k)) };
    }).filter(function (n) { return n.day && n.text.trim(); }).sort(function (a, b) {
      return a.day < b.day ? 1 : -1;
    });
  }

  /* ---------- the panel ---------- */

  var opts = {}, root = null, ed = null, side = null, head = null;
  var today = null, current = null, lastInput = 0, sideTimer = null;
  // the list of days is out of the way until asked for, and remembered
  var UI = 'ptt.notes.v1', sideOpen = false;
  var adding = false;                   // the + has been pressed: a date is being picked

  function esc(s) { return Views.esc(s); }

  function build() {
    root = document.createElement('div');
    root.className = 'notes';
    root.innerHTML =
      '<div class="notes-main">' +
        '<div class="notes-head"></div>' +
        '<textarea class="notes-ed" spellcheck="true" autocomplete="off" placeholder="' +
          esc('## Call with Vega #client:vega\nWhat was said, what was decided…\n\n## Standup #team\n…') + '"></textarea>' +
      '</div>' +
      '<aside class="notes-side"></aside>';
    side = root.querySelector('.notes-side');
    head = root.querySelector('.notes-head');
    ed = root.querySelector('.notes-ed');
    ed.addEventListener('input', onInput);
    ed.addEventListener('keydown', onKeydown);
    root.addEventListener('click', onClick);
    root.addEventListener('change', onPick);
  }

  function vocab(notes) {
    return vocabulary(opts.vocab ? opts.vocab() : null, notes.map(function (n) { return n.text; }));
  }

  function chip(t) {
    return Views.chipHTML(t.kind === 'select'
      ? { kind: 'select', ns: t.ns, value: t.value, raw: t.q }
      : { kind: 'bare', name: t.name, raw: t.q });
  }

  // Every place any of the words occurs, marked
  function mark(s, q) {
    var ts = Array.isArray(q) ? q : terms(q);
    if (!ts.length) return esc(s);
    var re = new RegExp(ts.map(function (t) { return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|'), 'gi');
    var out = '', at = 0, m;
    while ((m = re.exec(s))) {
      out += esc(s.slice(at, m.index)) + '<mark>' + esc(m[0]) + '</mark>';
      at = m.index + m[0].length;
    }
    return out + esc(s.slice(at));
  }

  // A line cut down to a snippet, starting near its first match
  function snippet(line, q, max) {
    var ts = Array.isArray(q) ? q : terms(q), low = line.toLowerCase(), first = -1;
    ts.forEach(function (t) { var i = low.indexOf(t); if (i !== -1 && (first === -1 || i < first)) first = i; });
    var from = first > max / 3 ? first - 20 : 0;
    var cut = line.slice(from, from + max);
    return (from ? '…' : '') + mark(cut, ts) + (from + max < line.length ? '…' : '');
  }

  // A conversation by its time and title; one without a title by its first line
  function sectionTitle(s, q) {
    if (s.title || s.time) {
      return (s.time ? '<span class="notes-time">' + esc(s.time) + '</span>' : '') +
        (s.title ? mark(s.title, q) : '<span class="muted">untitled</span>');
    }
    var first = s.body.filter(function (l) { return l.trim(); })[0] || '';
    return '<span class="muted">' + (first.trim() ? mark(first.trim().slice(0, 60), q) : 'untitled') + '</span>';
  }

  function paintHead() {
    var past = current !== today;
    head.innerHTML =
      '<h2>' + esc(longLabel(current, today)) + '</h2>' +
      (past ? '<button class="link" data-note-day="' + today + '">back to today</button>'
            : '<span class="notes-today">today</span>') +
      '<span class="spacer-flex"></span>' +
      '<button class="icon-btn" data-act="spotlight" title="Search all notes (Ctrl+Shift+F)">' +
        '<svg viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14"/></svg>' +
      '</button>' +
      '<button class="icon-btn notes-side-btn' + (sideOpen ? ' on' : '') + '" data-note-side' +
        ' aria-pressed="' + sideOpen + '" title="' + (sideOpen ? 'Hide' : 'Show') + ' the days and topics">' +
        '<svg viewBox="0 0 16 16"><rect x="1" y="2.5" width="14" height="11" rx="1.5"/><path d="M10 2.5v11"/><path class="fill" d="M10.4 3.2h4v9.6h-4z"/></svg>' +
      '</button>';
    root.classList.toggle('side-open', sideOpen);
  }

  function setSide(open) {
    sideOpen = open;
    try { Store.setItem(UI, JSON.stringify({ side: open })); } catch (e) {}
    paintHead();
  }

  function paintSide() {
    var notes = all();
    // today, and a day just opened with the +, are listed before anything is in them
    [today, current].forEach(function (d) {
      if (!d || notes.some(function (n) { return n.day === d; })) return;
      notes.push({ day: d, text: '' });
    });
    notes.sort(function (a, b) { return a.day < b.day ? 1 : -1; });
    // searching is Spotlight's job; the list is only ever the days
    var idx = vocab(notes), html = '';
    var tags = topics(notes, idx).slice(0, TOPICS_MAX);
    if (tags.length) {
      html += '<div class="notes-sub">Topics</div><div class="notes-topics">' + tags.map(chip).join('') + '</div>';
    }
    html += '<div class="notes-sub notes-days-h">Days' +
      '<button class="notes-add" data-note-add title="Write on a past day">+</button></div>' +
      (adding ? '<div class="notes-pick"><input type="date" max="' + today + '" aria-label="Which day"></div>' : '');
    notes.forEach(function (n) {
      html += '<div class="notes-day' + (n.day === current ? ' here' : '') + '">' +
        '<button class="notes-day-h" data-note-day="' + n.day + '">' + esc(shortLabel(n.day, today)) + '</button>';
      sections(n.text).forEach(function (s) {
        html += '<button class="notes-sec" data-note-day="' + n.day + '" data-note-line="' + s.line + '">' +
          sectionTitle(s, '') + '</button>';
      });
      html += '</div>';
    });
    side.innerHTML = html;
  }

  /* ---------- editing ---------- */

  function lineStart(text, line) {
    var at = 0, lines = text.split('\n');
    for (var i = 0; i < line && i < lines.length; i++) at += lines[i].length + 1;
    return at;
  }

  function open(day, line) {
    if (day !== current) {
      current = day;
      ed.value = read(day);
    }
    paintHead();
    paintSide();
    if (line === undefined) return;
    var v = ed.value, from = lineStart(v, line), eol = v.indexOf('\n', from);
    ed.focus();
    ed.setSelectionRange(from, eol === -1 ? v.length : eol);
    var lh = parseFloat(getComputedStyle(ed).lineHeight) || 22;
    ed.scrollTop = Math.max(0, line * lh - ed.clientHeight / 3);
  }

  function save() {
    var k = keyOf(current), v = ed.value;
    // an empty day is not worth a key — until it has one, then it must be emptied
    if (!v && Store.getItem(k) === null) return;
    Store.guard(k);
    try { Store.setItem(k, v); } catch (e) {}
  }

  function typeIn(str) {
    try { return document.execCommand('insertText', false, str); } catch (e) { return false; }
  }

  function onInput() {
    lastInput = Date.now();
    save();
    clearTimeout(sideTimer);
    sideTimer = setTimeout(paintSide, 300);
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function onKeydown(e) {
    // '##' and a space on an empty line writes the time after it: when a call
    // started is the one thing you never note down yourself
    if (e.key === ' ' && !e.ctrlKey && !e.altKey && !e.metaKey && ed.selectionStart === ed.selectionEnd) {
      var v0 = ed.value, at0 = ed.selectionStart, from0 = v0.lastIndexOf('\n', at0 - 1) + 1;
      var eol0 = v0.indexOf('\n', at0);
      if (v0.slice(from0, at0) === '##' && !v0.slice(at0, eol0 === -1 ? v0.length : eol0).trim()) {
        var now = new Date();
        e.preventDefault();
        typeIn(' ' + pad(now.getHours()) + ':' + pad(now.getMinutes()) + ' ');
        return;
      }
    }
    if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      if (!e.shiftKey) typeIn('  ');
      return;
    }
    // Enter carries a bullet on; on an empty bullet it ends the list
    if (e.key === 'Enter' && !e.shiftKey && ed.selectionStart === ed.selectionEnd) {
      var v = ed.value, at = ed.selectionStart, from = v.lastIndexOf('\n', at - 1) + 1;
      var m = /^(\s*[-*+] )/.exec(v.slice(from, at));
      if (!m) return;
      e.preventDefault();
      if (v.slice(from, at) === m[1]) {
        ed.setSelectionRange(from, at);
        typeIn('\n');
      } else typeIn('\n' + m[1]);
    }
  }

  // The + asks for a date. Only one that has been: a day still to come has
  // nothing to note yet.
  function startAdding() {
    adding = !adding;
    paintSide();
    var pick = side.querySelector('.notes-pick input');
    if (!pick) return;
    pick.focus();
    try { pick.showPicker(); } catch (e) {}
  }

  function onPick(e) {
    var pick = e.target;
    if (!pick.matches || !pick.matches('.notes-pick input') || !pick.value) return;
    if (pick.value > today) return;
    adding = false;
    open(pick.value);
    ed.focus();
  }

  function onClick(e) {
    if (e.target.closest && e.target.closest('[data-note-side]')) return setSide(!sideOpen);
    if (e.target.closest && e.target.closest('[data-note-add]')) return startAdding();
    var el = e.target.closest ? e.target.closest('[data-note-day]') : null;
    if (!el || !root.contains(el)) return;
    var line = el.getAttribute('data-note-line');
    open(el.getAttribute('data-note-day'), line === null ? undefined : +line);
    if (line === null) ed.focus();
  }

  /* ---------- the day turning over ---------- */

  function tick(now) {
    var d = dayOf(now || new Date());
    if (d === today) return;
    if (current === today) {
      // never under your hands: wait for a pause
      if ((now ? now.getTime() : Date.now()) - lastInput < IDLE_MS) return;
      today = d;
      current = null;
      open(d);
    } else {
      today = d;
      paintHead();
      paintSide();
    }
  }

  /* ---------- another device ---------- */

  // The open day was changed elsewhere: take it in as an edit, so Ctrl+Z still
  // works past it, or plainly when the page is not being typed in.
  function onRemote(keys) {
    if (!root) return;
    var mine = keyOf(current);
    if (keys.indexOf(mine) !== -1) {
      var next = read(current), was = ed.value;
      if (next !== was) {
        if (document.activeElement === ed) {
          var a = 0, z = 0, max = Math.min(was.length, next.length), s = ed.selectionStart;
          while (a < max && was.charCodeAt(a) === next.charCodeAt(a)) a++;
          while (z < max - a && was.charCodeAt(was.length - 1 - z) === next.charCodeAt(next.length - 1 - z)) z++;
          ed.setSelectionRange(a, was.length - z);
          if (!typeIn(next.slice(a, next.length - z)) || ed.value !== next) ed.value = next;
          s = Math.min(s, next.length);
          ed.setSelectionRange(s, s);
        } else ed.value = next;
      }
    }
    if (keys.some(function (k) { return k.indexOf(PREFIX) === 0; })) paintSide();
  }

  /* ---------- wiring ---------- */

  function init(o) {
    opts = o || {};
    today = dayOf(new Date());
    try { sideOpen = !!JSON.parse(Store.getItem(UI) || '{}').side; } catch (e) { sideOpen = false; }
    // a day of notes is never written over a version this tab has not seen
    Store.keys(PREFIX).forEach(function (k) { Store.guard(k); });
    build();
    current = null;
    open(today);
    setInterval(function () { tick(); }, 30000);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') tick();
    });
  }

  // Put the panel on the stage, where render() would otherwise have written
  // markup. It is the same element every time.
  function mount(stage) {
    if (!root) return;
    if (root.parentNode !== stage) {
      stage.innerHTML = '';
      stage.appendChild(root);
    }
    paintHead();
    paintSide();
  }

  global.Notes = {
    PREFIX: PREFIX,
    dayOf: dayOf, keyOf: keyOf, dayOfKey: dayOfKey, shortLabel: shortLabel,
    sections: sections, vocabulary: vocabulary, tagsOf: tagsOf, search: search, topics: topics,
    terms: terms, mark: mark, snippet: snippet,
    vocab: function (notes) { return vocab(notes); },
    titleHTML: function (s, q) { return sectionTitle(s, q); },
    toMarkdown: toMarkdown, all: all, init: init, mount: mount, open: open, tick: tick, onRemote: onRemote,
    sideOpen: function () { return sideOpen; },
    focus: function () { if (ed) ed.focus(); },
    editor: function () { return ed; },
    day: function () { return current; },
    today: function () { return today; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
