/* Tabs you can put in your own order: press one, hold it a moment, move it.

   The hold is what tells a drag from a click. A quick press is still a click
   and opens the tab; only a press held still for HOLD_MS lifts it. A press
   that wanders off before then was neither, and is left alone. Once lifted,
   the tab follows the pointer and the others make room for it as it passes
   their middle; letting go puts it there. Esc puts it back where it was.

   Text is not a view but a layout, and stays first. The order is handed to
   `onchange` as a list of views, for the app to keep with its settings. The
   shortcuts and the folding into More read the order off the bar, so they
   follow it without being told. */
(function (global) {
  'use strict';

  var HOLD_MS = 280;
  var SLOP_PX = 6;          // how far a press may wander and still be a hold

  var opts = {}, tabs = null;
  var press = null;         // { tab, x, y, timer, id }
  var drag = null;          // { tab, start (the order before), dx }
  var swallow = false;      // the click that ends a drag is not a click

  function views() {
    return Array.prototype.map.call(tabs.querySelectorAll(':scope > [data-view]'), function (t) {
      return t.dataset.view;
    });
  }

  // Put the tabs in `order`. Views it does not name keep their place after
  // the ones it does, so a tab added later still shows up.
  function apply(order) {
    if (!tabs || !Array.isArray(order)) return;
    var anchor = tabs.querySelector(':scope > .tb-menu');
    var all = views(), seen = {};
    order.concat(all).forEach(function (v) {
      if (seen[v] || all.indexOf(v) === -1) return;
      seen[v] = true;
      tabs.insertBefore(tabs.querySelector(':scope > [data-view="' + v + '"]'), anchor);
    });
  }

  function lift() {
    var t = press.tab;
    drag = { tab: t, start: views(), id: press.id };
    press = null;
    t.classList.add('dragging');
    tabs.classList.add('reordering');
    try { t.setPointerCapture(drag.id); } catch (e) {}
  }

  // The visible tab whose middle the pointer has passed decides the place
  function moveTo(x) {
    var others = Array.prototype.filter.call(tabs.querySelectorAll(':scope > [data-view]'), function (t) {
      return t !== drag.tab && !t.hidden;
    });
    var before = null;
    for (var i = 0; i < others.length; i++) {
      var r = others[i].getBoundingClientRect();
      if (x < r.left + r.width / 2) { before = others[i]; break; }
    }
    var ref = before || (others.length ? others[others.length - 1].nextSibling : drag.tab.nextSibling);
    if (ref !== drag.tab && drag.tab.nextSibling !== ref) tabs.insertBefore(drag.tab, ref);
  }

  function end(keep) {
    if (!drag) return;
    var t = drag.tab, start = drag.start;
    t.classList.remove('dragging');
    tabs.classList.remove('reordering');
    try { t.releasePointerCapture(drag.id); } catch (e) {}
    drag = null;
    if (!keep) apply(start);
    var now = views();
    if (now.join() !== start.join() && opts.onchange) opts.onchange(now);
  }

  function cancelPress() {
    if (press) clearTimeout(press.timer);
    press = null;
  }

  function onDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    var t = e.target.closest ? e.target.closest('[data-view]') : null;
    if (!t || t.parentNode !== tabs) return;
    cancelPress();
    press = { tab: t, x: e.clientX, y: e.clientY, id: e.pointerId };
    press.timer = setTimeout(lift, HOLD_MS);
  }

  function onMove(e) {
    if (press) {
      if (Math.abs(e.clientX - press.x) > SLOP_PX || Math.abs(e.clientY - press.y) > SLOP_PX) cancelPress();
      return;
    }
    if (!drag) return;
    e.preventDefault();
    moveTo(e.clientX);
  }

  function onUp() {
    cancelPress();
    if (!drag) return;
    swallow = true;
    setTimeout(function () { swallow = false; }, 0);
    end(true);
  }

  function init(o) {
    opts = o || {};
    tabs = opts.tabs;
    tabs.addEventListener('pointerdown', onDown);
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', function () { cancelPress(); end(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && drag) end(false); });
    // the click a drag ends in, and the long-press menu of a touch screen
    tabs.addEventListener('click', function (e) {
      if (swallow) { e.stopPropagation(); e.preventDefault(); swallow = false; }
    }, true);
    tabs.addEventListener('contextmenu', function (e) { if (press || drag) e.preventDefault(); });
  }

  global.TabDrag = {
    HOLD_MS: HOLD_MS,
    init: init, apply: apply, views: function () { return tabs ? views() : []; },
    dragging: function () { return !!drag; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
