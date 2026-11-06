import base64
import http.client
import os
import threading
import unittest
from http.server import ThreadingHTTPServer
from unittest.mock import patch

from gamepath_video.admin_auth import AdminMarkerHandler, _failures


class SampleHandler(AdminMarkerHandler):
    def do_GET(self):
        body = b"sample"
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    do_POST = do_GET

    def log_message(self, *args):
        pass


class MarkerAuthTests(unittest.TestCase):
    def setUp(self):
        _failures.clear()
        self.env = patch.dict(os.environ, {"GAMEPATH_ADMIN_PASSWORD": "test-only-marker-secret"})
        self.env.start()
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), SampleHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.env.stop()
        _failures.clear()

    def request(self, path="/", *, method="GET", credentials=None, origin=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.server.server_port)
        headers = {}
        if credentials is not None:
            headers["Authorization"] = "Basic " + base64.b64encode(credentials.encode()).decode()
        if origin:
            headers["Origin"] = origin
        conn.request(method, path, headers=headers)
        response = conn.getresponse()
        result = (response.status, dict(response.getheaders()), response.read())
        conn.close()
        return result

    def test_all_marker_surfaces_require_password_but_health_stays_open(self):
        for path in ("/", "/api/state", "/still?media_ms=1"):
            status, headers, _ = self.request(path)
            self.assertEqual(status, 401)
            self.assertIn("Basic", headers["WWW-Authenticate"])
            self.assertEqual(headers["Cache-Control"], "no-store")
        for path in ("/api/preview", "/api/save"):
            self.assertEqual(self.request(path, method="POST")[0], 401)
        self.assertEqual(self.request("/health")[0], 200)
        self.assertEqual(self.request(credentials="admin:test-only-marker-secret")[0], 200)
        self.assertEqual(self.request(credentials="admin:wrong")[0], 401)

    def test_unconfigured_is_fail_closed_and_browser_writes_are_same_origin(self):
        del os.environ["GAMEPATH_ADMIN_PASSWORD"]
        self.assertEqual(self.request()[0], 503)
        self.assertEqual(self.request("/health")[0], 200)
        os.environ["GAMEPATH_ADMIN_PASSWORD"] = "test-only-marker-secret"
        credentials = "admin:test-only-marker-secret"
        for origin in ("http://evil.test", "http://[", "null"):
            self.assertEqual(self.request(method="POST", credentials=credentials, origin=origin)[0], 403)
        self.assertEqual(self.request(method="POST", credentials=credentials, origin=f"http://127.0.0.1:{self.server.server_port}")[0], 200)

    def test_repeated_guesses_are_limited_without_breaking_health_probe(self):
        for _ in range(10):
            self.assertEqual(self.request(credentials="admin:wrong")[0], 401)
        self.assertEqual(self.request(credentials="admin:wrong")[0], 429)
        self.assertEqual(self.request("/health")[0], 200)
