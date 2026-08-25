/* Pomodoro timer.

   Two layers, deliberately separate:

   - a clock with no opinions about the DOM. It never counts ticks; it stores
     the wall-clock moment the interval ends and subtracts. A tab that was
     asleep, throttled or reloaded comes back with the right number, because the
     number was never being accumulated in the first place.

   - a chip at the end of the status bar. It is always there, because a timer
     you have to go and look at is a timer you forget. Idle, it is a hollow ring
     and a duration with no box around it. Running, it fills the ring and takes
     the colour of the phase, and the count also goes into the browser tab so it
     is legible from another window. Nothing about it blinks or interrupts. */
(function (global) {
  'use strict';

  var KEY = 'ptt.pomo.v1';
  var MIN = 60000;

  var DEFAULTS = {
    work: 25,          // minutes
    short: 5,
    long: 15,
    rounds: 4,         // focus sessions before the long break
    autoBreak: true,   // a break should not need permission to start
    autoWork: false,   // coming back from one should
    chime: true,
    inTitle: true,
    log: true
  };

  // Ranges wide enough for the timings people actually argue about — 52/17,
  // 90-minute deep work, 15/3 for a bad day — and narrow enough that a typo
  // cannot leave the timer in a state you have to reload out of.
  var LIMITS = { work: [1, 180], short: [1, 60], long: [1, 120], rounds: [1, 12] };

  var PRESETS = [
    { name: 'Classic', work: 25, short: 5, long: 15, rounds: 4 },
    { name: 'Long haul', work: 50, short: 10, long: 30, rounds: 3 },
    { name: 'Short fuse', work: 15, short: 3, long: 12, rounds: 4 }
  ];

  var PHASE_NAME = { work: 'Focus', short: 'Short break', long: 'Long break' };

  /* ---------- the clock ---------- */

  function clampNum(v, range, fallback) {
    v = Math.round(Number(v));
    if (!isFinite(v)) return fallback;
    return Math.min(range[1], Math.max(range[0], v));
  }

  function normalize(cfg) {
    var out = {}, k;
    for (k in DEFAULTS) if (Object.prototype.hasOwnProperty.call(DEFAULTS, k)) {
      var given = cfg && cfg[k] !== undefined ? cfg[k] : DEFAULTS[k];
      out[k] = LIMITS[k] ? clampNum(given, LIMITS[k], DEFAULTS[k]) : !!given;
    }
    return out;
  }

  function make(cfg) {
    return {
      cfg: normalize(cfg),
      phase: 'work',
      round: 1,          // which focus session of the set this is
      done: 0,           // focus sessions finished since the counter was reset
      running: false,
      endsAt: null,      // absolute ms while running
      left: null,        // ms banked while paused
      task: '',          // what you said you were working on when you started
      today: { day: '', n: 0, min: 0 }   // sessions finished today, and their minutes
    };
  }

  function dayOf(now) {
    var d = new Date(now);
    return d.getFullYear() + '-' + (d.getMonth() < 9 ? '0' : '') + (d.getMonth() + 1) +
      '-' + (d.getDate() < 10 ? '0' : '') + d.getDate();
  }

  // The tally is kept here rather than counted out of the log, because the log
  // is something you can switch off and the count should hold either way. It
  // rolls over on its own: a stamp from another day reads as nothing yet today.
  function today(s, now) {
    var t = s.today || (s.today = { day: '', n: 0, min: 0 });
    return t.day === dayOf(now) ? t : { day: dayOf(now), n: 0, min: 0 };
  }

  function countToday(s, now, minutes) {
    var t = today(s, now);
    s.today = { day: t.day, n: t.n + 1, min: t.min + minutes };
  }

  function duration(s) { return s.cfg[s.phase] * MIN; }

  function remaining(s, now) {
    if (s.running) return Math.max(0, s.endsAt - now);
    return s.left === null ? duration(s) : Math.max(0, s.left);
  }

  function progress(s, now) {
    var total = duration(s);
    return total ? 1 - remaining(s, now) / total : 0;
  }

  function start(s, now) {
    if (s.running) return s;
    s.endsAt = now + remaining(s, now);
    s.left = null;
    s.running = true;
    return s;
  }

  function pause(s, now) {
    if (!s.running) return s;
    s.left = remaining(s, now);
    s.running = false;
    s.endsAt = null;
    return s;
  }

  function toggle(s, now) { return s.running ? pause(s, now) : start(s, now); }

  // Back to the top of the interval you are in, without changing which one.
  function reset(s) {
    s.running = false;
    s.endsAt = null;
    s.left = null;
    return s;
  }

  // Work runs to the long break through `rounds` sessions; a long break sends
  // you back to the first. Skipping counts as taking the interval, because the
  // alternative is a counter that only moves when you sit still.
  function nextPhase(s) {
    if (s.phase !== 'work') return { phase: 'work', round: s.phase === 'long' ? 1 : s.round + 1 };
    return s.round >= s.cfg.rounds ? { phase: 'long', round: s.round } : { phase: 'short', round: s.round };
  }

  function advance(s, now, natural) {
    var was = s.phase;
    var next = nextPhase(s);
    if (was === 'work' && natural) { s.done++; countToday(s, now, s.cfg.work); }
    s.phase = next.phase;
    s.round = next.round;
    reset(s);
    if (s.phase === 'work' ? s.cfg.autoWork : s.cfg.autoBreak) start(s, now);
    return was;
  }

  function skip(s, now) { return advance(s, now, false); }

  // Called as often as you like. Returns the phase that just ran out, or null.
  function tick(s, now) {
    if (!s.running || remaining(s, now) > 0) return null;
    return advance(s, now, true);
  }

  function format(ms) {
    var total = Math.ceil(Math.max(0, ms) / 1000);
    var m = Math.floor(total / 60), sec = total % 60;
    return m + ':' + (sec < 10 ? '0' : '') + sec;
  }

  /* ---------- persistence ---------- */

  function read() {
    try {
      var raw = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (!raw) return make();
      var s = make(raw.cfg);
      s.phase = PHASE_NAME[raw.phase] ? raw.phase : 'work';
      s.round = clampNum(raw.round, [1, s.cfg.rounds], 1);
      s.done = clampNum(raw.done, [0, 9999], 0);
      s.task = typeof raw.task === 'string' ? raw.task : '';
      if (raw.today && typeof raw.today.day === 'string') {
        s.today = { day: raw.today.day, n: clampNum(raw.today.n, [0, 9999], 0), min: clampNum(raw.today.min, [0, 99999], 0) };
      }
      // A running timer survives a reload because the end is an absolute moment,
      // not a countdown someone has to keep feeding.
      if (raw.running && typeof raw.endsAt === 'number') { s.running = true; s.endsAt = raw.endsAt; }
      else if (typeof raw.left === 'number') s.left = raw.left;
      return s;
    } catch (e) { return make(); }
  }

  function write(s) {
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {}
  }

  /* ---------- the chip ---------- */

  var ui = null;

  var RING = '<svg class="pomo-ring" viewBox="0 0 24 24" aria-hidden="true">' +
    '<circle class="track" cx="12" cy="12" r="9.5"/>' +
    '<circle class="fill" cx="12" cy="12" r="9.5"/></svg>';

  function el(html) {
    var d = document.createElement('div');
    d.innerHTML = html;
    return d.firstElementChild;
  }

  function num(name, label, range) {
    return '<label class="pomo-field"><span>' + label + '</span>' +
      '<input type="number" data-cfg="' + name + '" min="' + range[0] + '" max="' + range[1] + '" step="1"></label>';
  }

  function check(name, label, note) {
    return '<label class="pomo-check"><input type="checkbox" data-cfg="' + name + '">' +
      '<span><b>' + label + '</b>' + (note ? '<i>' + note + '</i>' : '') + '</span></label>';
  }

  function chipHTML() {
    return '<div class="pomo" data-phase="work">' +
      '<button class="pomo-face" data-pomo="toggle" tabindex="-1">' + RING +
        '<span class="pomo-time">0:00</span></button>' +
      '<span class="pomo-dots" aria-hidden="true"></span>' +
      '<span class="pomo-tools">' +
        '<button class="pomo-mini" data-pomo="skip" tabindex="-1" title="Skip to the next interval">' +
          '<svg viewBox="0 0 16 16"><path d="M4 3.5v9l6-4.5zM11.5 3.5v9"/></svg></button>' +
        '<button class="pomo-mini" data-pomo="reset" tabindex="-1" title="Back to the start of this interval">' +
          '<svg viewBox="0 0 16 16"><path d="M13 8a5 5 0 1 1-1.6-3.7M12.8 2.2v2.9h-2.9"/></svg></button>' +
        '<button class="pomo-mini" data-pomo="config" tabindex="-1" title="Timer settings" aria-haspopup="true" aria-expanded="false">' +
          '<svg class="cog" viewBox="0 0 24 24"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg></button>' +
      '</span>' +
      '<div class="pomo-pop" hidden>' +
        '<div class="menu-label">Intervals</div>' +
        '<div class="pomo-grid">' +
          num('work', 'Focus', LIMITS.work) +
          num('short', 'Short break', LIMITS.short) +
          num('long', 'Long break', LIMITS.long) +
          num('rounds', 'Long break every', LIMITS.rounds) +
        '</div>' +
        '<div class="pomo-presets">' + PRESETS.map(function (p, i) {
          return '<button data-preset="' + i + '">' + p.name + '<i>' + p.work + '/' + p.short + '</i></button>';
        }).join('') + '</div>' +
        '<div class="menu-sep"></div>' +
        '<div class="menu-label">Behaviour</div>' +
        check('autoBreak', 'Start breaks automatically', 'stopping is the part people skip') +
        check('autoWork', 'Start the next focus session too', 'off means a break ends when you say so') +
        check('chime', 'Chime when an interval ends') +
        check('inTitle', 'Count down in the browser tab') +
        check('log', 'Record finished sessions in the log') +
        '<div class="menu-sep"></div>' +
        '<button class="pomo-restore" data-pomo="defaults">Restore defaults</button>' +
      '</div>' +
    '</div>';
  }

  // A chime built out of nothing, because the app ships no files.
  function chime(phase) {
    var Ctx = global.AudioContext || global.webkitAudioContext;
    if (!Ctx) return;
    try {
      var ac = ui && ui.audio ? ui.audio : (ui ? (ui.audio = new Ctx()) : new Ctx());
      if (ac.state === 'suspended') ac.resume();
      // work ends on a rising pair, a break ends on a single lower note
      var notes = phase === 'work' ? [660, 880] : [520];
      notes.forEach(function (hz, i) {
        var t = ac.currentTime + i * 0.16;
        var osc = ac.createOscillator(), gain = ac.createGain();
        osc.type = 'sine';
        osc.frequency.value = hz;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.13, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
        osc.connect(gain).connect(ac.destination);
        osc.start(t);
        osc.stop(t + 0.45);
      });
    } catch (e) {}
  }

  function dots(s) {
    var out = '';
    for (var i = 1; i <= s.cfg.rounds; i++) {
      out += '<i class="' + (i < s.round ? 'past' : i === s.round ? 'at' : '') + '"></i>';
    }
    return out;
  }

  /* ---------- the full view ---------- */
  /* The same clock, given the room to be read from across the desk. It is one
     column down the middle of an otherwise empty page: ring, time, phase, and
     what today came to. No panel, no border, no card — the less there is on it,
     the less it asks of you while you are meant to be working on something
     else. Every control here is the one already in the status bar. */

  var BIG_RING = '<svg class="pv-ring" viewBox="0 0 120 120" aria-hidden="true">' +
    '<circle class="track" cx="60" cy="60" r="54"/>' +
    '<circle class="fill" cx="60" cy="60" r="54"/></svg>';

  function panelHTML() {
    return '<div class="pomo-view" data-phase="work">' +
      '<button class="pv-face" data-pomo="toggle">' + BIG_RING +
        '<span class="pv-time">0:00</span></button>' +
      '<div class="pv-phase"><span class="pv-name">Focus</span><span class="pv-dots"></span></div>' +
      '<div class="pv-task"></div>' +
      '<div class="pv-actions">' +
        '<button class="link" data-pomo="toggle">Start</button>' +
        '<button class="link" data-pomo="reset">Restart</button>' +
        '<button class="link" data-pomo="skip">Skip</button>' +
      '</div>' +
      '<div class="pv-today"></div>' +
    '</div>';
  }

  function tally(s, now) {
    var t = today(s, now);
    if (!t.n) return 'Nothing finished yet today';
    return '<b>' + t.n + '</b> pomodoro' + (t.n === 1 ? '' : 's') + ' today' +
      (t.min ? ' <span>·</span> ' + t.min + ' min' : '');
  }

  function paintPanel(now) {
    var v = document.querySelector('.pomo-view');
    if (!v) return;
    var s = ui.state, text = format(remaining(s, now));
    v.dataset.phase = s.phase;
    v.classList.toggle('running', s.running);
    v.classList.toggle('idle', !s.running && s.left === null);
    var time = v.querySelector('.pv-time');
    if (time.textContent !== text) time.textContent = text;
    v.querySelector('.pv-ring .fill').style.strokeDashoffset = String(340 * (1 - progress(s, now)));
    v.querySelector('.pv-name').textContent = PHASE_NAME[s.phase];
    var d = dots(s), dotsEl = v.querySelector('.pv-dots');
    if (dotsEl.innerHTML !== d) dotsEl.innerHTML = d;
    var task = s.phase === 'work' && s.task ? s.task : '';
    var taskEl = v.querySelector('.pv-task');
    if (taskEl.textContent !== task) taskEl.textContent = task;
    var start = v.querySelector('.pv-actions [data-pomo="toggle"]');
    var word = s.running ? 'Pause' : s.left === null ? 'Start' : 'Resume';
    if (start.textContent !== word) start.textContent = word;
    var t = tally(s, now), tEl = v.querySelector('.pv-today');
    if (tEl.innerHTML !== t) tEl.innerHTML = t;
  }

  function label(s, now) {
    var left = format(remaining(s, now));
    if (!s.running && s.left === null) return PHASE_NAME[s.phase] + ' — ' + left + ', click to start (Ctrl+;)';
    if (!s.running) return PHASE_NAME[s.phase] + ' paused at ' + left + ' — click to resume';
    return PHASE_NAME[s.phase] + ' — ' + left + ' left' + (s.task ? ' on “' + s.task + '”' : '') + ', click to pause';
  }

  function paint(now) {
    if (!ui) return;
    var s = ui.state;
    var left = remaining(s, now);
    var text = format(left);
    ui.root.dataset.phase = s.phase;
    ui.root.classList.toggle('running', s.running);
    ui.root.classList.toggle('idle', !s.running && s.left === null);
    if (ui.time.textContent !== text) ui.time.textContent = text;
    ui.ring.style.strokeDashoffset = String(60 * (1 - progress(s, now)));
    ui.face.title = label(s, now);
    ui.face.setAttribute('aria-label', ui.face.title);
    var d = dots(s);
    if (ui.dots.innerHTML !== d) ui.dots.innerHTML = d;

    paintPanel(now);

    var base = ui.baseTitle;
    var want = s.cfg.inTitle && s.running ? text + ' · ' + PHASE_NAME[s.phase] + ' · ' + base : base;
    if (document.title !== want) document.title = want;
  }

  function finished(phase, now) {
    var s = ui.state;
    if (s.cfg.chime) chime(phase);
    if (phase === 'work' && s.cfg.log && global.Log && global.Log.record) {
      global.Log.record({
        event: 'focus',
        title: s.task || 'Focus session',
        minutes: s.cfg.work
      });
    }
    if (ui.onFinish) ui.onFinish(phase, s);
  }

  function step() {
    if (!ui) return;
    var now = Date.now();
    var over = tick(ui.state, now);
    if (over) { finished(over, now); write(ui.state); }
    paint(now);
  }

  function commit(now) {
    write(ui.state);
    paint(now === undefined ? Date.now() : now);
  }

  // Starting a focus session pins whatever you said you were working on, so the
  // log entry can say what the time went to rather than just that it went.
  function bindTask() {
    if (!ui || !ui.taskOf) return;
    ui.state.task = String(ui.taskOf() || '');
  }

  function act(name) {
    var now = Date.now();
    var s = ui.state;
    if (name === 'toggle') {
      if (!s.running && s.phase === 'work') bindTask();
      toggle(s, now);
      return commit(now);
    }
    if (name === 'skip') { skip(s, now); return commit(now); }
    if (name === 'reset') { reset(s); return commit(now); }
    if (name === 'config') return openConfig(!ui.pop.hidden ? false : true);
    if (name === 'defaults') {
      s.cfg = normalize(null);
      fillConfig();
      return commit(now);
    }
  }

  function fillConfig() {
    var s = ui.state;
    Array.prototype.forEach.call(ui.pop.querySelectorAll('[data-cfg]'), function (input) {
      var k = input.dataset.cfg;
      if (input.type === 'checkbox') input.checked = !!s.cfg[k];
      else input.value = s.cfg[k];
    });
  }

  function openConfig(on) {
    ui.pop.hidden = !on;
    ui.root.classList.toggle('open', !!on);
    ui.root.querySelector('[data-pomo="config"]').setAttribute('aria-expanded', String(!!on));
    if (on) fillConfig();
  }

  function readConfig() {
    var s = ui.state, changed = false;
    Array.prototype.forEach.call(ui.pop.querySelectorAll('[data-cfg]'), function (input) {
      var k = input.dataset.cfg;
      var v = input.type === 'checkbox' ? input.checked : clampNum(input.value, LIMITS[k], DEFAULTS[k]);
      if (s.cfg[k] !== v) { s.cfg[k] = v; changed = true; }
      if (input.type !== 'checkbox') input.value = s.cfg[k];
    });
    if (!changed) return;
    if (s.round > s.cfg.rounds) s.round = s.cfg.rounds;
    // a length you changed applies to the interval you are in, but only if it
    // has not started — rewriting a running clock underneath you is a magic trick
    if (!s.running && s.left === null) reset(s);
    commit();
  }

  function init(opts) {
    opts = opts || {};
    var host = opts.mount || document.querySelector('.topbar');
    if (!host) return null;
    var root = el(chipHTML());
    if (opts.before && opts.before.parentNode === host) host.insertBefore(root, opts.before);
    else host.appendChild(root);

    ui = {
      root: root,
      face: root.querySelector('.pomo-face'),
      time: root.querySelector('.pomo-time'),
      ring: root.querySelector('.pomo-ring .fill'),
      dots: root.querySelector('.pomo-dots'),
      pop: root.querySelector('.pomo-pop'),
      state: read(),
      baseTitle: document.title,
      taskOf: opts.taskOf,
      onFinish: opts.onFinish,
      audio: null
    };
    ui.ring.style.strokeDasharray = '60';   // 2πr for r=9.5, rounded up

    // one handler for every face of the timer: the chip, its settings panel, and
    // the full view, which is rendered and thrown away on each render()
    document.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-pomo],[data-preset]') : null;
      if (!b) return;
      e.preventDefault();
      if (b.dataset.preset !== undefined) {
        var p = PRESETS[+b.dataset.preset];
        ['work', 'short', 'long', 'rounds'].forEach(function (k) { ui.state.cfg[k] = p[k]; });
        fillConfig();
        if (!ui.state.running && ui.state.left === null) reset(ui.state);
        return commit();
      }
      act(b.dataset.pomo);
    });
    root.addEventListener('change', function (e) { if (e.target.dataset.cfg) readConfig(); });
    root.addEventListener('input', function (e) { if (e.target.type === 'checkbox' && e.target.dataset.cfg) readConfig(); });
    document.addEventListener('click', function (e) {
      if (!ui.pop.hidden && !e.target.closest('.pomo')) openConfig(false);
    });
    document.addEventListener('visibilitychange', step);

    ui.timer = setInterval(step, 250);
    paint(Date.now());
    return ui;
  }

  global.Pomodoro = {
    DEFAULTS: DEFAULTS, LIMITS: LIMITS, PRESETS: PRESETS, PHASE_NAME: PHASE_NAME, KEY: KEY,
    make: make, normalize: normalize, duration: duration, remaining: remaining, progress: progress,
    today: today, dayOf: dayOf, panelHTML: panelHTML,
    start: start, pause: pause, toggle: toggle, reset: reset, skip: skip, tick: tick,
    nextPhase: nextPhase, format: format, read: read, write: write,
    init: init, act: act, step: step, openConfig: openConfig,
    state: function () { return ui && ui.state; },
    el: function () { return ui && ui.root; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
