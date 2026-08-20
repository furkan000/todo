/* Archive: move finished todos to a Done section at the end of the document.
   They keep their tags, their dates and the section they came from — that
   section becomes a subsection under Done — so nothing is lost, it just stops
   competing for attention at the top of the file. */
(function (global) {
  'use strict';

  var HEADING = 'Done';
  var HEAD_RE = /^(#{1,6})\s+(.*?)\s*$/;

  function heading(line) {
    var m = HEAD_RE.exec(line);
    return m ? { level: m[1].length, title: m[2] } : null;
  }

  // A todo already sitting under Done is home; only the rest need moving.
  function isArchived(todo) {
    if (!todo.section) return false;
    if (todo.section.title === HEADING) return true;
    return todo.section.path.indexOf(HEADING) !== -1;
  }

  function pending(doc) {
    return doc.todos.filter(function (t) { return t.done && !isArchived(t); });
  }

  // Returns the new document text, or null when there is nothing to move.
  function apply(doc) {
    var items = pending(doc);
    if (!items.length) return null;

    var lines = doc.text.split('\n');
    var remove = {};
    items.forEach(function (t) { remove[t.line] = true; });

    // group in document order, keyed by the heading each todo lived under
    var groups = [], index = {};
    items.forEach(function (t) {
      var name = t.section ? t.section.title : '';
      if (!(name in index)) { index[name] = { name: name, lines: [] }; groups.push(index[name]); }
      index[name].lines.push(lines[t.line]);
    });

    var kept = lines.filter(function (_, i) { return !remove[i]; });
    return tidy(insert(collapse(kept), groups)).join('\n');
  }

  // Pulling lines out can leave a stack of blank lines behind; one is enough.
  function collapse(lines) {
    var out = [];
    lines.forEach(function (l) {
      if (!l.trim() && out.length && !out[out.length - 1].trim()) return;
      out.push(l);
    });
    return out;
  }

  function tidy(lines) {
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    lines.push('');
    return lines;
  }

  function insert(lines, groups) {
    var at = findDone(lines);
    if (!at) return append(lines, groups);

    groups.forEach(function (g) {
      var target = subsection(lines, at, g.name);
      var block = g.lines.slice();
      if (target === -1) {
        // no such subsection yet — start one at the end of Done
        var end = at.end;
        var add = [];
        if (lines[end - 1] && lines[end - 1].trim()) add.push('');
        if (g.name) { add.push('#'.repeat(at.level + 1) + ' ' + g.name, ''); }
        lines.splice.apply(lines, [end, 0].concat(add, block));
        at.end += add.length + block.length;
      } else {
        // a heading needs a blank line under it before its first item
        if (target > 0 && heading(lines[target - 1])) block.unshift('');
        lines.splice.apply(lines, [target, 0].concat(block));
        at.end += block.length;
      }
    });
    return lines;
  }

  function append(lines, groups) {
    var out = lines.slice();
    while (out.length && !out[out.length - 1].trim()) out.pop();
    out.push('', '## ' + HEADING, '');
    groups.forEach(function (g, i) {
      if (i) out.push('');
      if (g.name) out.push('### ' + g.name, '');
      out.push.apply(out, g.lines);
    });
    return out;
  }

  // The Done section runs from its heading to the next heading of the same or
  // higher rank, or to the end of the document.
  function findDone(lines) {
    for (var i = 0; i < lines.length; i++) {
      var h = heading(lines[i]);
      if (!h || h.title !== HEADING) continue;
      for (var j = i + 1; j < lines.length; j++) {
        var next = heading(lines[j]);
        if (next && next.level <= h.level) return { start: i, end: j, level: h.level };
      }
      return { start: i, end: lines.length, level: h.level };
    }
    return null;
  }

  // Where new lines for this group should land inside the Done section. The
  // insert point sits after the last line of content, not after the blank that
  // separates it from whatever comes next — otherwise the blank ends up inside
  // the block and the next heading loses its breathing room.
  function afterContent(lines, from, limit) {
    var k = limit;
    while (k > from && !lines[k - 1].trim()) k--;
    return k;
  }

  function subsection(lines, at, name) {
    var i, j, h;
    if (!name) {
      // sectionless todos sit directly under the Done heading, above any subsection
      for (i = at.start + 1; i < at.end; i++) {
        if (heading(lines[i])) return afterContent(lines, at.start + 1, i);
      }
      return afterContent(lines, at.start + 1, at.end);
    }
    for (i = at.start + 1; i < at.end; i++) {
      h = heading(lines[i]);
      if (!h || h.title !== name) continue;
      for (j = i + 1; j < at.end; j++) {
        if (heading(lines[j])) return afterContent(lines, i + 1, j);
      }
      return afterContent(lines, i + 1, at.end);
    }
    return -1;
  }

  global.Archive = { pending: pending, apply: apply, heading: HEADING };
})(typeof window !== 'undefined' ? window : globalThis);
