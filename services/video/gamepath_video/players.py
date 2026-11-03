"""Human jersey labels on sample frames.

A player is a jersey number or unknown. No names and no faces.
Track numbers restart on every frame.
"""

from gamepath_video.court import CourtMapError, apply_homography

PLAYER_MARKS_SCHEMA = "gamepath.player_marks.v1"
SIDES = ("near", "far")
# One meter past the lines still counts as on the floor. Bench and stands do not.
COURT_MARGIN_M = 1.0


class PlayerMarkError(ValueError):
    pass


def setup_map(asset: dict) -> dict:
    maps = asset.get("court_maps") or []
    setup = next((item for item in maps if item.get("role") == "setup" and item.get("status") == "ready"), None)
    if setup is None or not setup.get("image_to_court"):
        raise PlayerMarkError("Save a court map before marking players.")
    return setup


def sample_slots(asset: dict) -> list[dict]:
    rallies = (asset.get("rally_index") or {}).get("rallies") or []
    if not rallies:
        raise PlayerMarkError("Confirm a rally sample before marking players.")
    saved = {int(item["rally"]): item for item in (asset.get("player_marks") or {}).get("frames") or [] if "rally" in item}
    slots = []
    for rally in rallies:
        start = int(rally["clip_start_ms"])
        end = int(rally["clip_end_ms"])
        default_ms = min(start + 2000, end)
        existing = saved.get(int(rally["number"]))
        media_ms = default_ms
        marks = []
        if existing:
            media_ms = int(existing.get("media_ms") or default_ms)
            media_ms = min(end, max(start, media_ms))
            marks = list(existing.get("marks") or [])
        slots.append(
            {
                "rally": int(rally["number"]),
                "media_ms": media_ms,
                "clip_start_ms": start,
                "clip_end_ms": end,
                "marks": marks,
            }
        )
    return slots


def locate_click(image_to_court: list[float], x: float, y: float) -> dict:
    try:
        court_x, court_y = apply_homography(image_to_court, x, y)
    except CourtMapError as exc:
        raise PlayerMarkError("That click does not land on the court map.") from exc
    on_court = -COURT_MARGIN_M <= court_x <= 9 + COURT_MARGIN_M and -COURT_MARGIN_M <= court_y <= 18 + COURT_MARGIN_M
    side = None
    if on_court:
        side = "near" if court_y < 9 else "far"
    return {
        "court_x": round(court_x, 2),
        "court_y": round(court_y, 2),
        "on_court": on_court,
        "side": side,
    }


def build_player_marks(asset: dict, incoming_frames: list[dict] | None) -> dict:
    court = setup_map(asset)
    width = int(asset["probe"]["width"])
    height = int(asset["probe"]["height"])
    by_rally = {int(item.get("rally") or 0): item for item in incoming_frames or []}
    frames = []
    for slot in sample_slots(asset):
        incoming = by_rally.get(slot["rally"]) or {}
        start, end = slot["clip_start_ms"], slot["clip_end_ms"]
        media_ms = int(incoming.get("media_ms") or slot["media_ms"])
        if not start <= media_ms <= end:
            raise PlayerMarkError(f"Rally {slot['rally']} is marked outside its clip.")
        frames.append(
            _build_frame(
                incoming.get("marks") or [],
                rally=slot["rally"],
                media_ms=media_ms,
                width=width,
                height=height,
                image_to_court=court["image_to_court"],
            )
        )
    return {"schema": PLAYER_MARKS_SCHEMA, "source": "human", "frames": frames}


def _build_frame(marks: list, *, rally: int, media_ms: int, width: int, height: int, image_to_court: list[float]) -> dict:
    cleaned = []
    seen: set[tuple[str, int]] = set()
    for mark in marks:
        if not isinstance(mark, dict) or "x" not in mark or "y" not in mark:
            raise PlayerMarkError(f"Rally {rally} has a player mark that is not a click.")
        x = float(mark["x"])
        y = float(mark["y"])
        if not (0 <= x <= width and 0 <= y <= height):
            raise PlayerMarkError(f"Rally {rally} has a click outside the picture.")
        jersey = _jersey(mark.get("jersey"), rally)
        located = locate_click(image_to_court, x, y)
        side = mark.get("side")
        if side in SIDES:
            located["side"] = side
        elif side not in (None, ""):
            raise PlayerMarkError(f"Rally {rally} has a side that is not near or far.")
        if jersey is not None and located["side"] is not None:
            key = (located["side"], jersey)
            if key in seen:
                which = "near" if located["side"] == "near" else "far"
                raise PlayerMarkError(f"Jersey {jersey} is already marked on the {which} side of rally {rally}.")
            seen.add(key)
        cleaned.append(
            {
                "track": len(cleaned) + 1,
                "x": round(x, 2),
                "y": round(y, 2),
                "jersey": jersey,
                "side": located["side"],
                "court_x": located["court_x"],
                "court_y": located["court_y"],
                "on_court": located["on_court"],
            }
        )
    unknown = sum(1 for item in cleaned if item["jersey"] is None)
    return {
        "rally": rally,
        "media_ms": int(media_ms),
        "marks": cleaned,
        "player_count": len(cleaned),
        "unknown_count": unknown,
    }


def _jersey(value, rally: int) -> int | None:
    if value is None or value == "":
        return None
    try:
        number = int(value)
    except (TypeError, ValueError) as exc:
        raise PlayerMarkError(f"Rally {rally} has a jersey that is not a number.") from exc
    if not 1 <= number <= 99:
        raise PlayerMarkError(f"Rally {rally} jersey {number} is outside 1-99. Leave it unknown if you cannot read it.")
    return number
