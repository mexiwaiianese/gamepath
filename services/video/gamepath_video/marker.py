"""Local court marker. Binds to this machine and writes pixels into the registry."""

import json
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from gamepath_video.court import ORIENTATIONS, CourtMapError, build_view, catalog_for
from gamepath_video.probe import ProbeError
from gamepath_video.registry import load_registry, set_asset_court_maps
from gamepath_video.stills import extract_still

PAGE_PATH = Path(__file__).with_name("court_marker.html")


class MarkerError(ValueError):
    pass


def choose_asset(registry: dict, selector: str | None = None) -> dict:
    confirmed = [asset for asset in registry["assets"] if (asset.get("rally_index") or {}).get("review") == "confirmed"]
    if selector:
        wanted = selector.strip()
        resolved = str(Path(wanted).resolve()) if wanted else wanted
        match = next(
            (asset for asset in registry["assets"] if asset["id"] == wanted or asset["path"] in (wanted, resolved)),
            None,
        )
        if match is None:
            raise MarkerError(f"No registered asset matches {selector}.")
        if match not in confirmed:
            raise MarkerError(f"Confirm a rally sample for {Path(match['path']).name} before marking it.")
        return match
    if not confirmed:
        raise MarkerError("Confirm a rally sample before marking the court.")
    ready = [asset for asset in confirmed if asset.get("frame_list")]
    return (ready or confirmed)[-1]


def default_media_ms(asset: dict, role: str) -> int:
    rallies = asset["rally_index"]["rallies"]
    rally = rallies[0] if role == "setup" else rallies[min(8, len(rallies) - 1)]
    return min(rally["clip_start_ms"] + 2000, rally["clip_end_ms"])


def empty_views(asset: dict) -> dict:
    saved = {item["role"]: item for item in asset.get("court_maps") or []}
    views = {}
    for role in ("setup", "check"):
        existing = saved.get(role)
        if existing:
            views[role] = {
                "media_ms": existing["media_ms"],
                "orientation": existing.get("orientation") or "bottom",
                "points": existing.get("points") or {},
            }
        else:
            views[role] = {"media_ms": default_media_ms(asset, role), "orientation": "bottom", "points": {}}
    return views


def evaluate_views(asset: dict, views: dict) -> dict:
    width = int(asset["probe"]["width"])
    height = int(asset["probe"]["height"])
    evaluated = {}
    for role in ("setup", "check"):
        incoming = views.get(role) or {}
        try:
            evaluated[role] = build_view(
                incoming.get("points") or {},
                media_ms=int(incoming.get("media_ms") or default_media_ms(asset, role)),
                width=width,
                height=height,
                orientation=incoming.get("orientation") or "bottom",
            )
            evaluated[role]["role"] = role
        except (CourtMapError, TypeError, ValueError) as exc:
            evaluated[role] = {"role": role, "status": "invalid", "message": str(exc), "click_count": 0}
    return evaluated


def serve(registry_path: Path, *, port: int = 8765, open_browser: bool = True, asset_selector: str | None = None) -> None:
    registry = load_registry(registry_path)
    asset = choose_asset(registry, asset_selector)
    video = Path(asset["path"])
    if not video.is_file():
        raise MarkerError(f"Recording not found: {video}")
    still_dir = registry_path.parent / "stills" / asset["id"]
    bounds = {
        "min": int((asset.get("timing") or {}).get("first_serve_ms") or 0),
        "max": int((asset.get("timing") or {}).get("set_end_ms") or asset["probe"]["duration_ms"]),
    }

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            parsed = urlparse(self.path)
            if parsed.path == "/":
                self._send(200, PAGE_PATH.read_bytes(), "text/html; charset=utf-8")
                return
            if parsed.path == "/api/state":
                body = {
                    "file": video.name,
                    "orientations": [{"id": key, "label": label} for key, label in ORIENTATIONS],
                    "catalogs": {key: catalog_for(key) for key, _label in ORIENTATIONS},
                    "views": empty_views(asset),
                    "bounds": bounds,
                }
                self._send(200, json.dumps(body).encode("utf-8"), "application/json")
                return
            if parsed.path == "/still":
                self._still(parse_qs(parsed.query))
                return
            self._send(404, b"Not found", "text/plain")

        def do_POST(self):
            parsed = urlparse(self.path)
            try:
                payload = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))) or b"{}")
                evaluated = evaluate_views(asset, payload.get("views") or {})
            except (json.JSONDecodeError, CourtMapError) as exc:
                self._send(400, json.dumps({"message": str(exc)}).encode("utf-8"), "application/json")
                return
            if parsed.path == "/api/preview":
                self._send(200, json.dumps({"views": evaluated}).encode("utf-8"), "application/json")
                return
            if parsed.path == "/api/save":
                set_asset_court_maps(registry_path, video, list(evaluated.values()))
                self._send(200, json.dumps({"views": evaluated}).encode("utf-8"), "application/json")
                return
            self._send(404, b"Not found", "text/plain")

        def _still(self, query: dict):
            try:
                media_ms = int(query.get("media_ms", ["0"])[0])
            except ValueError:
                self._send(400, b"Bad time", "text/plain")
                return
            media_ms = min(bounds["max"], max(bounds["min"], media_ms))
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
    print(f"Court marker: {url}")
    print(f"Recording: {video}")
    if open_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
