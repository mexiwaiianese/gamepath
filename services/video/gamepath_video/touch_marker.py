"""Touch marker for this computer and other computers on the same Wi-Fi."""

import json
import socket
import threading
import webbrowser
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from .admin_auth import AdminMarkerHandler

from gamepath_video.marker import choose_asset
from gamepath_video.players import PlayerMarkError
from gamepath_video.probe import ProbeError
from gamepath_video.registry import load_registry, set_asset_touch_marks
from gamepath_video.stills import extract_still
from gamepath_video.touches import (
    REOPENED_SIDE_MISSES,
    TouchMarkError,
    build_touch_marks,
    drop_replaced,
    reopen_cues,
    revision_matches,
    side_misses,
    touch_slots,
)

PAGE_PATH = Path(__file__).with_name("touch_marker.html")


def shareable_lan_addresses(addresses: list[str], primary: str | None = None) -> list[str]:
    usable: list[str] = []
    for address in addresses:
        if not _is_private_lan(address) or address in usable:
            continue
        usable.append(address)
    if primary in usable:
        usable.remove(primary)
        usable.insert(0, primary)
    return usable


def advertised_lan_addresses(addresses: list[str], primary: str | None = None) -> list[str]:
    ordered = shareable_lan_addresses(addresses, primary)
    chosen: list[str] = []
    if primary and primary in ordered:
        chosen.append(primary)
    if "192.168.137.1" in ordered and "192.168.137.1" not in chosen:
        chosen.append("192.168.137.1")
    return chosen or ordered


def lan_addresses() -> list[str]:
    found: list[str] = []
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            address = info[4][0]
            if address not in found:
                found.append(address)
    except OSError:
        pass
    primary = None
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        probe.connect(("8.8.8.8", 80))
        primary = probe.getsockname()[0]
    except OSError:
        primary = None
    finally:
        probe.close()
    if primary and primary not in found:
        found.append(primary)
    return advertised_lan_addresses(found, primary)


def _is_private_lan(address: str) -> bool:
    parts = address.split(".")
    if len(parts) != 4 or not all(part.isdigit() for part in parts):
        return False
    numbers = [int(part) for part in parts]
    if any(number > 255 for number in numbers):
        return False
    if numbers[0] == 10 or (numbers[0] == 192 and numbers[1] == 168):
        return True
    # Docker, WSL, and the Hyper-V switch use 172.17–172.20. A normal office LAN does not.
    if numbers[0] == 172 and 21 <= numbers[1] <= 31:
        return True
    return numbers[0] == 172 and numbers[1] == 16


def serve(registry_path: Path, *, port: int = 8767, open_browser: bool = True, review: str | None = None, asset_selector: str | None = None) -> None:
    registry = load_registry(registry_path)
    asset = choose_asset(registry, asset_selector, need_court_map=True)
    try:
        slots = touch_slots(asset)
    except (TouchMarkError, PlayerMarkError) as exc:
        raise TouchMarkError(str(exc)) from exc
    video = Path(asset["path"])
    if not video.is_file():
        raise TouchMarkError(f"Recording not found: {video}")
    still_dir = registry_path.parent / "stills" / asset["id"]
    record_lock = threading.RLock()
    pending = [dict(item) for item in REOPENED_SIDE_MISSES] if review == "reopen" else []

    def refresh() -> None:
        nonlocal asset, slots
        fresh = load_registry(registry_path)
        found = next((item for item in fresh["assets"] if item.get("path") == asset["path"]), None)
        if found is not None:
            asset = found
        slots = touch_slots(asset)

    def review_items(current: list[dict]) -> list[dict] | None:
        if review == "misses":
            return side_misses(current)
        if review == "reopen":
            return reopen_cues(current, pending)
        return None

    def state_body() -> dict:
        with record_lock:
            refresh()
            current = touch_slots(asset)
            hosts = lan_addresses()
            query = f"?review={review}" if review in ("misses", "reopen") else ""
            return {
                "file": video.name,
                "rallies": current,
                "updated_at": asset.get("updated_at"),
                "review": review_items(current),
                "share_url": f"http://{hosts[0]}:{port}/{query}" if hosts else "",
            }

    class Handler(AdminMarkerHandler):
        def do_GET(self):
            parsed = urlparse(self.path)
            if parsed.path == "/":
                self._send(200, PAGE_PATH.read_bytes(), "text/html; charset=utf-8")
                return
            if parsed.path == "/health":
                # Lightweight liveness probe for the admin portal; touches no recording data.
                self._send(200, json.dumps({"ok": True, "service": "gamepath-marker", "tagger": "touches"}).encode("utf-8"), "application/json")
                return
            if parsed.path == "/api/state":
                self._send(200, json.dumps(state_body()).encode("utf-8"), "application/json")
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
                evaluated = build_touch_marks(asset, payload.get("rallies") or [])
            except (json.JSONDecodeError, TouchMarkError, PlayerMarkError) as exc:
                self._send(400, json.dumps({"message": str(exc)}).encode("utf-8"), "application/json")
                return
            if parsed.path == "/api/preview":
                self._send(200, json.dumps({"rallies": evaluated["rallies"]}).encode("utf-8"), "application/json")
                return
            if parsed.path == "/api/save":
                with record_lock:
                    refresh()
                    if not revision_matches(payload.get("updated_at"), asset.get("updated_at")):
                        current = state_body()
                        current["message"] = "This computer has a newer save."
                        self._send(409, json.dumps(current).encode("utf-8"), "application/json")
                        return
                    stored = {
                        "schema": evaluated["schema"],
                        "source": evaluated["source"],
                        "rallies": [
                            {
                                "rally": item["rally"],
                                "touches": item["touches"],
                                "touch_count": item["touch_count"],
                                "unknown_count": item["unknown_count"],
                            }
                            for item in evaluated["rallies"]
                        ],
                    }
                    if review == "reopen":
                        pending[:] = drop_replaced(pending, slots, evaluated["rallies"])
                    asset = set_asset_touch_marks(registry_path, video, stored)
                    saved = state_body()
                self._send(200, json.dumps(saved).encode("utf-8"), "application/json")
                return
            self._send(404, b"Not found", "text/plain")

        def _still(self, query: dict):
            try:
                media_ms = int(query.get("media_ms", ["0"])[0])
            except ValueError:
                self._send(400, b"Bad time", "text/plain")
                return
            if not any(slot["clip_start_ms"] <= media_ms <= slot["clip_end_ms"] for slot in slots):
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

    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    local_url = f"http://127.0.0.1:{port}/"
    query = f"?review={review}" if review in ("misses", "reopen") else ""
    local_url += query
    print(f"Touch marker on this computer: {local_url}")
    for address in lan_addresses():
        print(f"Other computers on this Wi-Fi: http://{address}:{port}/{query}")
    print(f"Recording: {video}")
    if open_browser:
        webbrowser.open(local_url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
