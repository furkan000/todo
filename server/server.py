#!/usr/bin/env python3
"""Plain Text Todo, served with its storage on this machine.

Standard library only — nothing to install, which is the same bargain the rest
of the app makes. It does two things:

  1. serves the app. `/` is the app keeping its data in the browser, as it
     always has; `/<name>` is the same app keeping `<name>`'s data here.
  2. keeps each name's data as plain files under DATA_DIR/<name>/, one file per
     storage key. `ptt.doc.v1` in there is the text itself, readable as it is.

There is no authentication. A name is an address, not a secret: anyone who can
reach the server and knows or guesses a name can read and overwrite what is
under it. Run it on a network you trust, or put something in front of it.

    GET  /api/<name>          everything: {"keys": {key: {"rev": n, "value": s}}}
    GET  /api/<name>/revs     just the revisions: {key: n}
    PUT  /api/<name>/<key>    body is the value; answers {"rev": n}
                              `If-Match: n` makes it conditional -> 409 if stale

A revision is a per-key counter. It is what lets a second device notice that the
text changed underneath it rather than quietly overwrite it.

Backups: once an hour, if anything was saved since the last one, the whole data
folder is copied to DATA_DIR/.backups/<YYYY-MM-DDTHH-MM>/. Snapshots older than
three days are deleted, except the newest, which is always kept — a quiet week
must not leave you with no backup at all. To restore, copy a name's folder back
out of a snapshot while the server is stopped.
"""
import argparse
import json
import shutil
import time
import mimetypes
import os
import re
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit

APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

NAME_RE = re.compile(r'^[a-z0-9][a-z0-9_-]{0,39}$')
KEY_RE = re.compile(r'^ptt\.[a-z0-9]+(\.[a-z0-9]+)*$')
# a name is also a path on this server, so it may not be one the app needs
RESERVED = {'api', 'css', 'js', 'test', 'scripts', 'server', 'data', 'temp', 'index', 'favicon'}
STATIC_DIRS = ('css', 'js')          # everything else in the repo stays private
MAX_BODY = 5 * 1024 * 1024
MAX_KEYS = 32
REVS = 'revs.json'
BACKUPS = '.backups'                 # a dot, so it can never be anyone's name
STAMP = '%Y-%m-%dT%H-%M'

lock = threading.Lock()              # one process, a handful of people: one lock


def valid_name(name):
    return bool(NAME_RE.match(name)) and name not in RESERVED


class Store:
    """The files. Every write lands whole or not at all."""

    def __init__(self, root):
        self.root = root

    def _dir(self, name):
        return os.path.join(self.root, name)

    def _revs(self, name):
        try:
            with open(os.path.join(self._dir(name), REVS), encoding='utf-8') as f:
                revs = json.load(f)
            return {k: int(v) for k, v in revs.items() if KEY_RE.match(k)}
        except (OSError, ValueError):
            return {}

    def _write(self, path, data):
        fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix='.tmp-')
        try:
            with os.fdopen(fd, 'wb') as f:
                f.write(data)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, path)
        except BaseException:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise

    def revs(self, name):
        with lock:
            return self._revs(name)

    def all(self, name):
        with lock:
            out = {}
            for key, rev in self._revs(name).items():
                try:
                    with open(os.path.join(self._dir(name), key), encoding='utf-8') as f:
                        out[key] = {'rev': rev, 'value': f.read()}
                except OSError:
                    pass
            return out

    def put(self, name, key, value, expect=None):
        """Returns (ok, rev). `expect` is the revision the writer last saw."""
        with lock:
            revs = self._revs(name)
            have = revs.get(key, 0)
            if expect is not None and expect != have:
                return False, have
            if key not in revs and len(revs) >= MAX_KEYS:
                raise ValueError('too many keys')
            os.makedirs(self._dir(name), exist_ok=True)
            self._write(os.path.join(self._dir(name), key), value)
            revs[key] = have + 1
            self._write(os.path.join(self._dir(name), REVS),
                        json.dumps(revs, sort_keys=True).encode('utf-8'))
            return True, have + 1


