"""Password gate for standalone marker ports (separate from live stat keeping).

The Next portal passes its environment to child marker processes. Direct CLI users
must export GAMEPATH_ADMIN_PASSWORD before starting a marker.
"""

import base64
import binascii
import hashlib
import hmac
import os
import threading
import time
from collections import deque
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse

_failures: deque[float] = deque()
_lock = threading.Lock()


class AdminMarkerHandler(BaseHTTPRequestHandler):
    def parse_request(self) -> bool:
        if not super().parse_request():
            return False
        # The portal's process-health probe contains no recording data.
        if self.command == "GET" and urlparse(self.path).path == "/health":
            return True
        password = os.environ.get("GAMEPATH_ADMIN_PASSWORD", "")
        if not password:
            self._deny(503, "Set GAMEPATH_ADMIN_PASSWORD before starting the marker.")
            return False
        with _lock:
            now = time.monotonic()
            while _failures and _failures[0] <= now - 60:
                _failures.popleft()
            limited = len(_failures) >= 10
        if limited:
            self._deny(429, "Too many attempts. Wait one minute.")
            return False
        credentials = ""
        header = self.headers.get("Authorization", "")
        if header.startswith("Basic ") and len(header) <= 4096:
            try:
                credentials = base64.b64decode(header[6:], validate=True).decode("utf-8")
            except (binascii.Error, UnicodeDecodeError):
                pass
        expected = f"admin:{password}"
        if not hmac.compare_digest(hashlib.sha256(credentials.encode()).digest(), hashlib.sha256(expected.encode()).digest()):
            with _lock:
                _failures.append(time.monotonic())
            self._deny(401, "Admin password required. Use username admin.")
            return False
        # Basic credentials are ambient browser credentials: reject cross-origin writes.
        origin = self.headers.get("Origin")
        if self.command not in ("GET", "HEAD", "OPTIONS"):
            try:
                parsed = urlparse(origin) if origin else None
                foreign_origin = parsed is not None and (
                    parsed.scheme not in ("http", "https") or parsed.netloc != self.headers.get("Host")
                )
            except ValueError:
                foreign_origin = True
            if self.headers.get("Sec-Fetch-Site") == "cross-site" or foreign_origin:
                self._deny(403, "Marker writes must be same-origin.")
                return False
        return True

    def _deny(self, status: int, message: str) -> None:
        body = message.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        if status == 401:
            self.send_header("WWW-Authenticate", 'Basic realm="GamePath admin", charset="UTF-8"')
        if status == 429:
            self.send_header("Retry-After", "60")
        self.end_headers()
        self.wfile.write(body)
        self.close_connection = True
