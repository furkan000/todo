/* Music: a catalogue of YouTube videos and playlists, played as sound only.

   Three layers, as separate as the timer's:

   - a library. Plain objects in localStorage, and a parser that turns anything
     you might paste — a watch URL, a youtu.be link, a playlist page, a bare ID —
     into one of two shapes. No network, no DOM, so the interesting half is
     testable on its own.

   - a player that is deliberately never seen. YouTube has no audio-only embed,
     so the iframe is real and playing; it just lives off the left edge of the
     window. You asked for music, not for something to watch, and a video you
     cannot see cannot compete with the document for your attention.

   - two faces, like the timer: the full catalogue in its own tab, and a
     transport in the status bar that is there in every view.

   Where you were in each of them is remembered too, in `js/resume.js` — a
   position is volatile data written every few seconds, so it is kept apart from
   the catalogue rather than rewriting it that often. Nothing plays by itself on
   a reload; the next press of play picks up where the last one left off.

   The IFrame Player API is fetched from YouTube the first time you press play —
   not at boot — so the app still starts, parses and renders with no network at
   all. Every call into the player is guarded; if the script never arrives you
   still have your catalogue, just no sound. */
(function (global) {
  'use strict';

  var KEY = 'ptt.music.v1';
  var API = 'https://www.youtube.com/iframe_api';
  var EMBED = 'https://www.youtube-nocookie.com';

  /* ---------- what you pasted ---------- */

  // Returns { kind: 'video', videoId } or { kind: 'playlist', playlistId, videoId }
  // or null. A link that carries both — `watch?v=X&list=Y` — is taken as the
  // playlist, since that is the thing with more music in it.
  function parse(input) {
    if (!input) return null;
    var s = String(input).trim();
    if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return { kind: 'video', videoId: s };
    if (/^(PL|RD|OL|UU|LL|FL)[a-zA-Z0-9_-]{10,}$/.test(s)) return { kind: 'playlist', playlistId: s };

    var u;
    try { u = new URL(s); } catch (e) { return null; }
    var host = u.hostname.replace(/^www\./, '');
    if (host !== 'youtu.be' && !/(^|\.)youtube\.com$/.test(host) && !/(^|\.)youtube-nocookie\.com$/.test(host)) return null;

    var list = u.searchParams.get('list');
    var vid = null;
    if (host === 'youtu.be') {
      vid = u.pathname.slice(1).split('/')[0] || null;
    } else if (u.pathname === '/watch') {
      vid = u.searchParams.get('v');
    } else if (u.pathname !== '/playlist') {
      var parts = u.pathname.split('/').filter(Boolean);
      if (['embed', 'shorts', 'v', 'live'].indexOf(parts[0]) !== -1) vid = parts[1] || null;
    }
    if (vid && !/^[a-zA-Z0-9_-]{11}$/.test(vid)) vid = null;

    if (list) return { kind: 'playlist', playlistId: list, videoId: vid };
    if (vid) return { kind: 'video', videoId: vid };
    return null;
  }

  function keyOf(ref) {
    return (ref.kind === 'playlist' ? 'p:' : 'v:') + (ref.playlistId || ref.videoId);
  }

  function thumbOf(entry) {
    return entry.videoId ? 'https://i.ytimg.com/vi/' + entry.videoId + '/mqdefault.jpg' : '';
  }

  // A mix (RD…) is generated per-viewer and often refuses to embed at all; worth
  // saying so at the moment of adding rather than leaving a dead row behind.
  function isMix(entry) {
    return entry.kind === 'playlist' && /^(RD|UL)/.test(entry.playlistId || '');
  }

  /* ---------- the library ---------- */

  var lib = [], active = null;

  function read() {
    try {
      var raw = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (!raw) return { items: [], active: null };
      var items = (raw.items || []).filter(function (e) { return e && e.key && (e.videoId || e.playlistId); });
      return { items: items, active: typeof raw.active === 'string' ? raw.active : null };
    } catch (e) { return { items: [], active: null }; }
  }

  function write() {
    try { localStorage.setItem(KEY, JSON.stringify({ items: lib, active: active })); } catch (e) {}
  }

  function all() { return lib.slice(); }
  function find(key) {
    for (var i = 0; i < lib.length; i++) if (lib[i].key === key) return lib[i];
    return null;
  }
  function activeKey() { return active; }
  function current() { return active ? find(active) : null; }

  // Returns the entry, or null when the input made no sense, or the existing
  // entry when it is already here — adding the same playlist twice is a no-op,
  // not a second row.
  function add(input, meta) {
    var ref = parse(input);
    if (!ref) return null;
    var key = keyOf(ref), had = find(key);
    if (had) return had;
    var entry = {
      key: key, kind: ref.kind,
      videoId: ref.videoId || null,
      playlistId: ref.playlistId || null,
      title: (meta && meta.title) || '',
      author: (meta && meta.author_name) || '',
      thumbnail: (meta && meta.thumbnail_url) || '',
      added: Date.now()
    };
    if (!entry.thumbnail) entry.thumbnail = thumbOf(entry);
    if (!entry.title) entry.title = ref.kind === 'playlist' ? (isMix(entry) ? 'YouTube mix' : 'Playlist') : ref.videoId;
    lib.unshift(entry);
    write();
    return entry;
  }

  function remove(key) {
    var before = lib.length;
    lib = lib.filter(function (e) { return e.key !== key; });
    if (active === key) { active = null; stop(); }
    if (global.Resume) global.Resume.forget(key);
    write();
    return lib.length !== before;
  }

  function clear() {
    lib = []; active = null; stop();
    if (global.Resume) global.Resume.forgetAll();
    write();
  }

  // The library is the queue: when a single video ends, the next row plays.
  function neighbour(key, step) {
    for (var i = 0; i < lib.length; i++) {
      if (lib[i].key !== key) continue;
      var j = i + step;
      return j >= 0 && j < lib.length ? lib[j] : null;
    }
    return null;
  }

  /* ---------- the metadata ---------- */

  // oEmbed is the only YouTube endpoint that answers a browser directly. It can
  // fail — no network, or a `file://` origin it does not like — and that is
  // survivable: the entry keeps the ID as its name and the thumbnail still
  // resolves, because that URL is guessable from the video ID.
  function fetchMeta(ref) {
    if (!global.fetch) return Promise.resolve(null);
    var page = ref.kind === 'playlist'
      ? 'https://www.youtube.com/playlist?list=' + ref.playlistId
      : 'https://www.youtube.com/watch?v=' + ref.videoId;
    var url = 'https://www.youtube.com/oembed?url=' + encodeURIComponent(page) + '&format=json';
    return global.fetch(url).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }

  /* ---------- the player you never see ---------- */

  var yt = null, sink = null, loading = false, wanted = null, disabled = false;
  var state = { playing: false, track: '', ready: false };
  var onChange = null;

  function notify() { if (onChange) onChange(); }

  function loadApi() {
    if (disabled || loading || global.YT && global.YT.Player) return;
    loading = true;
    var prev = global.onYouTubeIframeAPIReady;
    global.onYouTubeIframeAPIReady = function () {
      if (typeof prev === 'function') prev();
      loading = false;
      if (wanted) mount(wanted);
    };
    var s = document.createElement('script');
    s.src = API;
    s.async = true;
    s.onerror = function () { loading = false; };
    document.head.appendChild(s);
  }

  // Off the left edge of the window at a real size. Not `display: none` and not
  // zero-sized: browsers throttle or refuse to start playback in an iframe they
  // consider invisible, and the point is for it to keep running.
  function ensureSink() {
    if (sink && sink.parentNode) return sink;
    sink = document.createElement('div');
    sink.className = 'music-sink';
    sink.setAttribute('aria-hidden', 'true');
    sink.innerHTML = '<div id="music-frame"></div>';
    document.body.appendChild(sink);
    return sink;
  }

  // One trap worth naming: `getPlaylistIndex()` and `loadPlaylist({index})` are
  // 0-based, but the `index` player *parameter* is 1-based. We store what the
  // player reports — 0-based — and add the one only here.
  function vars(entry, at) {
    var v = { autoplay: 1, rel: 0, modestbranding: 1, playsinline: 1 };
    if (at && at.t) v.start = at.t;
    if (entry.kind === 'playlist') {
      v.list = entry.playlistId;
      if (!entry.videoId) v.listType = 'playlist';
      if (at && at.index) v.index = at.index + 1;
    }
    return v;
  }

  function mount(entry) {
    wanted = entry;
    if (disabled) return;
    if (!global.YT || !global.YT.Player) return loadApi();
    ensureSink();
    var at = resumeAt(entry);
    if (yt && yt.loadVideoById) {
      try {
        if (entry.kind === 'playlist') yt.loadPlaylist({ list: entry.playlistId, index: at.index, startSeconds: at.t });
        else yt.loadVideoById({ videoId: entry.videoId, startSeconds: at.t });
        return;
      } catch (e) { /* fall through and rebuild it */ }
    }
    try {
      if (yt && yt.destroy) yt.destroy();
      sink.innerHTML = '<div id="music-frame"></div>';
      yt = new global.YT.Player('music-frame', {
        host: EMBED, width: '320', height: '180',
        videoId: entry.kind === 'playlist' ? undefined : entry.videoId,
        playerVars: vars(entry, at),
        events: {
          onReady: function (e) { state.ready = true; try { e.target.playVideo(); } catch (x) {} notify(); },
          onStateChange: onPlayerState,
          onError: function () { state.playing = false; notify(); }
        }
      });
    } catch (e) { yt = null; }
  }

  function onPlayerState(e) {
    var S = global.YT && global.YT.PlayerState;
    state.playing = !!S && e.data === S.PLAYING;
    capture();
    watch(state.playing);
    try {
      var d = e.target.getVideoData && e.target.getVideoData();
      if (d && d.title) state.track = d.title;
    } catch (x) {}
    // a single video running out hands over to the next row in the catalogue
    if (S && e.data === S.ENDED && active) {
      var cur = find(active);
      if (cur && cur.kind !== 'playlist') {
        var next = neighbour(active, 1);
        if (next) play(next.key);
      }
    }
    notify();
  }

  /* ---------- where you were ---------- */

  var beat = null;

  // Where this entry left off, in the shape mount() needs. Inside a playlist
  // the track and the seconds into it are two separate facts, and either can be
  // remembered without the other.
  function resumeAt(entry) {
    var R = global.Resume, m = R && R.get(entry.key);
    if (!m) return { t: 0, index: 0 };
    return {
      t: m.t > 0 ? m.t : 0,
      index: entry.kind === 'playlist' && typeof m.index === 'number' && m.index > 0 ? m.index : 0
    };
  }

  // Read out of the player rather than counted alongside it — the bargain the
  // timer makes with the clock. Whatever the iframe really did while the tab was
  // throttled, backgrounded or skipped through, this is the truth of it.
  function capture() {
    var R = global.Resume, cur = current();
    if (!R || !cur || !yt || typeof yt.getCurrentTime !== 'function') return;
    try {
      var pos = { t: yt.getCurrentTime(), duration: yt.getDuration ? yt.getDuration() : 0 };
      if (cur.kind === 'playlist') {
        var d = yt.getVideoData && yt.getVideoData();
        pos.videoId = d && d.video_id;
        pos.index = yt.getPlaylistIndex ? yt.getPlaylistIndex() : null;
      }
      R.mark(cur.key, pos);
    } catch (e) {}
  }

  // The interval runs only while something is playing: a paused position is
  // already written and is not going anywhere on its own.
  function watch(on) {
    if (on && !beat) beat = setInterval(capture, 5000);
    if (!on && beat) { clearInterval(beat); beat = null; }
  }

  function call(name) {
    if (!yt || typeof yt[name] !== 'function') return false;
    try { yt[name](); return true; } catch (e) { return false; }
  }

  function play(key) {
    var entry = find(key);
    if (!entry) return null;
    active = key;
    state.track = entry.kind === 'playlist' ? '' : entry.title;
    write();
    mount(entry);
    notify();
    return entry;
  }

  function stop() {
    call('stopVideo');
    state.playing = false;
    state.track = '';
    notify();
  }

  function toggle() {
    if (!active) {
      if (!lib.length) return;
      return play(lib[0].key);
    }
    if (!yt) return mount(find(active));
    if (state.playing) { call('pauseVideo'); state.playing = false; }
    else { call('playVideo'); state.playing = true; }
    notify();
  }

  // Inside a playlist the player knows what comes next; outside one, the
  // catalogue is the running order.
  function step(dir) {
    var cur = current();
    if (!cur) return;
    if (cur.kind === 'playlist' && yt) {
      call(dir > 0 ? 'nextVideo' : 'previousVideo');
      return;
    }
    var next = neighbour(cur.key, dir);
    if (next) play(next.key);
  }

  function volume(v) {
    if (v === undefined) {
      if (!yt || !yt.getVolume) return null;
      try { return yt.getVolume(); } catch (e) { return null; }
    }
    if (yt && yt.setVolume) { try { yt.setVolume(Math.max(0, Math.min(100, v))); } catch (e) {} }
  }

  function playing() { return state.playing; }
  function track() {
    var cur = current();
    if (!cur) return '';
    return state.track || cur.title || '';
  }

  /* ---------- the catalogue ---------- */

  function esc(s) { return global.Views ? global.Views.esc(s) : String(s); }

  // A row that has a position says so, quietly, and only when it is not the row
  // playing — on that one the number would be stale the moment it was painted.
  function whereAt(e) {
    var R = global.Resume, m = R && R.get(e.key);
    if (!m) return '';
    var track = e.kind === 'playlist' && m.index > 0 ? 'track ' + (m.index + 1) : '';
    var time = m.t > 0 ? R.format(m.t) : '';
    if (!track && !time) return '';
    return 'Left at ' + (track && time ? track + ', ' + time : track || time);
  }

  function rowHTML(e) {
    var on = e.key === active;
    var where = on ? '' : whereAt(e);
    var sub = [];
    if (e.author) sub.push(esc(e.author));
    if (where) sub.push('<span class="mu-at">' + esc(where) + '</span>');
    return '<li class="mu-row' + (on ? ' on' : '') + '" data-music-play="' + esc(e.key) + '">' +
      (e.thumbnail ? '<img class="mu-thumb" src="' + esc(e.thumbnail) + '" alt="" loading="lazy">'
                   : '<span class="mu-thumb blank"></span>') +
      '<span class="mu-meta">' +
        '<span class="mu-title">' + esc(e.title) + '</span>' +
        '<span class="mu-sub">' +
          (e.kind === 'playlist' ? '<b class="mu-kind">Playlist</b>' : '') +
          sub.join(' · ') +
        '</span>' +
      '</span>' +
      (on ? '<span class="mu-on">' + (state.playing ? 'Playing' : 'Paused') + '</span>' : '') +
      '<button class="mu-del" data-music-remove="' + esc(e.key) + '" tabindex="-1" title="Remove from the catalogue">×</button>' +
    '</li>';
  }

  function catalogueHTML() {
    var html = '<div class="music-view">' +
      '<form class="mu-add" data-music-add>' +
        '<input type="url" name="url" placeholder="Paste a YouTube video or playlist link…" ' +
          'autocomplete="off" spellcheck="false" required>' +
        '<button type="submit">Add</button>' +
      '</form>' +
      '<p class="mu-note" data-music-note></p>';

    if (!lib.length) {
      html += '<div class="empty"><b>Nothing in the catalogue yet.</b>' +
        '<span>Paste a link to a video or a playlist. It plays as sound only — ' +
        'the player is real, it just lives off the edge of the window.</span></div>';
    } else {
      html += '<ul class="mu-list">' + lib.map(rowHTML).join('') + '</ul>';
    }
    return html + '</div>';
  }

  /* ---------- the transport in the status bar ---------- */

  var ICONS = {
    prev: '<svg viewBox="0 0 16 16"><path d="M12 3.5v9L6 8zM4.5 3.5v9"/></svg>',
    next: '<svg viewBox="0 0 16 16"><path d="M4 3.5v9L10 8zM11.5 3.5v9"/></svg>',
    play: '<svg viewBox="0 0 16 16"><path d="M4.5 3v10l8-5z"/></svg>',
    pause: '<svg viewBox="0 0 16 16"><path d="M5.5 3.2v9.6M10.5 3.2v9.6"/></svg>',
    note: '<svg viewBox="0 0 16 16"><path d="M6 12.2V3.4l7-1.5v8.4"/><circle cx="4.4" cy="12.4" r="1.7"/><circle cx="11.4" cy="10.6" r="1.7"/></svg>'
  };

  function barHTML() {
    var cur = current();
    if (!cur) {
      return '<button class="mu-mini mu-open" data-music="open" tabindex="-1" title="Music — nothing playing">' +
        ICONS.note + '</button>';
    }
    return '<button class="mu-mini" data-music="prev" tabindex="-1" title="Previous">' + ICONS.prev + '</button>' +
      '<button class="mu-mini play" data-music="toggle" tabindex="-1" title="' +
        (state.playing ? 'Pause' : 'Play') + '">' + (state.playing ? ICONS.pause : ICONS.play) + '</button>' +
      '<button class="mu-mini" data-music="next" tabindex="-1" title="Next">' + ICONS.next + '</button>' +
      '<button class="mu-now" data-music="open" tabindex="-1" title="' + esc(track()) + ' — open the catalogue">' +
        esc(track() || cur.title) + '</button>';
  }

  function paintBar() {
    var host = document.getElementById('music-bar');
    if (!host) return;
    var html = barHTML();
    if (host.innerHTML !== html) host.innerHTML = html;
    host.classList.toggle('idle', !current());
    host.classList.toggle('playing', state.playing);
  }

  /* ---------- wiring ---------- */

  var opts = {};

  function note(el, msg, bad) {
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'mu-note' + (bad ? ' bad' : '');
  }

  function onSubmit(form) {
    var input = form.querySelector('input[name="url"]');
    var el = document.querySelector('[data-music-note]');
    var ref = parse(input.value);
    if (!ref) return note(el, 'That does not look like a YouTube link or ID.', true);
    if (find(keyOf(ref))) return note(el, 'Already in the catalogue.', true);

    note(el, 'Looking it up…');
    var placed = add(input.value);          // in straight away, named later
    input.value = '';
    if (opts.refresh) opts.refresh();
    note(document.querySelector('[data-music-note]'),
         isMix(placed) ? 'Added. Mixes often refuse to embed — if it stays silent, add a video instead.' : '');

    fetchMeta(ref).then(function (meta) {
      if (!meta) return;
      var e = find(placed.key);
      if (!e) return;
      if (meta.title) e.title = meta.title;
      if (meta.author_name) e.author = meta.author_name;
      if (meta.thumbnail_url) e.thumbnail = meta.thumbnail_url;
      write();
      if (opts.refresh) opts.refresh();
      paintBar();
    });
  }

  function act(name, key) {
    if (name === 'toggle') return toggle();
    if (name === 'next') return step(1);
    if (name === 'prev') return step(-1);
    if (name === 'open' && opts.show) return opts.show('music');
    if (name === 'play') { play(key); if (opts.refresh) opts.refresh(); }
    if (name === 'remove') { remove(key); if (opts.refresh) opts.refresh(); }
  }

  function init(o) {
    opts = o || {};
    var stored = read();
    lib = stored.items;
    active = stored.active && stored.items.some(function (e) { return e.key === stored.active; }) ? stored.active : null;
    onChange = function () { paintBar(); if (opts.onChange) opts.onChange(); };

    document.addEventListener('submit', function (e) {
      var f = e.target.closest ? e.target.closest('[data-music-add]') : null;
      if (!f) return;
      e.preventDefault();
      onSubmit(f);
    });
    document.addEventListener('click', function (e) {
      if (!e.target.closest) return;
      var del = e.target.closest('[data-music-remove]');
      if (del) { e.preventDefault(); e.stopPropagation(); return act('remove', del.dataset.musicRemove); }
      var row = e.target.closest('[data-music-play]');
      if (row) { e.preventDefault(); return act('play', row.dataset.musicPlay); }
      var b = e.target.closest('[data-music]');
      if (b) { e.preventDefault(); act(b.dataset.music); }
    });

    // positions for rows that are no longer here have nothing to come back to
    if (global.Resume) global.Resume.keep(lib.map(function (e) { return e.key; }));

    // the last few seconds before the tab goes: `pagehide` covers a reload and a
    // close, `visibilitychange` covers a phone being locked, which often never
    // fires anything else
    global.addEventListener('pagehide', capture);
    document.addEventListener('visibilitychange', function () { if (document.hidden) capture(); });

    paintBar();
    return true;
  }

  global.Music = {
    KEY: KEY,
    parse: parse, keyOf: keyOf, isMix: isMix,
    all: all, find: find, add: add, remove: remove, clear: clear, neighbour: neighbour,
    read: read, write: write, activeKey: activeKey, current: current,
    play: play, stop: stop, toggle: toggle, step: step, volume: volume,
    playing: playing, track: track,
    resumeAt: resumeAt, capture: capture,
    catalogueHTML: catalogueHTML, barHTML: barHTML, paintBar: paintBar,
    init: init, act: act,
    // a seam for the tests: they exercise the catalogue, never the network
    silence: function () { disabled = true; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
