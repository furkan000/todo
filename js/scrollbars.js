/* Scrollbars that only show while they are doing something.

   The thumb is painted transparent and given its colour back by a class, so
   nothing about the layout changes when it appears — the gutter is reserved
   either way and the text never reflows.

   Two things bring it back: scrolling, and putting the pointer in the strip
   along the edge of a scrollable box. The second matters because a thumb you
   cannot see is a thumb you cannot grab, and reaching for the edge of a pane is
   exactly the gesture of someone about to drag one. */
(function (global) {
  'use strict';

  var SHOW = 'sb-show';
  var LINGER = 700;      // ms of stillness before it fades again
  var RESTING = 4000;    // a pointer parked in the gutter still gives up eventually
  var GUTTER = 16;       // px from the edge that counts as reaching for it
  var timers = new WeakMap();

  function reveal(el, ms) {
    if (!el || !el.classList) return;
    el.classList.add(SHOW);
    clearTimeout(timers.get(el));
    timers.set(el, setTimeout(function () { el.classList.remove(SHOW); }, ms));
  }

  function scrollable(el) {
    for (; el && el.nodeType === 1; el = el.parentElement) {
      if (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1) return el;
    }
    return null;
  }

  function init() {
    // scroll does not bubble, so it has to be caught on the way down
    document.addEventListener('scroll', function (e) {
      reveal(e.target === document ? document.scrollingElement : e.target, LINGER);
    }, true);

    document.addEventListener('pointermove', function (e) {
      var el = scrollable(e.target);
      if (!el) return;
      var r = el.getBoundingClientRect();
      var nearRight = r.right - e.clientX, nearBottom = r.bottom - e.clientY;
      var reaching = (nearRight >= 0 && nearRight <= GUTTER) || (nearBottom >= 0 && nearBottom <= GUTTER);
      if (reaching) reveal(el, RESTING);
      else if (el.classList.contains(SHOW)) reveal(el, LINGER);
    }, true);
  }

  global.Scrollbars = { init: init, reveal: reveal, CLASS: SHOW };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(typeof window !== 'undefined' ? window : globalThis);