class Backups:
    """Hourly snapshots of the data folder, taken only when something changed.

    What changed is read off the revision files: every save bumps one, so the
    revisions of every name together are a fingerprint of the whole store. A
    snapshot carries the fingerprint it was taken at, and the next one is only
    taken when the store's differs. `run(now)` takes the moment as an argument,
    so the tests can drive three days in no time."""

    def __init__(self, data, keep_s=3 * 24 * 3600):
        self.data = data
        self.dir = os.path.join(data, BACKUPS)
        self.keep_s = keep_s

    def _names(self):
        try:
            return sorted(n for n in os.listdir(self.data)
                          if valid_name(n) and os.path.isdir(os.path.join(self.data, n)))
        except OSError:
            return []

    def fingerprint(self):
        out = {}
        for n in self._names():
            try:
                with open(os.path.join(self.data, n, REVS), encoding='utf-8') as f:
                    out[n] = json.load(f)
            except (OSError, ValueError):
                pass
        return json.dumps(out, sort_keys=True)

    def snapshots(self):
        """[(taken_at, path)], oldest first. Anything not named by a stamp is ignored."""
        out = []
        try:
            entries = os.listdir(self.dir)
        except OSError:
            return out
        for e in entries:
            try:
                out.append((time.mktime(time.strptime(e, STAMP)), os.path.join(self.dir, e)))
            except ValueError:
                pass
        return sorted(out)

    def _last_fingerprint(self):
        snaps = self.snapshots()
        if not snaps:
            return None
        try:
            with open(os.path.join(snaps[-1][1], 'fingerprint.json'), encoding='utf-8') as f:
                return f.read()
        except OSError:
            return None

    def run(self, now=None):
        """Take a snapshot if anything changed, then prune. Returns its path or None."""
        now = time.time() if now is None else now
        taken = None
        with lock:                    # no save lands halfway through the copy
            fp = self.fingerprint()
            if fp != '{}' and fp != self._last_fingerprint():
                final = os.path.join(self.dir, time.strftime(STAMP, time.localtime(now)))
                if not os.path.exists(final):
                    tmp = os.path.join(self.dir, '.tmp-' + os.path.basename(final))
                    shutil.rmtree(tmp, ignore_errors=True)
                    os.makedirs(tmp)
                    for n in self._names():
                        shutil.copytree(os.path.join(self.data, n), os.path.join(tmp, n),
                                        ignore=shutil.ignore_patterns('.tmp-*'))
                    with open(os.path.join(tmp, 'fingerprint.json'), 'w', encoding='utf-8') as f:
                        f.write(fp)
                    os.rename(tmp, final)   # a snapshot is there whole, or not at all
                    taken = final
        self.prune(now)
        return taken

    def prune(self, now):
        snaps = self.snapshots()
        for at, path in snaps[:-1]:   # never the newest
            if now - at > self.keep_s:
                shutil.rmtree(path, ignore_errors=True)

    def loop(self, every_s):
        while True:
            try:
                self.run()
            except Exception as e:    # a failed backup must not take the server down
                print('backup failed: %s' % e, file=sys.stderr, flush=True)
            time.sleep(every_s)


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    server_version = 'PlainTextTodo'
    store = None
    verbose = False

    # a save every few keystrokes would bury the journal; only trouble is logged
    def log_request(self, code='-', size='-'):
        if self.verbose or (isinstance(code, int) and code >= 500):
            super().log_request(code, size)

    def _send(self, code, body=b'', ctype='application/json', extra=None):
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-cache')
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def _json(self, code, obj):
        self._send(code, json.dumps(obj).encode('utf-8'), 'application/json; charset=utf-8')

    def _error(self, code, msg):
        self._json(code, {'error': msg})

    def _parts(self):
        path = unquote(urlsplit(self.path).path)
        return path, [p for p in path.split('/') if p]

    def _static(self, rel):
        full = os.path.realpath(os.path.join(APP_DIR, rel))
        if not full.startswith(APP_DIR + os.sep) or not os.path.isfile(full):
            return self._error(404, 'not found')
        ctype = mimetypes.guess_type(full)[0] or 'application/octet-stream'
        if ctype.startswith('text/') or ctype in ('application/javascript', 'application/json'):
            ctype += '; charset=utf-8'
        with open(full, 'rb') as f:
            self._send(200, f.read(), ctype)

    def do_GET(self):
        path, parts = self._parts()
        if parts[:1] == ['api']:
            return self._api_get(parts[1:])
        if not parts or parts == ['index.html']:
            return self._static('index.html')
        if len(parts) == 1 and valid_name(parts[0].lower()):
            # the app's own links are relative, so the name must be the last
            # segment with nothing after it — and one spelling, so one record
            if path != '/' + parts[0].lower():
                return self._send(301, extra={'Location': '/' + parts[0].lower()})
            return self._static('index.html')
        if parts[0] in STATIC_DIRS and '..' not in parts:
            return self._static(os.path.join(*parts))
        self._error(404, 'not found')

    do_HEAD = do_GET

    def _api_get(self, parts):
        if not parts or not valid_name(parts[0]):
            return self._error(400, 'bad name')
        if len(parts) == 1:
            return self._json(200, {'name': parts[0], 'keys': self.store.all(parts[0])})
        if parts[1:] == ['revs']:
            return self._json(200, self.store.revs(parts[0]))
        self._error(404, 'not found')

    def do_PUT(self):
        _, parts = self._parts()
        try:
            length = int(self.headers.get('Content-Length', ''))
        except ValueError:
            self.close_connection = True
            return self._error(411, 'length required')
        if length > MAX_BODY:
            self.close_connection = True
            return self._error(413, 'too large')
        body = self.rfile.read(length)
        if len(parts) != 3 or parts[0] != 'api':
            return self._error(404, 'not found')
        if not valid_name(parts[1]):
            return self._error(400, 'bad name')
        if not KEY_RE.match(parts[2]):
            return self._error(400, 'bad key')
        try:
            body.decode('utf-8')
        except UnicodeDecodeError:
            return self._error(400, 'not utf-8')
        expect = self.headers.get('If-Match')
        if expect is not None:
            try:
                expect = int(expect.strip('"'))
            except ValueError:
                return self._error(400, 'bad If-Match')
        try:
            ok, rev = self.store.put(parts[1], parts[2], body, expect)
        except ValueError as e:
            return self._error(400, str(e))
        self._json(200 if ok else 409, {'rev': rev})


