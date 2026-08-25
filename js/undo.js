/* Reversible actions.
   Some things cannot ride the browser's undo stack, because what they change is
   not the text: removing a log entry, say. Those are staged here instead — done
   at once, but held reversible for a grace period, so an accidental click costs
   nothing. Time is read off the clock rather than counted in ticks, so a
   throttled or sleeping tab comes back honest, the way the pomodoro does. */
(function (global) {
  'use strict';

  var GRACE = 8000;   // ms an action stays reversible

  var staged = [];    // { id, label, at, grace, expires, commit, revert }
  var listeners = [];
  var timer = null;

  function clock() { return Date.now(); }

  function find(id) {
    for (var i = 0; i < staged.length; i++) if (staged[i].id === id) return staged[i];
    return null;
  }

  function changed() {
    listeners.slice().forEach(function (fn) { try { fn(); } catch (e) {} });
  }

  function start() {
    if (timer || typeof setInterval !== 'function') return;
    timer = setInterval(function () {
      if (sweep()) changed();
    }, 250);
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  /* Stage an action that has already happened. `commit` makes it permanent once
     the grace runs out; `revert` puts the world back. Staging the same id twice
     commits the first — two versions of one truth cannot both be waiting. */
  function stage(spec) {
    if (!spec || !spec.id) return null;
    settle(spec.id);
    var at = spec.at === undefined ? clock() : spec.at;
    var grace = spec.grace === undefined ? GRACE : spec.grace;
    var item = {
      id: spec.id, label: spec.label || '', at: at, grace: grace,
      expires: at + grace, commit: spec.commit || null, revert: spec.revert || null
    };
    staged.push(item);
    start();
    return item;
  }

  /* Commit everything whose grace has run out. Takes the moment as an argument
     so a test can drive it without waiting. Returns how many were committed. */
  function sweep(at) {
    if (at === undefined) at = clock();
    var done = 0, keep = [];
    staged.forEach(function (it) {
      if (it.expires > at) { keep.push(it); return; }
      done++;
      if (it.commit) it.commit();
    });
    staged = keep;
    if (!staged.length) stop();
    return done;
  }

  // Take it back. True if there was something to take back.
  function undo(id) {
    var it = find(id);
    if (!it) return false;
    staged.splice(staged.indexOf(it), 1);
    if (!staged.length) stop();
    if (it.revert) it.revert();
    changed();
    return true;
  }

  // Make it permanent now, without waiting out the grace.
  function settle(id) {
    var done = 0;
    staged.slice().forEach(function (it) {
      if (id !== undefined && it.id !== id) return;
      staged.splice(staged.indexOf(it), 1);
      done++;
      if (it.commit) it.commit();
    });
    if (!staged.length) stop();
    return done;
  }

  // Forget it without committing or reverting — for when the thing it was
  // holding on to has gone away entirely (the whole log cleared, say).
  function drop(id) {
    var it = find(id);
    if (!it) return false;
    staged.splice(staged.indexOf(it), 1);
    if (!staged.length) stop();
    return true;
  }

  function pending() { return staged.slice(); }
  function is(id) { return !!find(id); }

  // ms left before it becomes permanent; 0 if it is not staged at all
  function remaining(id, at) {
    var it = find(id);
    if (!it) return 0;
    return Math.max(0, it.expires - (at === undefined ? clock() : at));
  }

  function onchange(fn) { if (typeof fn === 'function') listeners.push(fn); }

  global.Undo = {
    stage: stage, undo: undo, settle: settle, sweep: sweep, drop: drop,
    pending: pending, is: is, find: find, remaining: remaining,
    onchange: onchange, GRACE: GRACE
  };
})(typeof window !== 'undefined' ? window : globalThis);
