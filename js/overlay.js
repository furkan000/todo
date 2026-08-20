/* Keeps absolutely-positioned layers pinned to a textarea's text box.
   Both the syntax layer and the find highlights ride on this, so they can never
   drift apart from each other or from the text. */
(function (global) {
  'use strict';

  var pairs = [];
  var bound = false;

  function register(editor, layer) {
    var pair = { ed: editor, layer: layer };
    pairs.push(pair);
    if (!bound) {
      bound = true;
      editor.addEventListener('scroll', syncAll);
      window.addEventListener('resize', syncAll);
    }
    sync(pair);
    return pair;
  }

  // Mirror the textarea's own metrics rather than duplicating them in CSS —
  // the editor's font and padding change with the layout mode.
  function sync(p) {
    var cs = getComputedStyle(p.ed), l = p.layer.style;
    l.fontFamily = cs.fontFamily;
    l.fontSize = cs.fontSize;
    l.fontWeight = cs.fontWeight;
    l.lineHeight = cs.lineHeight;
    l.letterSpacing = cs.letterSpacing;
    l.tabSize = cs.tabSize;
    l.padding = cs.padding;
    l.width = p.ed.clientWidth + 'px';
    p.layer.scrollTop = p.ed.scrollTop;
  }

  function syncAll() { pairs.forEach(sync); }

  global.Overlay = { register: register, sync: syncAll };
})(typeof window !== 'undefined' ? window : globalThis);
