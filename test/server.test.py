#!/usr/bin/env python3
"""The storage server, driven over real HTTP against a throwaway data folder."""
import http.client
import importlib.util
import json
import os
import sys
import tempfile
import threading
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('server', os.path.join(HERE, '..', 'server', 'server.py'))
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)


class ServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.httpd = server.make_server('127.0.0.1', 0, cls.tmp.name)
        cls.port = cls.httpd.server_address[1]
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.tmp.cleanup()

    def req(self, method, path, body=None, headers=None):
        c = http.client.HTTPConnection('127.0.0.1', self.port, timeout=5)
        c.request(method, path, body=body, headers=headers or {})
        r = c.getresponse()
        data = r.read()
        c.close()
        return r, data

    def json(self, method, path, body=None, headers=None):
        r, data = self.req(method, path, body, headers)
        return r.status, json.loads(data)

    def test_the_app_is_served_at_the_root_and_at_a_name(self):
        for path in ('/', '/index.html', '/furkan'):
            r, data = self.req('GET', path)
            self.assertEqual(r.status, 200, path)
            self.assertIn(b'<textarea', data, path)
        r, data = self.req('GET', '/js/store.js')
        self.assertEqual(r.status, 200)
        self.assertIn('javascript', r.getheader('Content-Type'))

    def test_one_spelling_per_name(self):
        for path in ('/Furkan', '/furkan/'):
            r, _ = self.req('GET', path)
            self.assertEqual((r.status, r.getheader('Location')), (301, '/furkan'), path)

    def test_nothing_else_in_the_repo_is_served(self):
        self.json('PUT', '/api/secret/ptt.doc.v1', b'- [ ] private')
        for path in ('/data/secret/ptt.doc.v1', '/.git/config', '/temp/chat-summary.md',
                     '/README.md', '/server/server.py', '/js/../README.md',
                     '/js/%2e%2e/README.md', '/css/../data/secret/ptt.doc.v1'):
            r, data = self.req('GET', path)
            self.assertEqual(r.status, 404, path)
            self.assertNotIn(b'private', data, path)

    def test_a_record_round_trips(self):
        self.assertEqual(self.json('GET', '/api/ann'), (200, {'name': 'ann', 'keys': {}}))
        text = '- [ ] grüße ✓\n'.encode('utf-8')
        self.assertEqual(self.json('PUT', '/api/ann/ptt.doc.v1', text), (200, {'rev': 1}))
        self.assertEqual(self.json('PUT', '/api/ann/ptt.doc.v1', text + b'more'), (200, {'rev': 2}))
        status, got = self.json('GET', '/api/ann')
        self.assertEqual(got['keys'], {'ptt.doc.v1': {'rev': 2, 'value': '- [ ] grüße ✓\nmore'}})
        self.assertEqual(self.json('GET', '/api/ann/revs'), (200, {'ptt.doc.v1': 2}))
        # and the text is a plain file on disk
        with open(os.path.join(self.tmp.name, 'ann', 'ptt.doc.v1'), encoding='utf-8') as f:
            self.assertEqual(f.read(), '- [ ] grüße ✓\nmore')

    def test_names_are_separate(self):
        self.json('PUT', '/api/max/ptt.doc.v1', b'max')
        self.json('PUT', '/api/anna/ptt.doc.v1', b'anna')
        self.assertEqual(self.json('GET', '/api/max')[1]['keys']['ptt.doc.v1']['value'], 'max')
        self.assertEqual(self.json('GET', '/api/anna')[1]['keys']['ptt.doc.v1']['value'], 'anna')

    def test_a_conditional_write_refuses_a_stale_revision(self):
        put = lambda body, rev: self.json('PUT', '/api/cond/ptt.doc.v1', body, {'If-Match': str(rev)})
        self.assertEqual(put(b'first', 0), (200, {'rev': 1}))
        self.assertEqual(put(b'again', 0), (409, {'rev': 1}))
        self.assertEqual(put(b'second', 1), (200, {'rev': 2}))
        self.assertEqual(put(b'stale', 1), (409, {'rev': 2}))
        self.assertEqual(self.json('GET', '/api/cond')[1]['keys']['ptt.doc.v1']['value'], 'second')

    def test_bad_requests_are_refused(self):
        for path in ('/api/Ann/ptt.doc.v1', '/api/../ptt.doc.v1', '/api/api/ptt.doc.v1',
                     '/api/a.b/ptt.doc.v1', '/api/ann/revs.json', '/api/ann/..%2fx',
                     '/api/ann/doc', '/api/ann/ptt.Doc'):
            r, _ = self.req('PUT', path, b'x')
            self.assertIn(r.status, (400, 404), path)
        self.assertEqual(self.req('PUT', '/api/ann/ptt.bin.v1', b'\xff\xfe')[0].status, 400)
        # too big is refused on the strength of its length, before any of it is read
        c = http.client.HTTPConnection('127.0.0.1', self.port, timeout=5)
        c.putrequest('PUT', '/api/ann/ptt.big.v1')
        c.putheader('Content-Length', str(server.MAX_BODY + 1))
        c.endheaders()
        self.assertEqual(c.getresponse().status, 413)
        c.close()
        self.assertEqual(sorted(os.listdir(self.tmp.name)), sorted(
            d for d in os.listdir(self.tmp.name) if server.valid_name(d)))

    def test_a_name_cannot_grow_keys_without_end(self):
        for i in range(server.MAX_KEYS):
            self.assertEqual(self.req('PUT', '/api/many/ptt.k%d' % i, b'x')[0].status, 200)
        self.assertEqual(self.req('PUT', '/api/many/ptt.onemore', b'x')[0].status, 400)
        self.assertEqual(self.req('PUT', '/api/many/ptt.k0', b'y')[0].status, 200)


if __name__ == '__main__':
    unittest.main(verbosity=0)
