/* Two-pass plain-text task parser.
   Pass 1 learns the whole vocabulary, pass 2 resolves bare tags against it. */
(function (global) {
  'use strict';

  var NAME_CH = /[A-Za-z0-9_\-.+/]/;
  var TRAIL = /[.,;:!?]+$/;
  var PRIORITY_VALUES = { high: 'high', med: 'med', medium: 'med', low: 'low' };
  var MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  var WEEKDAYS = ['sun','mon','tue','wed','thu','fri','sat'];

  function isBoundary(ch) {
    return ch === undefined || /[\s(\[{"',;]/.test(ch);
  }

  // Text inside `backticks` is literal: a syntax example must not quietly
  // teach the document a new namespace.
  function codeRanges(text) {
    var r = [], i = 0, a, b;
    while ((a = text.indexOf('`', i)) !== -1) {
      b = text.indexOf('`', a + 1);
      if (b === -1) break;
      r.push([a, b]);
      i = b + 1;
    }
    return r;
  }
  function inCode(ranges, i) {
    for (var k = 0; k < ranges.length; k++) if (i >= ranges[k][0] && i <= ranges[k][1]) return true;
    return false;
  }

  /* ---------- token scanner ---------- */
  // Reads #ns:value, #bare, #ns:"quoted value", ~bool, @date, !high shorthand.
  // A markdown heading ("# Title") never matches: the char after # is a space,
  // so the name comes back empty.
  function scanTokens(text) {
    var out = [];
    var code = codeRanges(text);
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (c !== '#' && c !== '~' && c !== '@' && c !== '!') continue;
      if (!isBoundary(text[i - 1])) continue;
      if (inCode(code, i)) continue;

      var j = i + 1;
      var name = '';
      while (j < text.length && NAME_CH.test(text[j])) { name += text[j]; j++; }
      var cut = trailing(name);
      name = name.slice(0, name.length - cut); j -= cut;
      if (!name) continue;

      if (c === '#') {
        var value = null, quoted = false;
        if (text[j] === ':') {
          var k = j + 1;
          if (text[k] === '"' || text[k] === "'") {
            var q = text[k]; k++;
            var v = '';
            while (k < text.length && text[k] !== q) { v += text[k]; k++; }
            if (text[k] === q && v.trim()) { value = v.trim(); quoted = true; j = k + 1; }
          } else {
            var u = '';
            while (k < text.length && NAME_CH.test(text[k])) { u += text[k]; k++; }
            var ucut = trailing(u);
            u = u.slice(0, u.length - ucut); k -= ucut;
            if (u) { value = u; j = k; }
          }
        }
        out.push(tok(value === null ? 'bare' : 'select', {
          ns: value === null ? null : name, name: name, value: value,
          quoted: quoted, start: i, end: j, raw: text.slice(i, j)
        }));
        i = j - 1;
      } else if (c === '~') {
        out.push(tok('bool', { name: name, start: i, end: j, raw: text.slice(i, j) }));
        i = j - 1;
      } else if (c === '@') {
        out.push(tok('date', { name: name, start: i, end: j, raw: text.slice(i, j) }));
        i = j - 1;
      } else if (c === '!') {
        if (PRIORITY_VALUES[name.toLowerCase()]) {
          out.push(tok('select', {
            ns: 'priority', name: 'priority', value: name, shorthand: true,
            start: i, end: j, raw: text.slice(i, j)
          }));
          i = j - 1;
        }
      }
    }
    return out;
  }

  function tok(kind, o) { o.kind = kind; return o; }
  function trailing(s) { var m = TRAIL.exec(s); return m ? m[0].length : 0; }
  function key(s) { return String(s).toLowerCase().replace(/\s+/g, ' ').trim(); }

  /* ---------- dates ---------- */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(y, m, d) {
    var dt = new Date(y, m - 1, d);
    if (dt.getMonth() !== m - 1 || dt.getDate() !== d) return null; // rejects 02-31
    return dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate());
  }
  function isoOf(dt) { return dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate()); }
  function shift(base, days) {
    var d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + days);
    return isoOf(d);
  }

  function parseDate(raw, today) {
    var s = key(raw).replace(/^@/, '');
    var now = today || new Date();
    var m;

    if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s))) return iso(+m[1], +m[2], +m[3]);
    if ((m = /^(\d{1,2})[-/.](\d{1,2})$/.exec(s))) return iso(now.getFullYear(), +m[1], +m[2]);
    if (s === 'today') return shift(now, 0);
    if (s === 'tomorrow' || s === 'tmrw') return shift(now, 1);
    if (s === 'yesterday') return shift(now, -1);
    if ((m = /^([a-z]{3,9})[-.]?(\d{1,2})$/.exec(s))) {
      var mi = monthIndex(m[1]);
      if (mi >= 0) return rollForward(now, mi, +m[2]);
    }
    if ((m = /^(\d{1,2})[-.]?([a-z]{3,9})$/.exec(s))) {
      var mi2 = monthIndex(m[2]);
      if (mi2 >= 0) return rollForward(now, mi2, +m[1]);
    }
    var wd = WEEKDAYS.indexOf(s.slice(0, 3));
    if (wd >= 0 && /^(sun|mon|tue|wed|thu|fri|sat)(day|s|nes|rs|ur)?/.test(s)) {
      var delta = (wd - now.getDay() + 7) % 7 || 7; // next one, never today
      return shift(now, delta);
    }
    return null;
  }

  function monthIndex(word) {
    var w = word.slice(0, 3);
    var i = MONTHS.indexOf(w);
    return i >= 0 && /^[a-z]+$/.test(word) ? i : -1;
  }
  // A month/day with no year means the next time it comes around.
  function rollForward(now, monthIdx, day) {
    var thisYear = iso(now.getFullYear(), monthIdx + 1, day);
    if (!thisYear) return null;
    if (thisYear >= isoOf(now)) return thisYear;
    return iso(now.getFullYear() + 1, monthIdx + 1, day);
  }

  /* ---------- line classification ---------- */
  // [>] is "working on it": open, but the one you are actually doing. A digit
  // says the same and ranks it, so the marker stays one character wide either
  // way and the raw text keeps its column alignment.
  var TODO_RE = /^(\s*)(?:[-*+]\s+)?\[([ xX>1-9])\]\s?(.*)$/;
  var HEAD_RE = /^(#{1,6})\s+(.*)$/;
  var BULLET_RE = /^(\s*)[-*+]\s+(.*)$/;

  function classify(raw) {
    var m;
    if ((m = TODO_RE.exec(raw))) {
      var box = m[2];
      return {
        kind: 'todo', indent: m[1].length, text: m[3],
        done: box === 'x' || box === 'X',
        active: box === '>' || (box >= '1' && box <= '9'),
        order: box >= '1' && box <= '9' ? +box : null
      };
    }
    if ((m = HEAD_RE.exec(raw))) return { kind: 'heading', level: m[1].length, text: m[2] };
    if (!raw.trim()) return { kind: 'blank', text: '' };
    if ((m = BULLET_RE.exec(raw))) return { kind: 'bullet', indent: m[1].length, text: m[2] };
    return { kind: 'text', text: raw };
  }

  /* ---------- document parse ---------- */
  function parseDocument(text, today) {
    var rawLines = String(text).split('\n');
    var lines = rawLines.map(function (raw, i) {
      var info = classify(raw);
      info.raw = raw;
      info.line = i;
      info.tokens = scanTokens(info.text);
      return info;
    });

    // --- pass 1: learn the vocabulary from the entire document ---
    var namespaces = new Map();   // ns -> Map(valueKey -> {display, count, firstLine})
    var bools = new Map();        // name -> {display, count}
    var valueIndex = new Map();   // valueKey -> ns   (first namespace to claim it wins)
    var badDates = [];

    // priority is a built-in select: its vocabulary is seeded, so a bare #high
    // resolves on line 1 without anyone having written #priority:high first.
    var prio = new Map();
    namespaces.set('priority', prio);
    Object.keys(PRIORITY_VALUES).forEach(function (v) {
      if (!valueIndex.has(v)) valueIndex.set(v, 'priority');
    });

    lines.forEach(function (ln) {
      ln.tokens.forEach(function (t) {
        if (t.kind === 'select') {
          var ns = key(t.ns), vk = key(t.value);
          if (!namespaces.has(ns)) namespaces.set(ns, new Map());
          var vals = namespaces.get(ns);
          if (!vals.has(vk)) vals.set(vk, { display: t.value, count: 0, firstLine: ln.line });
          vals.get(vk).count++;
          if (!valueIndex.has(vk)) valueIndex.set(vk, ns);
        } else if (t.kind === 'bool') {
          var bk = key(t.name);
          if (!bools.has(bk)) bools.set(bk, { display: t.name, count: 0 });
          bools.get(bk).count++;
        } else if (t.kind === 'date') {
          if (!parseDate(t.name, today)) badDates.push({ raw: t.raw, line: ln.line });
        }
      });
    });
    if (prio.size === 0) namespaces.delete('priority');

    // --- pass 2: resolve bare tags against the finished vocabulary ---
    var labels = new Map();
    lines.forEach(function (ln) {
      ln.tokens.forEach(function (t) {
        if (t.kind !== 'bare') return;
        var vk = key(t.name);
        var ns = valueIndex.get(vk);
        if (ns) {
          t.resolved = { ns: ns, value: canonicalDisplay(namespaces, ns, vk, t.name), taught: true };
          var vals = namespaces.get(ns);
          if (!vals.has(vk)) vals.set(vk, { display: t.name, count: 0, firstLine: ln.line });
          vals.get(vk).count++;
        } else {
          if (!labels.has(vk)) labels.set(vk, { display: t.name, count: 0 });
          labels.get(vk).count++;
        }
      });
    });

    // --- build todos ---
    var todos = [];
    var stack = [], section = null;
    lines.forEach(function (ln) {
      if (ln.kind === 'heading') {
        while (stack.length && stack[stack.length - 1].level >= ln.level) stack.pop();
        section = {
          title: stripTokens(ln.text, ln.tokens) || '(untitled section)',
          level: ln.level, line: ln.line,
          path: stack.map(function (n) { return n.title; })
        };
        stack.push(section);
        return;
      }
      if (ln.kind !== 'todo') return;
      var todo = {
        id: 't' + ln.line, line: ln.line, done: ln.done, active: !!ln.active,
        order: ln.order === undefined ? null : ln.order, indent: ln.indent,
        text: ln.text, tokens: ln.tokens, title: stripTokens(ln.text, ln.tokens),
        due: null, dueRaw: null, priority: null,
        selects: {}, values: {}, bools: {}, labels: [],
        section: section
      };
      ln.tokens.forEach(function (t) {
        if (t.kind === 'date') {
          var d = parseDate(t.name, today);
          if (d && !todo.due) { todo.due = d; todo.dueRaw = t.raw; }
        } else if (t.kind === 'bool') {
          todo.bools[key(t.name)] = true;
        } else if (t.kind === 'select') {
          setSelect(todo, key(t.ns), t.value);
        } else if (t.kind === 'bare' && t.resolved) {
          setSelect(todo, t.resolved.ns, t.resolved.value);
        } else if (t.kind === 'bare') {
          todo.labels.push(t.name);
        }
      });
      todo.priority = todo.selects.priority || null;
      todo.priorityRank = priorityRank(todo.priority);
      todos.push(todo);
      ln.todo = todo;
    });

    // A namespace that carries two values on any one todo is multi-valued for the
    // whole document — the arity is discovered from what you typed, like the
    // columns themselves. Priority stays single: a task has one priority.
    var multi = new Set();
    todos.forEach(function (t) {
      Object.keys(t.values).forEach(function (ns) {
        if (ns !== 'priority' && t.values[ns].length > 1) multi.add(ns);
      });
    });

    // Absence of a boolean is an explicit false, not a blank — so it sorts.
    var boolNames = Array.from(bools.keys());
    todos.forEach(function (t) {
      boolNames.forEach(function (b) { if (!(b in t.bools)) t.bools[b] = false; });
    });

    return {
      text: text, lines: lines, todos: todos,
      vocab: {
        namespaces: namespaces, bools: bools, labels: labels,
        valueIndex: valueIndex, badDates: badDates, multi: multi
      }
    };
  }

  // Every value is kept in order (duplicates collapsed); selects[ns] stays the
  // first one, so a namespace used once behaves exactly as it always did.
  function setSelect(todo, ns, value) {
    var arr = todo.values[ns] || (todo.values[ns] = []);
    var k = key(value);
    for (var i = 0; i < arr.length; i++) if (key(arr[i]) === k) return;
    arr.push(value);
    if (!(ns in todo.selects)) todo.selects[ns] = value;
  }

  function canonicalDisplay(namespaces, ns, vk, fallback) {
    var vals = namespaces.get(ns);
    var hit = vals && vals.get(vk);
    return hit ? hit.display : fallback;
  }

  function priorityRank(p) {
    if (!p) return 99;
    var c = PRIORITY_VALUES[key(p)];
    return c === 'high' ? 0 : c === 'med' ? 1 : c === 'low' ? 2 : 50;
  }

  function stripTokens(text, tokens) {
    var out = '', at = 0;
    tokens.forEach(function (t) { out += text.slice(at, t.start); at = t.end; });
    out += text.slice(at);
    return out.replace(/\s{2,}/g, ' ').trim();
  }

  /* ---------- typo catcher ---------- */
  function levenshtein(a, b) {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > 2) return 9;
    var prev = [], cur = [], i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur[0] = i;
      for (j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur.slice();
    }
    return prev[b.length];
  }

  function findSuspects(vocab) {
    var out = [];
    var seen = new Set();
    function push(kind, a, b, hint) {
      var k = kind + '|' + [a, b].sort().join('|');
      if (seen.has(k)) return;
      seen.add(k);
      out.push({ kind: kind, a: a, b: b, hint: hint });
    }
    // near-duplicate values inside one namespace
    vocab.namespaces.forEach(function (vals, ns) {
      var keys = Array.from(vals.keys());
      for (var i = 0; i < keys.length; i++) {
        for (var j = i + 1; j < keys.length; j++) {
          if (Math.min(keys[i].length, keys[j].length) < 4) continue;
          if (levenshtein(keys[i], keys[j]) <= 2) {
            var lo = vals.get(keys[i]).count <= vals.get(keys[j]).count ? keys[i] : keys[j];
            var hi = lo === keys[i] ? keys[j] : keys[i];
            push('value', '#' + ns + ':' + lo, '#' + ns + ':' + hi, 'used ' + vals.get(lo).count + '×');
          }
        }
      }
    });
    // near-duplicate namespace names
    var nss = Array.from(vocab.namespaces.keys());
    for (var a = 0; a < nss.length; a++) {
      for (var b = a + 1; b < nss.length; b++) {
        if (Math.min(nss[a].length, nss[b].length) < 4) continue;
        if (levenshtein(nss[a], nss[b]) <= 2) push('namespace', '#' + nss[a] + ':', '#' + nss[b] + ':', 'two columns');
      }
    }
    // a plain label one edit away from a known typed value — likely a mistyped column
    vocab.labels.forEach(function (info, lk) {
      if (lk.length < 4) return;
      vocab.valueIndex.forEach(function (ns, vk) {
        if (levenshtein(lk, vk) <= 2 && lk !== vk) {
          push('label', '#' + lk, '#' + vk, 'would be ' + ns + ':' + vk);
        }
      });
    });
    // dates that did not parse
    vocab.badDates.forEach(function (d) {
      push('date', d.raw, 'line ' + (d.line + 1), 'unrecognised date');
    });
    return out;
  }

  global.TT = {
    parseDocument: parseDocument, scanTokens: scanTokens, parseDate: parseDate,
    findSuspects: findSuspects, key: key, isoOf: isoOf, priorityRank: priorityRank,
    canonicalPriority: function (p) { return p ? PRIORITY_VALUES[key(p)] || null : null; },
    stripTokens: stripTokens, classify: classify
  };
})(typeof window !== 'undefined' ? window : globalThis);
