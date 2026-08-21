/* Subtasks.
   No new syntax: a todo indented further than the todo above it is a child of
   it, which is what indenting a list already means in plain text. This module
   turns that flat list of indents into a tree, rolls progress up it, and works
   out the text edit a checkbox click implies — ticking a parent finishes its
   children, and finishing the last child finishes the parent. */
(function (global) {
  'use strict';

  var CHECK_RE = /\[([ xX])\]/;

  /* ---------- tree ---------- */
  // Idempotent: safe to call on a doc that already has one.
  function build(doc) {
    var stack = [];                       // open ancestors, shallowest first
    doc.todos.forEach(function (t) {
      t.children = [];
      t.parent = null;
      while (stack.length && stack[stack.length - 1].indent >= t.indent) stack.pop();
      if (stack.length) {
        t.parent = stack[stack.length - 1];
        t.parent.children.push(t);
      }
      t.depth = stack.length;
      stack.push(t);
    });

    // Children always sit below their parent, so one backwards pass rolls the
    // whole tree up. Progress counts every descendant, not just direct ones:
    // "3/8" should mean eight things need doing, however they are nested.
    for (var i = doc.todos.length - 1; i >= 0; i--) {
      var t = doc.todos[i];
      t.subTotal = 0;
      t.subDone = 0;
      t.children.forEach(function (c) {
        t.subTotal += 1 + c.subTotal;
        t.subDone += (c.done ? 1 : 0) + c.subDone;
      });
      t.subOpen = t.subTotal - t.subDone;
      // some but not all of the work below is finished
      t.partial = !t.done && t.subDone > 0 && t.subDone < t.subTotal;
    }
    return doc;
  }

  function byLine(doc, lineNo) {
    for (var i = 0; i < doc.todos.length; i++) if (doc.todos[i].line === lineNo) return doc.todos[i];
    return null;
  }

  function descendants(todo, out) {
    out = out || [];
    (todo.children || []).forEach(function (c) { out.push(c); descendants(c, out); });
    return out;
  }

  function ancestors(todo) {
    var out = [];
    for (var p = todo.parent; p; p = p.parent) out.push(p);
    return out;
  }

  // The last line the subtree occupies. Anything written between a parent and
  // its last subtask — a note, a bullet — belongs to the block and travels
  // with it, so the range is contiguous rather than a set of todo lines.
  function blockEnd(todo) {
    var kids = descendants(todo);
    return kids.reduce(function (n, c) { return Math.max(n, c.line); }, todo.line);
  }

  /* ---------- ticking ---------- */
  // What ticking one checkbox means for the rest of the tree, as a whole-text
  // rewrite. Returns null when the line is not a todo, so callers can fall
  // back to their own plain toggle.
  function toggle(doc, lineNo) {
    var t = byLine(doc, lineNo);
    if (!t) return null;
    var next = !t.done;

    var want = new Map();
    want.set(t.line, next);
    // finishing a task finishes what it was made of; reopening it reopens them
    descendants(t).forEach(function (c) { want.set(c.line, next); });

    if (next) {
      // upwards only as far as the truth carries: a parent is finished when
      // every child of it is, so the walk stops at the first one that isn't
      ancestors(t).forEach(function (p) {
        if (!want.has(p.line) && allChildrenDone(p, want)) want.set(p.line, true);
      });
    } else {
      // reopening any part reopens everything it belongs to
      ancestors(t).forEach(function (p) { want.set(p.line, false); });
    }

    return rewrite(doc.text, want);
  }

  function allChildrenDone(parent, want) {
    return parent.children.every(function (c) {
      return want.has(c.line) ? want.get(c.line) : c.done;
    });
  }

  function rewrite(text, want) {
    var lines = String(text).split('\n');
    want.forEach(function (done, no) {
      if (lines[no] === undefined) return;
      lines[no] = lines[no].replace(CHECK_RE, done ? '[x]' : '[ ]');
    });
    return lines.join('\n');
  }

  /* ---------- authoring ---------- */
  // Tab and Shift+Tab over whole lines: how a todo is made into a subtask, and
  // how it is promoted back out.
  var UNIT = '  ';

  function shiftLines(text, from, to, out) {
    var lines = String(text).split('\n');
    var changed = 0, firstDelta = 0;
    for (var i = from; i <= to && i < lines.length; i++) {
      var before = lines[i];
      if (out) {
        lines[i] = before.replace(/^ {1,2}|^\t/, '');
      } else {
        if (!before.trim()) continue;         // never indent a blank line into nothing
        lines[i] = UNIT + before;
      }
      var d = lines[i].length - before.length;
      if (i === from) firstDelta = d;
      changed += d;
    }
    return { text: lines.join('\n'), delta: changed, firstDelta: firstDelta };
  }

  global.Subtasks = {
    build: build, toggle: toggle, byLine: byLine,
    descendants: descendants, ancestors: ancestors, blockEnd: blockEnd,
    shiftLines: shiftLines
  };
})(typeof window !== 'undefined' ? window : globalThis);