def make_server(host, port, data_dir, verbose=False):
    os.makedirs(data_dir, exist_ok=True)
    handler = type('BoundHandler', (Handler,), {'store': Store(data_dir), 'verbose': verbose})
    return ThreadingHTTPServer((host, port), handler)


def main():
    ap = argparse.ArgumentParser(description='Serve Plain Text Todo with server-side storage.')
    ap.add_argument('--host', default=os.environ.get('HOST', '127.0.0.1'))
    ap.add_argument('--port', type=int, default=int(os.environ.get('PORT', '3111')))
    ap.add_argument('--data', default=os.environ.get('DATA_DIR', os.path.join(APP_DIR, 'data')),
                    help='where the data is kept (default: data/ beside the app)')
    ap.add_argument('--verbose', action='store_true', help='log every request')
    ap.add_argument('--backup-every', type=float, default=60, metavar='MIN',
                    help='minutes between backups, 0 to turn them off (default: 60)')
    ap.add_argument('--backup-keep', type=float, default=72, metavar='HOURS',
                    help='how long a backup is kept (default: 72)')
    args = ap.parse_args()

    data = os.path.abspath(args.data)
    httpd = make_server(args.host, args.port, data, args.verbose)
    if args.backup_every > 0:
        backups = Backups(data, args.backup_keep * 3600)
        threading.Thread(target=backups.loop, args=(args.backup_every * 60,), daemon=True).start()
    print('Plain Text Todo -> http://%s:%d/<name>   (data in %s)'
          % (args.host, args.port, os.path.abspath(args.data)), flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == '__main__':
    sys.exit(main())
