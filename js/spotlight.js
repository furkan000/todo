/* Spotlight — full-text search over every note, from anywhere.

   Ctrl+Shift+F (Ctrl+K while in Notes, or the magnifier beside the date) puts one field in
   the middle of the screen. Every word typed narrows it: a conversation is
   listed when it holds all of them, in any order, as text or as a tag, best
   matches first. Arrows move, Enter opens the conversation on the line that
   matched, Esc puts you back where you were. With nothing typed it lists the
   latest conversations, so it doubles as a way to jump back into one.

   It only reads. The search itself is Notes.search; this is the box around it. */
(function (global) {
  'use strict';

  var MAX = 50, RECENT = 10;
  var opts = {}, box = null, input = null, list = null, hits = [], sel = 0, back = null, timer = null;

  function esc(s) { return Views.esc(s); }

  function build() {
    box = document.createElement('div');
    box.className = 'spot';
    box.hidden = true;
    box.innerHTML =
      '<div class="spot-box" role="dialog" aria-label="Search notes">' +
        '<div class="spot-field">' +
          '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14"/></svg>' +
          '<input type="text" placeholder="Search all notes" spellcheck="false" autocomplete="off">' +
        '</div>' +
        '<div class="spot-list" role="listbox"></div>' +
        '<div class="spot-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span></div>' +
      '</div>';
    document.body.appendChild(box);
    input = box.querySelector('input');
    list = box.querySelector('.spot-list');
    input.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () { sel = 0; paint(); }, 60);
    });
    input.addEventListener('keydown', onKey);
    box.addEventListener('mousedown', function (e) { if (e.target === box) { e.preventDefault(); close(); } });
    list.addEventListener('click', function (e) {
      var row = e.target.closest('[data-spot]');
      if (row) choose(+row.getAttribute('data-spot'));
    });
    list.addEventListener('mousemove', function (e) {
      var row = e.target.closest('[data-spot]');
      if (row && +row.getAttribute('data-spot') !== sel) { sel = +row.getAttribute('data-spot'); mark(); }
    });
  }

  // The latest conversations: today's last one first
  function recent(notes) {
    var out = [];
    notes.forEach(function (n) {
      Notes.sections(n.text).reverse().forEach(function (s) {
        if (out.length < RECENT) out.push({ day: n.day, section: s, line: s.line, text: '' });
      });
    });
    return out;
  }

  function find(q) {
    var notes = Notes.all();
    if (!Notes.terms(q).length) return { hits: recent(notes), searching: false };
    return {
      hits: Notes.search(notes, q, Notes.vocab(notes)).sort(function (a, b) {
        return b.score - a.score || (a.day < b.day ? 1 : a.day > b.day ? -1 : 0);
      }).slice(0, MAX),
      searching: true
    };
  }

  function paint() {
    var q = input.value, r = find(q), today = Notes.today(), ts = Notes.terms(q);
    hits = r.hits;
    if (sel >= hits.length) sel = Math.max(0, hits.length - 1);
    var html = '';
    if (!hits.length) {
      html = '<div class="spot-none">' + (r.searching
        ? 'No conversation holds “' + esc(q.trim()) + '”.'
        : 'Nothing written yet.') + '</div>';
    } else if (!r.searching) html = '<div class="spot-sub">Recent</div>';
    hits.forEach(function (h, i) {
      var line = h.line !== h.section.line ? h.text
        : h.section.body.filter(function (l) { return l.trim(); })[0] || '';
      html += '<button class="spot-row" data-spot="' + i + '" role="option">' +
        '<span class="spot-t"><b>' + Notes.titleHTML(h.section, ts) + '</b>' +
        '<em>' + esc(Notes.shortLabel(h.day, today)) + '</em></span>' +
        (line.trim() ? '<span class="spot-s">' + Notes.snippet(line.trim(), ts, 120) + '</span>' : '') +
        '</button>';
    });
    list.innerHTML = html;
    mark();
  }

  function mark() {
    Array.prototype.forEach.call(list.querySelectorAll('[data-spot]'), function (row) {
      var on = +row.getAttribute('data-spot') === sel;
      row.classList.toggle('on', on);
      row.setAttribute('aria-selected', String(on));
      if (on && row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
    });
  }

  function onKey(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!hits.length) return;
      sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length;
      return mark();
    }
    if (e.key === 'Enter') { e.preventDefault(); return choose(sel); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); return close(true); }
  }

  function choose(i) {
    var h = hits[i];
    if (!h) return;
    close(false);
    if (opts.open) opts.open(h.day, h.line);
  }

  // `q` starts it with that search in the box, as a tag clicked in Notes does
  function open(q) {
    if (!box) build();
    if (typeof q === 'string') input.value = q;
    back = document.activeElement;
    box.hidden = false;
    sel = 0;
    paint();
    input.focus();
    input.select();   // the last search is still there, ready to be typed over
  }

  // `restore`: hand focus back to where it was, since nothing was opened
  function close(restore) {
    if (!box || box.hidden) return;
    box.hidden = true;
    if (restore && back && back.isConnected && back.focus) back.focus();
    back = null;
  }

  global.Spotlight = {
    init: function (o) { opts = o || {}; },
    open: open, close: close,
    isOpen: function () { return !!box && !box.hidden; },
    input: function () { return input; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
