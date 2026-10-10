/* Reminders — log today's work, copy today's notes.

   Two of them, each switched on and timed in the settings menu. At its time on
   a workday (Monday to Friday, by the 02:00 day the pages use) a reminder does
   two things:

   - a browser notification, for when the app is in a tab behind something else;
   - a red marker that stays: a pill at the left of the status bar and a dot on
     the tab it is about. A notification is gone in seconds and easy to swat
     away; the marker is not. It goes when you open that tab, click the pill,
     or press its ×.

   A reminder only fires when it has something to say: the work one when today's
   Work page is still empty, the notes one when there are notes today. It fires
   once a day, and only while the app is open in a tab — there is no server
   pushing anything. Opened after its time, it fires then.

   Browsers only allow notifications on a secure origin: localhost or https.
   Over plain http on the LAN only the marker shows; the settings say so. */
(function (global) {
  'use strict';

  var KEY = 'ptt.remind.v1';
  var KINDS = {
    work: {
      label: 'Log today’s work', view: 'work', time: '17:30',
      body: 'Write down what you did today, before the day is over.'
    },
    notes: {
      label: 'Copy today’s notes', view: 'notes', time: '17:45',
      body: 'Today’s notes are waiting to be copied where they need to go.'
    }
  };
  var ORDER = ['work', 'notes'];

  var cfg = null, opts = {}, slot = null;
  var clock = function () { return new Date(); };   // the tests set their own

  function blank() {
    return {
      work: { on: false, time: KINDS.work.time },
      notes: { on: false, time: KINDS.notes.time },
      fired: {}, pending: {}
    };
  }

  function load() {
    cfg = blank();
    try {
      var saved = JSON.parse(Store.getItem(KEY) || '{}');
      ORDER.forEach(function (k) {
        if (saved[k]) {
          cfg[k].on = !!saved[k].on;
          if (/^\d{2}:\d{2}$/.test(saved[k].time)) cfg[k].time = saved[k].time;
        }
      });
      cfg.fired = saved.fired || {};
      cfg.pending = saved.pending || {};
    } catch (e) {}
  }

  function save() { try { Store.setItem(KEY, JSON.stringify(cfg)); } catch (e) {} }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function workday(day) {
    var wd = Notes.dateOf(day).getDay();
    return wd >= 1 && wd <= 5;
  }

  // Is there something to remind about?
  function needed(kind, day) {
    if (kind === 'work') return !String(Store.getItem(Worklog.keyOf(day)) || '').trim();
    if (kind === 'notes') return !!Notes.read(day).trim();
    return false;
  }

  // The reminders that should go off at `now`: switched on, a workday, past
  // their time, not yet fired today, and with something to say. A time is read
  // on the clock; before 02:00 it is still yesterday's day, whose reminders
  // had their chance.
  function due(c, now, need) {
    var day = Notes.dayOf(now), at = pad(now.getHours()) + ':' + pad(now.getMinutes());
    if (!workday(day) || now.getHours() < 2) return [];
    return ORDER.filter(function (k) {
      return c[k].on && at >= c[k].time && c.fired[k] !== day && need(k, day);
    });
  }

  /* ---------- going off ---------- */

  function available() { return 'Notification' in global && global.isSecureContext !== false; }

  function notify(kind) {
    if (!available() || global.Notification.permission !== 'granted') return;
    try {
      var n = new global.Notification(KINDS[kind].label, { body: KINDS[kind].body, tag: 'ptt-' + kind });
      n.onclick = function () {
        try { global.focus(); } catch (e) {}
        go(kind);
        n.close();
      };
    } catch (e) {}
  }

  function check(now) {
    if (!cfg) return [];
    now = now || clock();
    var fire = due(cfg, now, needed), day = Notes.dayOf(now);
    fire.forEach(function (k) {
      cfg.fired[k] = day;
      cfg.pending[k] = day;
    });
    if (fire.length) {
      save();
      fire.forEach(notify);
    }
    paint();
    return fire;
  }

  // A marker belongs to the day it went off on; tomorrow it is old news
  function pending(now) {
    var day = Notes.dayOf(now || clock());
    return ORDER.filter(function (k) { return cfg && cfg.pending[k] === day; });
  }

  function clear(kind) {
    if (!cfg || !cfg.pending[kind]) return;
    delete cfg.pending[kind];
    save();
    paint();
  }

  function go(kind) {
    clear(kind);
    if (opts.show) opts.show(KINDS[kind].view);
  }

  // Opening the tab is doing what the reminder asked
  function seen(view) {
    ORDER.forEach(function (k) { if (KINDS[k].view === view) clear(k); });
  }

  /* ---------- the marker ---------- */

  function paint() {
    if (!slot) return;
    var p = pending();
    slot.innerHTML = p.map(function (k) {
      return '<span class="remind-pill">' +
        '<button data-remind-go="' + k + '" title="Go there">' + KINDS[k].label + '</button>' +
        '<button data-remind-x="' + k + '" class="remind-x" title="Dismiss">×</button></span>';
    }).join('');
    var views = p.map(function (k) { return KINDS[k].view; });
    Array.prototype.forEach.call(document.querySelectorAll('.tabs [data-view], .tb-pop [data-view]'), function (t) {
      t.classList.toggle('remind', views.indexOf(t.dataset.view) !== -1);
    });
    // a tab folded into More hands its dot to the More button
    var more = document.querySelector('.more-btn');
    if (more) {
      more.classList.toggle('remind', views.some(function (v) {
        var t = document.querySelector('.tabs > [data-view="' + v + '"]');
        return t && t.hidden;
      }));
    }
  }

  /* ---------- the settings ---------- */

  function hint() {
    if (!available()) return 'This page cannot send notifications (that needs localhost or https), so only the red marker will show.';
    var p = global.Notification.permission;
    if (p === 'denied') return 'Notifications are blocked for this site, so only the red marker will show.';
    return 'While the app is open in a tab.';
  }

  function paintSettings() {
    ORDER.forEach(function (k) {
      var box = document.querySelector('[data-remind="' + k + '"]');
      var time = document.querySelector('[data-remind-time="' + k + '"]');
      if (box) box.checked = cfg[k].on;
      if (time) { time.value = cfg[k].time; time.disabled = !cfg[k].on; }
    });
    var h = document.getElementById('remind-hint');
    if (h) h.textContent = hint();
  }

  function ask() {
    if (!available() || global.Notification.permission !== 'default') return;
    try {
      var r = global.Notification.requestPermission(paintSettings);
      if (r && r.then) r.then(paintSettings);
    } catch (e) {}
  }

  function onSetting(e) {
    var el = e.target;
    var k = el.getAttribute && (el.getAttribute('data-remind') || el.getAttribute('data-remind-time'));
    if (!k || !KINDS[k]) return;
    if (el.hasAttribute('data-remind')) {
      cfg[k].on = el.checked;
      if (el.checked) ask();   // a click is the moment a browser lets a page ask
    } else if (/^\d{2}:\d{2}$/.test(el.value)) {
      cfg[k].time = el.value;
      // a new time is a new reminder: today's may still go off, at the new time
      if (cfg.fired[k] === Notes.dayOf(clock())) delete cfg.fired[k];
    }
    save();
    paintSettings();
    check();
  }

  function onClick(e) {
    var el = e.target.closest ? e.target.closest('[data-remind-go],[data-remind-x]') : null;
    if (!el) return;
    if (el.hasAttribute('data-remind-go')) go(el.getAttribute('data-remind-go'));
    else clear(el.getAttribute('data-remind-x'));
  }

  function init(o) {
    opts = o || {};
    slot = opts.slot || null;
    load();
    document.addEventListener('change', onSetting);
    document.addEventListener('click', onClick);
    paintSettings();
    // switched on before, in a browser that has not been asked yet
    if (ORDER.some(function (k) { return cfg[k].on; })) ask();
    check();
    setInterval(function () { check(); }, 30000);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') check();
    });
  }

  global.Reminders = {
    KINDS: KINDS,
    init: init, check: check, due: due, pending: pending, seen: seen, clear: clear,
    paint: paint, settings: function () { return cfg; },
    setClock: function (fn) { clock = fn || function () { return new Date(); }; },
    reload: function () { load(); paintSettings(); paint(); }
  };
})(typeof window !== 'undefined' ? window : globalThis);
