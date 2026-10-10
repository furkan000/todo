/* The toolbar, made to fit.

   The tabs are written in order of how much they are used. When the window is
   too narrow for the bar, things give way in a fixed order, least needed first:

   1. the All / Now / Open / Done filter folds into one button showing the one
      in force, with the four behind it;
   2. tabs fold into More from the right end: Log, Tags, Music, Focus,
      Calendar, Work. Text, Doc, Table and Notes always stay;
   3. on a phone-narrow window, the search icon goes (Ctrl+K still opens
      Spotlight in Notes), and then the filter moves into More, below the tabs.
      The settings cog is never pushed off.

   The filter is not shown at all where it has nothing to filter — everywhere
   but Doc, Table and Calendar.

   Nothing is guessed from breakpoints. The bar is measured: everything is put
   back, then folded one step at a time until it fits. A new or renamed tab
   needs no numbers changed here. */
(function (global) {
  'use strict';

  var FOLD = ['log', 'tags', 'music', 'focus', 'cal', 'work'];   // first to go first
  var FILTERED = { doc: 1, table: 1, cal: 1 };

  var bar = null, filter = null, more = null, chip = null, search = null;
  var filterInMore = false;
  var view = null, layout = null;

  function tab(v) { return bar.querySelector('.tabs > [data-view="' + v + '"]'); }
  function overflowing() { return bar.scrollWidth > bar.clientWidth + 1; }

  function folded() {
    return FOLD.filter(function (v) { var t = tab(v); return t && t.hidden; });
  }

  // Put everything back, then give way one step at a time until it fits
  function fit() {
    if (!bar) return;
    close();
    FOLD.forEach(function (v) { var t = tab(v); if (t) t.hidden = false; });
    more.hidden = true;
    var showFilter = !!FILTERED[view] && layout !== 'text';
    filter.hidden = !showFilter;
    chip.hidden = true;
    search.hidden = false;
    filterInMore = false;
    if (overflowing() && showFilter) {
      filter.hidden = true;
      chip.hidden = false;
    }
    for (var i = 0; i < FOLD.length && overflowing(); i++) {
      var t = tab(FOLD[i]);
      if (!t) continue;
      t.hidden = true;
      more.hidden = false;
    }
    if (overflowing()) search.hidden = true;
    if (overflowing() && !chip.hidden) {
      chip.hidden = true;
      filterInMore = true;
      more.hidden = false;
    }
    paint();
  }

  // The More list in the bar's own order, and the button named after the
  // folded tab you are on, so the bar still says where you are
  function paint() {
    var out = folded(), names = {};
    var order = Array.prototype.map.call(bar.querySelectorAll('.tabs > [data-view]'), function (t) {
      names[t.dataset.view] = t.textContent;
      return t.dataset.view;
    }).filter(function (v) { return out.indexOf(v) !== -1; });
    var pop = more.querySelector('.tb-pop');
    pop.innerHTML = order.map(function (v) {
      return '<button data-view="' + v + '" class="' + (v === view && layout !== 'text' ? 'on' : '') + '">' + names[v] + '</button>';
    }).join('') + (filterInMore ? (order.length ? '<div class="tb-sep"></div>' : '') + filterButtons() : '');
    var here = out.indexOf(view) !== -1 && layout !== 'text';
    var btn = more.querySelector('.more-btn');
    btn.textContent = here ? names[view] : 'More';
    btn.classList.toggle('on', here);

    var on = filter.querySelector('.on');
    chip.querySelector('.chip-btn').textContent = on ? on.textContent : 'All';
    chip.querySelector('.tb-pop').innerHTML = filterButtons();
  }

  function filterButtons() {
    return Array.prototype.map.call(filter.querySelectorAll('[data-filter]'), function (b) {
      return '<button data-filter="' + b.dataset.filter + '" class="' + (b.classList.contains('on') ? 'on' : '') + '"' +
        (b.title ? ' title="' + b.title + '"' : '') + '>' + b.textContent + '</button>';
    }).join('');
  }

  function close() {
    [more, chip].forEach(function (m) {
      if (!m) return;
      m.querySelector('.tb-pop').hidden = true;
      m.querySelector('[data-tb]').setAttribute('aria-expanded', 'false');
    });
  }

  function onClick(e) {
    var btn = e.target.closest ? e.target.closest('[data-tb]') : null;
    if (!btn) return close();
    var m = btn.parentNode, pop = m.querySelector('.tb-pop'), open = pop.hidden;
    close();
    pop.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
  }

  // Called after every render: only a change of view or layout can change what
  // the bar holds, so only that measures again
  function update(v, l) {
    if (v !== view || l !== layout) {
      view = v;
      layout = l;
      return fit();
    }
    paint();
  }

  function init(o) {
    bar = o.bar;
    filter = bar.querySelector('#filter');
    more = bar.querySelector('.more');
    chip = bar.querySelector('.filter-chip');
    search = bar.querySelector('.search');
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
    if (global.ResizeObserver) new ResizeObserver(function () { fit(); }).observe(bar);
    else global.addEventListener('resize', fit);
  }

  global.Navbar = { init: init, update: update, fit: fit, folded: folded, FOLD: FOLD };
})(typeof window !== 'undefined' ? window : globalThis);
