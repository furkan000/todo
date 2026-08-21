/* Rendering: document, table, calendar, discovery. Pure functions of a parse result. */
(function (global) {
  'use strict';
  var TT = global.TT;

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function attr(s) { return esc(s).replace(/"/g, '&quot;'); }

  // deliberately tiny: bold, italic, code, links
  function inline(s) {
    return esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
      .replace(/\bhttps?:\/\/[^\s<]+/g, function (u) { return '<a href="' + attr(u) + '" target="_blank" rel="noopener">' + esc(u) + '</a>'; });
  }

  /* ---------- chips ---------- */
  function chipHTML(t, ctx) {
    var q, cls, body, title, styleAttr = '';
    if (t.kind === 'select' || (t.kind === 'bare' && t.resolved)) {
      var ns = t.kind === 'select' ? TT.key(t.ns) : t.resolved.ns;
      var val = t.kind === 'select' ? t.value : t.resolved.value;
      q = '#' + ns + ':' + val;
      cls = 'chip select ns-' + slug(ns);
      if (ns === 'priority') cls += ' prio-' + (TT.canonicalPriority(val) || 'x');
      // priority is built in and its values speak for themselves — "high" needs
      // no "priority:" in front of it, and the chip is colour-coded besides
      body = (ns === 'priority' ? '' : '<i>' + esc(ns) + '</i>') + esc(val);
      styleAttr = hueStyle(ns);
      if (t.kind === 'bare') {
        cls += ' taught';
        title = '#' + t.name + ' resolves to ' + ns + ':' + val + ' — taught elsewhere in this document';
      } else if (t.shorthand) {
        title = '!' + t.value + ' — priority shorthand';
      } else {
        title = q;
      }
    } else if (t.kind === 'bool') {
      q = '~' + t.name;
      cls = 'chip bool';
      body = '~' + esc(t.name);
      title = t.name + ' = true';
    } else if (t.kind === 'date') {
      var d = TT.parseDate(t.name, ctx && ctx.today);
      q = t.raw;
      cls = 'chip date' + (d ? '' : ' bad') + (d && ctx && d < ctx.todayISO ? ' overdue' : '');
      body = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 1v2M12 1v2M1.5 6h13M2.5 3h11a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/></svg>' + esc(d || t.name);
      title = d ? 'due ' + d : 'unrecognised date: ' + t.raw;
    } else {
      q = '#' + t.name;
      cls = 'chip label';
      body = '#' + esc(t.name);
      title = 'plain label';
    }
    return '<span class="' + cls + '"' + styleAttr + ' data-q="' + attr(q) + '" title="' + attr(title) + '">' + body + '</span>';
  }
  function slug(s) { return String(s).replace(/[^a-z0-9]+/gi, '-').toLowerCase(); }
  // stable colour per namespace, so a column keeps its hue across renders
  function hue(ns) {
    var h = 0, s = String(ns);
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    return [212, 268, 158, 24, 340, 190, 48, 120][h % 8];
  }
  function hueStyle(ns) { return ' style="--h:' + hue(ns) + '"'; }

  function textWithChips(text, tokens, ctx) {
    var out = '', at = 0;
    tokens.forEach(function (t) {
      out += inline(text.slice(at, t.start));
      out += chipHTML(t, ctx);
      at = t.end;
    });
    return out + inline(text.slice(at));
  }

  /* ---------- subtask progress ---------- */
  // Only a todo with something under it earns a counter.
  function progressHTML(t) {
    if (!t.subTotal) return '';
    var pct = Math.round((t.subDone / t.subTotal) * 100);
    return '<span class="sub-count' + (t.subDone === t.subTotal ? ' full' : '') + '" style="--p:' + pct + '%" ' +
      'title="' + t.subDone + ' of ' + t.subTotal + ' subtask' + (t.subTotal === 1 ? '' : 's') + ' done">' +
      '<b></b><i>' + t.subDone + '/' + t.subTotal + '</i></span>';
  }

  // The "working on it" arrow. Quiet until you hover, loud once it is set —
  // a marker you can leave on is a marker that has to be easy to take off.
  // An active task also gets a rank control, so the queue can be put in order.
  function nowHTML(t) {
    if (t.done) return '';
    var out = '';
    if (t.active) {
      out += '<button class="rank-btn' + (t.order ? ' set' : '') + '" data-rank="' + t.line + '" tabindex="-1" ' +
        'title="' + (t.order ? 'Number ' + t.order + ' in the queue' : 'Unnumbered') +
        ' — click to change the order">' + (t.order || '–') + '</button>';
    }
    return out + '<button class="now-btn" data-now="' + t.line + '" tabindex="-1" ' +
      'title="' + (t.active ? 'Working on this — click to unset' : 'Mark as what you are working on') +
      ' (Ctrl+.)">▸</button>';
  }

  /* ---------- document ---------- */
  function renderDocument(doc, ctx) {
    if (ctx.filter === 'now') return renderQueue(doc, ctx);
    var html = '', openList = false;
    var shown = new Set(ctx.visible.map(function (t) { return t.line; }));
    var hidden = doc.todos.length - ctx.visible.length;
    function closeList() { if (openList) { html += '</ul>'; openList = false; } }

    doc.lines.forEach(function (ln) {
      if (ln.kind === 'todo') {
        if (!shown.has(ln.line)) return;
        if (!openList) { html += '<ul class="todos">'; openList = true; }
        var t = ln.todo;
        var kids = t.children || [];
        var cls = 'todo' + (t.done ? ' done' : '') + (t.active ? ' active' : '') +
          (kids.length ? ' parent' : '') + (t.partial ? ' partial' : '') + (t.parent ? ' sub' : '');
        html += '<li class="' + cls + '" style="--indent:' + Math.floor(t.indent / 2) + '">' +
          '<label><input type="checkbox" data-toggle="' + t.line + '"' + (t.done ? ' checked' : '') + '>' +
          '<span class="box"></span><span class="body">' + textWithChips(ln.text, ln.tokens, ctx) + '</span>' +
          progressHTML(t) + nowHTML(t) + '</label></li>';
      } else if (ln.kind === 'bullet') {
        if (!openList) { html += '<ul class="todos">'; openList = true; }
        html += '<li class="bullet" style="--indent:' + Math.floor(ln.indent / 2) + '">' +
          '<span class="body">' + textWithChips(ln.text, ln.tokens, ctx) + '</span></li>';
      } else {
        closeList();
        if (ln.kind === 'heading') {
          html += '<h' + ln.level + ' class="doc-h">' + textWithChips(ln.text, ln.tokens, ctx) + '</h' + ln.level + '>';
        } else if (ln.kind === 'text') {
          html += '<p>' + textWithChips(ln.text, ln.tokens, ctx) + '</p>';
        } else {
          html += '<div class="spacer"></div>';
        }
      }
    });
    closeList();
    if (!doc.lines.some(function (l) { return l.kind !== 'blank'; })) html = empty('Nothing written yet.', 'Type on the left — every line is yours, todos are lines with <code>[ ]</code>.');
    if (hidden > 0) {
      html += '<p class="hidden-note">' + hidden + ' todo' + (hidden === 1 ? '' : 's') +
        ' hidden by the current filter. The text still has them.</p>';
    }
    return html;
  }

  // Asking to see only what you are working on is asking for a queue, not a
  // document — so it is one flat ordered list, numbered work first, each item
  // carrying the section it came from instead of the headings around it.
  function renderQueue(doc, ctx) {
    var items = global.Focus.queue(ctx.visible);
    if (!items.length) {
      return empty('Nothing in flight.',
        'Mark what you are working on with the <b>▸</b> beside a task, <code>Ctrl+.</code>, ' +
        'or by typing <code>[&gt;]</code> in its checkbox. Number them <code>[1]</code>, ' +
        '<code>[2]</code>, <code>[3]</code> to put them in an order.');
    }
    var html = '<ul class="todos queue">';
    items.forEach(function (t) {
      var ln = doc.lines[t.line];
      html += '<li class="todo active' + (t.order ? ' ranked' : '') + '">' +
        '<label><input type="checkbox" data-toggle="' + t.line + '">' +
        '<span class="box"></span><span class="body">' + textWithChips(ln.text, ln.tokens, ctx) +
        (t.section ? '<span class="parent-of" title="' + attr(t.section.title) + '">' + esc(t.section.title) + '</span>' : '') +
        '</span>' + progressHTML(t) + nowHTML(t) + '</label></li>';
    });
    html += '</ul>';
    var rest = doc.todos.length - items.length;
    if (rest > 0) {
      html += '<p class="hidden-note">' + rest + ' other todo' + (rest === 1 ? '' : 's') +
        ' hidden. Numbered work comes first, then the rest in document order.</p>';
    }
    return html;
  }

  /* ---------- table ---------- */
  function columns(doc, todos) {
    todos = todos || doc.todos;
    var cols = [
      { id: 'done', label: '', kind: 'done', width: '34px' },
      { id: 'title', label: 'Task', kind: 'title' },
      { id: 'due', label: 'Due', kind: 'due' }
    ];
    // the column only exists once something in view actually has subtasks
    if (todos.some(function (t) { return t.subTotal; })) {
      cols.splice(2, 0, { id: 'sub', label: 'Sub', kind: 'sub', width: '86px' });
    }
    var nsNames = Array.from(doc.vocab.namespaces.keys()).filter(function (ns) {
      return todos.some(function (t) { return t.selects[ns]; });
    });
    nsNames.sort(function (a, b) {
      if (a === 'priority') return -1;
      if (b === 'priority') return 1;
      return a.localeCompare(b);
    });
    nsNames.forEach(function (ns) {
      cols.push({ id: 'ns:' + ns, label: ns, kind: 'select', ns: ns, multi: doc.vocab.multi.has(ns) });
    });
    Array.from(doc.vocab.bools.keys()).sort().filter(function (b) {
      return todos.some(function (t) { return t.bools[b]; });
    }).forEach(function (b) {
      cols.push({ id: 'bool:' + b, label: '~' + doc.vocab.bools.get(b).display, kind: 'bool', name: b });
    });
    if (todos.some(function (t) { return t.labels.length; })) {
      cols.push({ id: 'labels', label: 'Labels', kind: 'labels' });
    }
    return cols;
  }

  function cellValue(todo, col) {
    switch (col.kind) {
      case 'done': return todo.done ? 1 : 0;
      case 'title': return todo.title.toLowerCase();
      case 'sub': return todo.subTotal ? todo.subDone / todo.subTotal : '';
      case 'due': return todo.due || '';
      case 'select':
        if (col.ns === 'priority') return todo.priorityRank;
        if (col.multi) return (todo.values[col.ns] || []).join(' ').toLowerCase();
        return (todo.selects[col.ns] || '').toLowerCase();
      case 'bool': return todo.bools[col.name] ? 1 : 0;
      case 'labels': return todo.labels.join(' ').toLowerCase();
    }
    return '';
  }

  // No column chosen means the document's own order — the text is the source of
  // truth, so the order you wrote things in is the one to fall back to.
  function sortTodos(todos, cols, sort) {
    if (!sort || !sort.col) return todos.slice();
    var col = cols.filter(function (c) { return c.id === sort.col; })[0];
    if (!col) return todos.slice();
    var dir = sort.dir === 'desc' ? -1 : 1;
    return todos.slice().sort(function (a, b) {
      var va = cellValue(a, col), vb = cellValue(b, col);
      var ea = va === '' || va === 99, eb = vb === '' || vb === 99;
      if (ea !== eb) return ea ? 1 : -1;           // empties always sink
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return a.line - b.line;                       // stable: document order
    });
  }

  function renderTable(doc, ctx) {
    if (!doc.todos.length) return empty('No todos yet.', 'A todo is any line with <code>[ ]</code> or <code>[x]</code>.');
    if (!ctx.visible.length) return empty('No matching todos.', 'Loosen the filter or clear the search.');

    // group in document order, keyed by the heading each todo sits under
    var groups = [], byLine = new Map();
    ctx.visible.forEach(function (t) {
      var key = t.section ? t.section.line : -1;
      if (!byLine.has(key)) {
        var g = { section: t.section, todos: [] };
        byLine.set(key, g);
        groups.push(g);
      }
      byLine.get(key).todos.push(t);
    });

    if (!ctx.group) return oneTable(doc, ctx.visible, ctx);

    // a breadcrumb only earns its place when it tells sections apart, so drop
    // the ancestors every section shares (typically the document's own H1)
    var withPath = groups.filter(function (g) { return g.section; });
    var shared = withPath.length ? withPath[0].section.path.slice() : [];
    withPath.forEach(function (g) {
      var p = g.section.path;
      while (shared.length && (p.length < shared.length || p[shared.length - 1] !== shared[shared.length - 1])) shared.pop();
    });

    return groups.map(function (g) {
      var s = g.section;
      var crumb = s ? s.path.slice(shared.length) : [];
      var head = s
        ? '<h3 class="group-h" data-goto="' + s.line + '" title="Jump to line ' + (s.line + 1) + '">' +
            (crumb.length ? '<span class="crumb">' + crumb.map(esc).join(' › ') + ' › </span>' : '') +
            esc(s.title) + '<b>' + g.todos.length + '</b></h3>'
        : '<h3 class="group-h loose">Before any heading<b>' + g.todos.length + '</b></h3>';
      return '<section class="group">' + head + oneTable(doc, g.todos, ctx) + '</section>';
    }).join('');
  }

  function oneTable(doc, todos, ctx) {
    var cols = columns(doc, todos);
    var rows = sortTodos(todos, cols, ctx.sort);

    var html = '<div class="table-wrap"><table><thead><tr>';
    cols.forEach(function (c) {
      var on = ctx.sort.col === c.id;
      var next = !on ? 'sort ascending' : ctx.sort.dir === 'asc' ? 'sort descending' : 'back to document order';
      html += '<th class="col-' + c.kind + (on ? ' sorted ' + ctx.sort.dir : '') + '" data-sort="' + attr(c.id) + '"' +
        ' title="' + attr((c.label || 'Done') + ' — click to ' + next) + '"' +
        (c.width ? ' style="width:' + c.width + '"' : '') + '>' +
        '<span>' + esc(c.label) + '</span>' +
        '<b class="arrow">' + (on ? (ctx.sort.dir === 'desc' ? '↓' : '↑') : '↕') + '</b></th>';
    });
    html += '</tr></thead><tbody>';

    rows.forEach(function (t) {
      html += '<tr class="' + (t.done ? 'done' : '') + (t.active ? ' active' : '') + '">';
      cols.forEach(function (c) {
        html += '<td class="col-' + c.kind + '">' + cellHTML(t, c, ctx) + '</td>';
      });
      html += '</tr>';
    });
    return html + '</tbody></table></div>';
  }

  function cellHTML(t, c, ctx) {
    switch (c.kind) {
      case 'done':
        return '<label class="cbx"><input type="checkbox" data-toggle="' + t.line + '"' + (t.done ? ' checked' : '') + '><span class="box"></span></label>';
      case 'title':
        // sorting scatters the document order, so a subtask has to say whose it
        // is rather than rely on sitting under it
        var under = t.parent
          ? '<span class="sub-of" title="subtask of ' + attr(t.parent.title) + '">└</span>'
          : '';
        return under + nowHTML(t) + '<span class="task-title" data-goto="' + t.line + '" title="Jump to line ' + (t.line + 1) + '">' +
          (esc(t.title) || '<i class="muted">(untitled)</i>') + '</span>' +
          (t.parent ? '<span class="parent-of" title="' + attr(t.parent.title) + '">' + esc(t.parent.title) + '</span>' : '');
      case 'sub':
        if (!t.subTotal) return '<span class="muted">—</span>';
        return progressHTML(t);
      case 'due':
        if (!t.due) return '<span class="muted">—</span>';
        var over = !t.done && t.due < ctx.todayISO;
        return '<span class="due' + (over ? ' overdue' : '') + '" data-q="' + attr(t.dueRaw) + '">' + esc(t.due) + relative(t.due, ctx) + '</span>';
      case 'select':
        var vals = c.multi ? (t.values[c.ns] || []) : (t.selects[c.ns] ? [t.selects[c.ns]] : []);
        if (!vals.length) return '<span class="muted">—</span>';
        return vals.map(function (v) {
          var cls = 'chip select ns-' + slug(c.ns) + (c.ns === 'priority' ? ' prio-' + (TT.canonicalPriority(v) || 'x') : '');
          return '<span class="' + cls + '"' + hueStyle(c.ns) + ' data-q="#' + attr(c.ns + ':' + v) + '">' + esc(v) + '</span>';
        }).join('');
      case 'bool':
        return t.bools[c.name]
          ? '<span class="flag yes" data-q="~' + attr(c.name) + '">yes</span>'
          : '<span class="flag no">no</span>';
      case 'labels':
        return t.labels.length
          ? t.labels.map(function (l) { return '<span class="chip label" data-q="#' + attr(l) + '">#' + esc(l) + '</span>'; }).join('')
          : '<span class="muted">—</span>';
    }
    return '';
  }

  function relative(iso, ctx) {
    var days = Math.round((new Date(iso + 'T00:00:00') - new Date(ctx.todayISO + 'T00:00:00')) / 86400000);
    var s = days === 0 ? 'today' : days === 1 ? 'tomorrow' : days === -1 ? 'yesterday'
      : days < 0 ? -days + 'd ago' : 'in ' + days + 'd';
    return ' <i class="rel">' + s + '</i>';
  }

  /* ---------- calendar ---------- */
  var MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  function renderCalendar(doc, ctx) {
    var y = ctx.month.getFullYear(), m = ctx.month.getMonth();
    var byDay = new Map();
    ctx.visible.forEach(function (t) {
      if (!t.due) return;
      if (!byDay.has(t.due)) byDay.set(t.due, []);
      byDay.get(t.due).push(t);
    });

    var first = new Date(y, m, 1);
    var start = new Date(y, m, 1 - ((first.getDay() + 6) % 7)); // Monday-start grid
    var html = '<div class="cal">' +
      '<div class="cal-head">' +
      '<div class="cal-title">' + MONTH_NAMES[m] + ' <span>' + y + '</span></div>' +
      '<div class="cal-nav">' +
      '<button data-month="-1" title="Previous month">‹</button>' +
      '<button data-month="0">Today</button>' +
      '<button data-month="1" title="Next month">›</button>' +
      '</div></div><div class="cal-grid">';

    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach(function (d) {
      html += '<div class="cal-dow">' + d + '</div>';
    });

    for (var i = 0; i < 42; i++) {
      var d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      var iso = TT.isoOf(d);
      var items = byDay.get(iso) || [];
      var cls = 'cal-day';
      if (d.getMonth() !== m) cls += ' other';
      if (iso === ctx.todayISO) cls += ' today';
      if (d.getDay() === 0 || d.getDay() === 6) cls += ' weekend';
      html += '<div class="' + cls + '"><div class="cal-num">' + d.getDate() + '</div>';
      items.slice(0, 4).forEach(function (t) {
        var over = !t.done && iso < ctx.todayISO;
        var rankTag = t.order ? '<b class="cal-rank">' + t.order + '</b>' : '';
        html += '<div class="cal-item' + (t.done ? ' done' : '') + (t.active ? ' active' : '') + (over ? ' overdue' : '') +
          (t.priority ? ' prio-' + (TT.canonicalPriority(t.priority) || 'x') : '') +
          '" data-goto="' + t.line + '" title="' + attr(t.parent ? t.title + ' — subtask of ' + t.parent.title : t.title) + '">' +
          '<span class="dot" data-toggle="' + t.line + '"></span><span class="t">' + rankTag +
          (t.parent ? '<span class="sub-of">└</span>' : '') + esc(t.title || '(untitled)') + '</span></div>';
      });
      if (items.length > 4) html += '<div class="cal-more">+' + (items.length - 4) + ' more</div>';
      html += '</div>';
    }
    html += '</div>';

    var undated = ctx.visible.filter(function (t) { return !t.due; }).length;
    html += '<div class="cal-foot">' + byDay.size + ' dated day' + (byDay.size === 1 ? '' : 's') +
      ' · <b>' + undated + '</b> todo' + (undated === 1 ? '' : 's') + ' with no date' +
      ' <span class="muted">— add one with <code>@2026-08-21</code>, <code>@fri</code> or <code>@tomorrow</code></span></div></div>';
    return html;
  }

  /* ---------- discovery ---------- */
  function renderDiscovery(doc, ctx) {
    var v = doc.vocab;
    var suspects = TT.findSuspects(v);
    var html = '';

    if (suspects.length) {
      html += '<section class="disco warn"><h3>Possible typos <b>' + suspects.length + '</b></h3><ul class="suspects">';
      suspects.forEach(function (s) {
        html += '<li><span class="sus-kind">' + esc(s.kind) + '</span>' +
          '<code data-q="' + attr(s.a) + '">' + esc(s.a) + '</code>' +
          (s.kind === 'date' ? ' <span class="muted">' + esc(s.b) + '</span>' : ' <span class="muted">vs</span> <code data-q="' + attr(s.b) + '">' + esc(s.b) + '</code>') +
          ' <i>' + esc(s.hint) + '</i></li>';
      });
      html += '</ul></section>';
    }

    html += '<section class="disco"><h3>Namespaces <b>' + v.namespaces.size + '</b> <span class="muted">— each one is a table column</span></h3>';
    if (!v.namespaces.size) html += hint('No namespaced tags yet. Write <code>#status:blocked</code> to create a column.');
    Array.from(v.namespaces.keys()).sort().forEach(function (ns) {
      var vals = v.namespaces.get(ns);
      var tag = ns === 'priority' ? '<em>built-in</em>' : v.multi.has(ns) ? '<em>multi</em>' : '';
      html += '<div class="ns-row"' + hueStyle(ns) + '><div class="ns-name">#' + esc(ns) + ':' + tag + '</div><div class="ns-vals">';
      var keys = Array.from(vals.keys());
      if (ns === 'priority') keys.sort(function (a, b) { return TT.priorityRank(a) - TT.priorityRank(b); });
      else keys.sort();
      keys.forEach(function (k) {
        var info = vals.get(k);
        var cls = 'chip select ns-' + slug(ns) + (ns === 'priority' ? ' prio-' + (TT.canonicalPriority(k) || 'x') : '');
        html += '<span class="' + cls + '"' + hueStyle(ns) + ' data-q="#' + attr(ns + ':' + info.display) + '">' + esc(info.display) + '<b>' + info.count + '</b></span>';
      });
      html += '</div></div>';
    });
    html += '</section>';

    html += '<section class="disco"><h3>Booleans <b>' + v.bools.size + '</b> <span class="muted">— present = yes, absent = no</span></h3><div class="ns-vals">';
    if (!v.bools.size) html += hint('None yet. Write <code>~billable</code> to add a yes/no column.');
    Array.from(v.bools.keys()).sort().forEach(function (b) {
      var info = v.bools.get(b);
      html += '<span class="chip bool" data-q="~' + attr(info.display) + '">~' + esc(info.display) + '<b>' + info.count + '</b></span>';
    });
    html += '</div></section>';

    html += '<section class="disco"><h3>Plain labels <b>' + v.labels.size + '</b> <span class="muted">— free-form, multi-value</span></h3><div class="ns-vals">';
    if (!v.labels.size) html += hint('None yet. Any bare <code>#tag</code> that was never namespaced lands here.');
    Array.from(v.labels.keys()).sort().forEach(function (l) {
      var info = v.labels.get(l);
      html += '<span class="chip label" data-q="#' + attr(info.display) + '">#' + esc(info.display) + '<b>' + info.count + '</b></span>';
    });
    html += '</div></section>';

    var taught = [];
    doc.lines.forEach(function (ln) {
      ln.tokens.forEach(function (t) {
        if (t.kind === 'bare' && t.resolved) taught.push(t);
      });
    });
    if (taught.length) {
      var uniq = new Map();
      taught.forEach(function (t) { uniq.set(TT.key(t.name), t); });
      html += '<section class="disco"><h3>Taught tags <b>' + uniq.size + '</b> <span class="muted">— bare tags resolved from vocabulary elsewhere</span></h3><div class="taught-list">';
      uniq.forEach(function (t) {
        html += '<div class="taught-row"><code>#' + esc(t.name) + '</code> <span class="arrow">→</span> ' +
          '<span class="chip select ns-' + slug(t.resolved.ns) + '"' + hueStyle(t.resolved.ns) + ' data-q="#' + attr(t.resolved.ns + ':' + t.resolved.value) + '"><i>' +
          esc(t.resolved.ns) + '</i>' + esc(t.resolved.value) + '</span></div>';
      });
      html += '</div></section>';
    }
    return html;
  }

  var DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  function renderLog(doc, ctx) {
    var days = ctx.log;
    if (!days.length) {
      return empty('Nothing logged yet.',
        'Tick a todo off — here, in the table, on the calendar, or by typing the <code>x</code> yourself — and the moment lands here.');
    }
    var total = days.reduce(function (n, d) { return n + d.items.length; }, 0);
    var html = '<div class="log-head"><span>' + total + ' completion' + (total === 1 ? '' : 's') +
      ' across ' + days.length + ' day' + (days.length === 1 ? '' : 's') + '</span>' +
      '<button data-act="clear-log" class="link">Clear log</button></div>';

    days.forEach(function (d) {
      var when = new Date(d.day + 'T00:00:00');
      var label = isNaN(when) ? d.day : DAY_NAMES[when.getDay()] + ' ' + when.getDate() + ' ' +
        ['January','February','March','April','May','June','July','August','September','October','November','December'][when.getMonth()];
      html += '<section class="log-day"><h3>' + esc(label) + '<b>' + d.items.length + '</b></h3><ul>';
      d.items.forEach(function (e) {
        html += '<li><span class="log-time">' + esc(e.at.slice(11)) + '</span>' +
          '<span class="log-title">' + (e.parent ? '<span class="sub-of" title="subtask of ' + attr(e.parent) + '">└</span>' : '') +
          (esc(e.title) || '<i class="muted">(untitled)</i>') +
          (e.parent ? '<span class="parent-of muted"> · ' + esc(e.parent) + '</span>' : '') + '</span>' +
          (e.priority ? '<span class="chip select prio-' + (TT.canonicalPriority(e.priority) || 'x') + '">' + esc(e.priority) + '</span>' : '') +
          (e.section ? '<span class="log-section">' + esc(e.section) + '</span>' : '') +
          '</li>';
      });
      html += '</ul></section>';
    });
    return html;
  }

  function hint(h) { return '<p class="hint">' + h + '</p>'; }
  function empty(title, sub) { return '<div class="empty"><b>' + esc(title) + '</b><span>' + sub + '</span></div>'; }

  function sectionCount(todos) {
    var seen = {};
    todos.forEach(function (t) { seen[t.section ? t.section.line : -1] = 1; });
    return Object.keys(seen).length;
  }

  global.Views = {
    document: renderDocument, table: renderTable, calendar: renderCalendar,
    discovery: renderDiscovery, log: renderLog,
    columns: columns, esc: esc, sectionCount: sectionCount
  };
})(typeof window !== 'undefined' ? window : globalThis);
