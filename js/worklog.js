/* Work log — what you did, one page per day.

   Built for the end of the month, when every workday has to be accounted for.
   Each day is its own plain text under its own key (`ptt.work.20261010`, one
   file per day on the server), and like Notes a day runs from 02:00 to 02:00.

   Under the page sits what the rest of the app already knows about that day,
   read and never written: the todos finished on it, from the activity log, each
   one a click away from being copied into the page; and that day's notes,
   folded away. The page is the only thing here you write, and the only thing
   the month's export is made from besides those lists.

   The panel is built once and re-attached on every render, as Notes is, so
   ticking a todo in split view never takes the caret away from the page. */
(function (global) {
  'use strict';

  var PREFIX = 'ptt.work.';
  var KEY_RE = /^ptt\.work\.(\d{4})(\d{2})(\d{2})$/;
  var UI = 'ptt.work.v1';
  var IDLE_MS = 60000;

  /* ---------- days ---------- */

  function keyOf(day) { return PREFIX + day.replace(/-/g, ''); }
  function dayOfKey(k) {
    var m = KEY_RE.exec(k);
    return m ? m[1] + '-' + m[2] + '-' + m[3] : null;
  }

  // The log's '2026-10-10 00:40' as the working day it belongs to
  function dayOfStamp(at) {
    var m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/.exec(at || '');
    if (!m) return null;
    return Notes.dayOf(new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
  }

  // What was finished on `day`, in the order it was finished
  function finishedOn(entries, day) {
    return (entries || []).filter(function (e) {
      return e.event === 'done' && dayOfStamp(e.at) === day;
    }).map(function (e) {
      return { title: e.title, parent: e.parent || '', time: e.at.slice(11, 16) };
    });
  }

  function lineFor(f) { return '- ' + (f.parent ? f.parent + ' › ' : '') + f.title; }

  // Already in the page, as its own line
  function logged(text, f) {
    var want = lineFor(f).toLowerCase();
    return String(text).split('\n').some(function (l) { return l.trim().toLowerCase() === want; });
  }

  // The month as one Markdown file, oldest day first: what you hand in. A day
  // is in it when it has a page or something was finished on it.
  function monthMarkdown(month, read, entries) {
    var first = Notes.dateOf(month + '-01'), out = [];
    out.push('# Work log — ' + first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }), '');
    var d = new Date(first), any = false;
    while (d.getMonth() === first.getMonth()) {
      var day = TT.isoOf(d), text = read(day).replace(/\s+$/, ''), done = finishedOn(entries, day);
      if (text.trim() || done.length) {
        any = true;
        out.push('## ' + d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }), '');
        if (text.trim()) out.push(text, '');
        var extra = done.filter(function (f) { return !logged(text, f); });
        if (extra.length) {
          out.push('Finished:', '');
          extra.forEach(function (f) { out.push(lineFor(f)); });
          out.push('');
        }
      }
      d.setDate(d.getDate() + 1);
    }
    if (!any) out.push('_Nothing logged this month._');
    return out.join('\n') + '\n';
  }

  /* ---------- what is kept ---------- */

  function read(day) {
    var v = null;
    try { v = Store.getItem(keyOf(day)); } catch (e) {}
    return v === null ? '' : v;
  }

  function all() {
    return Store.keys(PREFIX).map(function (k) {
      return { day: dayOfKey(k), text: read(dayOfKey(k)) };
    }).filter(function (n) { return n.day && n.text.trim(); }).sort(function (a, b) {
      return a.day < b.day ? 1 : -1;
    });
  }

  function entries() { return global.Log && Log.all ? Log.all() : []; }

  /* ---------- the panel ---------- */

  var opts = {}, root = null, ed = null, head = null, side = null, extra = null;
  var today = null, current = null, lastInput = 0, sideTimer = null;
  var ui = { side: false, notes: false };

  function esc(s) { return Views.esc(s); }

  function build() {
    root = document.createElement('div');
    root.className = 'work';
    root.innerHTML =
      '<div class="work-main">' +
        '<div class="work-col">' +
          '<div class="work-head"></div>' +
          '<textarea class="work-ed" spellcheck="true" autocomplete="off" placeholder="' +
            esc('What did you work on today?\n\n- Reviewed the Vega export\n- Call with Anna about the API keys') + '"></textarea>' +
          '<div class="work-extra"></div>' +
        '</div>' +
      '</div>' +
      '<aside class="work-side"></aside>';
    head = root.querySelector('.work-head');
    ed = root.querySelector('.work-ed');
    side = root.querySelector('.work-side');
    extra = root.querySelector('.work-extra');
    ed.addEventListener('input', onInput);
    ed.addEventListener('keydown', onKeydown);
    root.addEventListener('click', onClick);
    // the notes' fold is remembered, not reset by every repaint
    root.addEventListener('toggle', function (e) {
      if (e.target.classList && e.target.classList.contains('work-notes')) {
        ui.notes = e.target.open;
        saveUI();
      }
    }, true);
  }

  function saveUI() { try { Store.setItem(UI, JSON.stringify(ui)); } catch (e) {} }

  // The page grows with what is written, and the column scrolls as a whole,
  // so the lists underneath are always just below the last line
  function grow() {
    if (!ed.isConnected) return;
    ed.style.height = 'auto';
    ed.style.height = ed.scrollHeight + 'px';
  }

  var ICON_SIDE = '<svg viewBox="0 0 16 16"><rect x="1" y="2.5" width="14" height="11" rx="1.5"/><path d="M10 2.5v11"/><path class="fill" d="M10.4 3.2h4v9.6h-4z"/></svg>';

  function paintHead() {
    var past = current !== today;
    head.innerHTML =
      '<button class="icon-btn work-step" data-work-step="-1" title="The day before">‹</button>' +
      '<h2>' + esc(Notes.longLabel(current, today)) + '</h2>' +
      '<button class="icon-btn work-step" data-work-step="1" title="The day after"' + (past ? '' : ' disabled') + '>›</button>' +
      (past ? '<button class="link" data-work-day="' + today + '">back to today</button>'
            : '<span class="notes-today">today</span>') +
      '<span class="spacer-flex"></span>' +
      '<button class="icon-btn notes-side-btn' + (ui.side ? ' on' : '') + '" data-work-side aria-pressed="' + ui.side + '"' +
        ' title="' + (ui.side ? 'Hide' : 'Show') + ' the days">' + ICON_SIDE + '</button>';
    root.classList.toggle('side-open', ui.side);
  }

  function paintExtra() {
    var done = finishedOn(entries(), current), text = ed.value, html = '';
    html += '<section class="work-done"><div class="notes-sub">Finished' +
      (done.length ? ' <b>' + done.length + '</b>' : '') +
      (done.some(function (f) { return !logged(text, f); })
        ? '<button class="link" data-work-add="all" title="Copy every one not yet in the page into it">add all</button>' : '') +
      '</div>';
    if (!done.length) html += '<div class="work-none">No todos were finished on this day.</div>';
    else {
      html += '<ul>' + done.map(function (f, i) {
        var has = logged(text, f);
        return '<li' + (has ? ' class="in"' : '') + '><span class="work-time">' + esc(f.time) + '</span>' +
          '<span class="work-title">' + (f.parent ? '<span class="muted">' + esc(f.parent) + ' › </span>' : '') + esc(f.title) + '</span>' +
          (has ? '<span class="work-in" title="Already in the page">✓</span>'
               : '<button class="work-add" data-work-add="' + i + '" title="Copy into the page">+</button>') + '</li>';
      }).join('') + '</ul>';
    }
    html += '</section>';

    var notes = Notes.sections(Notes.read(current));
    if (notes.length) {
      html += '<details class="work-notes"' + (ui.notes ? ' open' : '') + '><summary>Notes <b>' + notes.length + '</b>' +
        '<button class="link" data-work-notes title="Open this day in Notes">open in Notes</button></summary>' +
        notes.map(function (s) {
          var body = s.body.join('\n').replace(/^\n+|\s+$/g, '');
          return '<div class="work-note"><div class="work-note-h">' + Notes.titleHTML(s, []) + '</div>' +
            (body ? '<pre>' + esc(body) + '</pre>' : '') + '</div>';
        }).join('') + '</details>';
    }
    extra.innerHTML = html;
  }

  function paintSide() {
    var days = all(), month = null, html = '';
    [today, current].forEach(function (d) {
      if (d && !days.some(function (n) { return n.day === d; })) days.push({ day: d, text: '' });
    });
    days.sort(function (a, b) { return a.day < b.day ? 1 : -1; });
    days.forEach(function (n) {
      var m = n.day.slice(0, 7);
      if (m !== month) {
        month = m;
        html += '<div class="notes-sub">' + esc(Notes.dateOf(m + '-01').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })) + '</div>';
      }
      var first = n.text.split('\n').filter(function (l) { return l.trim(); })[0] || '';
      html += '<button class="work-day' + (n.day === current ? ' here' : '') + '" data-work-day="' + n.day + '">' +
        '<b>' + esc(Notes.shortLabel(n.day, today)) + '</b>' +
        (first ? '<span>' + esc(first.replace(/^\s*[-*+]\s+/, '').slice(0, 60)) + '</span>' : '') + '</button>';
    });
    side.innerHTML = html;
  }

  function paint() {
    paintHead();
    paintExtra();
    paintSide();
    grow();
  }

  /* ---------- editing ---------- */

  function open(day) {
    if (day > today) return;
    if (day !== current) {
      current = day;
      ed.value = read(day);
    }
    paint();
  }

  function save() {
    var k = keyOf(current), v = ed.value;
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
    grow();
    clearTimeout(sideTimer);
    sideTimer = setTimeout(function () { paintSide(); paintExtra(); }, 300);
  }

  // Finished todos go in as lines at the end of the page — typed in, so Ctrl+Z
  // takes them back out
  function add(which) {
    var done = finishedOn(entries(), current), text = ed.value;
    var pick = which === 'all' ? done : [done[+which]];
    var lines = pick.filter(function (f) { return f && !logged(text, f); }).map(lineFor);
    if (!lines.length) return;
    var str = (text && !/\n$/.test(text) ? '\n' : '') + lines.join('\n') + '\n';
    ed.focus();
    ed.setSelectionRange(text.length, text.length);
    if (!typeIn(str) || ed.value === text) ed.value = text + str;
    onInput();
    paintExtra();
  }

  function onKeydown(e) {
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

  function onClick(e) {
    var t = e.target.closest ? e.target : null;
    if (!t) return;
    var el;
    if ((el = t.closest('[data-work-side]'))) { ui.side = !ui.side; saveUI(); return paintHead(); }
    if ((el = t.closest('[data-work-step]'))) return open(Notes.shiftDay(current, +el.getAttribute('data-work-step')));
    if ((el = t.closest('[data-work-add]'))) return add(el.getAttribute('data-work-add'));
    if ((el = t.closest('[data-work-notes]'))) {
      e.preventDefault();   // a button in a summary would also fold it
      if (opts.openNotes) opts.openNotes(current);
      return;
    }
    if ((el = t.closest('[data-work-day]'))) { open(el.getAttribute('data-work-day')); ed.focus(); }
  }

  /* ---------- the day turning over ---------- */

  function tick(now) {
    var d = Notes.dayOf(now || new Date());
    if (d === today) return;
    if (current === today) {
      if ((now ? now.getTime() : Date.now()) - lastInput < IDLE_MS) return;
      today = d;
      current = null;
      open(d);
    } else {
      today = d;
      paint();
    }
  }

  /* ---------- another device ---------- */

  function onRemote(keys) {
    if (!root) return;
    if (keys.indexOf(keyOf(current)) !== -1) {
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
    if (keys.some(function (k) { return k.indexOf(PREFIX) === 0; })) paint();
  }

  /* ---------- wiring ---------- */

  function init(o) {
    opts = o || {};
    today = Notes.dayOf(new Date());
    try {
      var saved = JSON.parse(Store.getItem(UI) || '{}');
      ui.side = !!saved.side;
      ui.notes = !!saved.notes;
    } catch (e) {}
    Store.keys(PREFIX).forEach(function (k) { Store.guard(k); });
    build();
    current = null;
    open(today);
    setInterval(function () { tick(); }, 30000);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') tick();
    });
  }

  // Same element every time: the stage gives it room, and it repaints only
  // what is around the page
  function mount(stage) {
    if (!root) return;
    if (root.parentNode !== stage) {
      stage.innerHTML = '';
      stage.appendChild(root);
    }
    paint();
  }

  global.Worklog = {
    PREFIX: PREFIX,
    keyOf: keyOf, dayOfKey: dayOfKey, dayOfStamp: dayOfStamp, finishedOn: finishedOn,
    logged: logged, monthMarkdown: monthMarkdown,
    // the month on screen, ready to hand in
    exportMonth: function () {
      var month = (current || today).slice(0, 7);
      return { name: 'work-log-' + month + '.md', text: monthMarkdown(month, read, entries()) };
    },
    all: all, init: init, mount: mount, open: open, tick: tick, onRemote: onRemote,
    focus: function () { if (ed) ed.focus(); },
    editor: function () { return ed; },
    day: function () { return current; },
    today: function () { return today; },
    sideOpen: function () { return ui.side; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
