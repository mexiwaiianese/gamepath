"""Local player marker. Binds to this machine and writes jersey labels into the registry."""

import json
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from gamepath_video.marker import choose_asset
from gamepath_video.players import PlayerMarkError, build_player_marks, sample_slots
from gamepath_video.probe import ProbeError
from gamepath_video.registry import load_registry, set_asset_player_marks
from gamepath_video.stills import extract_still

PAGE_PATH = Path(__file__).with_name("player_marker.html")


def serve(registry_path: Path, *, port: int = 8766, open_browser: bool = True, asset_selector: str | None = None) -> None:
    registry = load_registry(registry_path)
    asset = choose_asset(registry, asset_selector, need_court_map=True)
    try:
        slots = sample_slots(asset)
        build_player_marks(asset, [])
    except PlayerMarkError as exc:
        raise PlayerMarkError(str(exc)) from exc
    video = Path(asset["path"])
    if not video.is_file():
        raise PlayerMarkError(f"Recording not found: {video}")
    still_dir = registry_path.parent / "stills" / asset["id"]

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            parsed = urlparse(self.path)
            if parsed.path == "/":
                self._send(200, PAGE_PATH.read_bytes(), "text/html; charset=utf-8")
                return
            if parsed.path == "/health":
                # Lightweight liveness probe for the admin portal; touches no recording data.
                self._send(200, json.dumps({"ok": True, "service": "gamepath-marker", "tagger": "players"}).encode("utf-8"), "application/json")
                return
            if parsed.path == "/api/state":
                body = {"file": video.name, "frames": sample_slots(asset)}
                self._send(200, json.dumps(body).encode("utf-8"), "application/json")
                return
            if parsed.path == "/still":
                self._still(parse_qs(parsed.query))
                return
            self._send(404, b"Not found", "text/plain")

        def do_POST(self):
            nonlocal asset
            parsed = urlparse(self.path)
            try:
                payload = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))) or b"{}")
                evaluated = build_player_marks(asset, payload.get("frames") or [])
            except (json.JSONDecodeError, PlayerMarkError) as exc:
                self._send(400, json.dumps({"message": str(exc)}).encode("utf-8"), "application/json")
                return
            if parsed.path == "/api/preview":
                self._send(200, json.dumps({"frames": evaluated["frames"]}).encode("utf-8"), "application/json")
                return
            if parsed.path == "/api/save":
                asset = set_asset_player_marks(registry_path, video, evaluated)
                self._send(200, json.dumps({"frames": evaluated["frames"]}).encode("utf-8"), "application/json")
                return
            self._send(404, b"Not found", "text/plain")

        def _still(self, query: dict):
            try:
                media_ms = int(query.get("media_ms", ["0"])[0])
            except ValueError:
                self._send(400, b"Bad time", "text/plain")
                return
            bounds = next((slot for slot in slots if slot["media_ms"] == media_ms), None)
            if bounds is None:
                rally_bounds = [slot for slot in slots if slot["clip_start_ms"] <= media_ms <= slot["clip_end_ms"]]
                if not rally_bounds:
                    self._send(400, b"Time is outside the sample rallies", "text/plain")
                    return
            dest = still_dir / f"{media_ms}.jpg"
            try:
                extract_still(video, media_ms, dest)
            except ProbeError as exc:
                self._send(500, str(exc).encode("utf-8"), "text/plain")
                return
            self._send(200, dest.read_bytes(), "image/jpeg")

        def _send(self, status: int, body: bytes, content_type: str):
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, format: str, *args):
            return

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    url = f"http://127.0.0.1:{port}/"
    print(f"Player marker: {url}")
    print(f"Recording: {video}")
    if open_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
