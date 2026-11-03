"""Human contact labels on sample rallies.

A touch is the moment the ball meets a player. The jersey is a number or
unknown. The result of the rally is not stored here.
"""

from gamepath_video.frames import fps_rational, pts_ms
from gamepath_video.players import SIDES, PlayerMarkError, locate_click, setup_map

TOUCH_MARKS_SCHEMA = "gamepath.touch_marks.v1"


class TouchMarkError(ValueError):
    pass


def touch_slots(asset: dict) -> list[dict]:
    try:
        setup_map(asset)
    except PlayerMarkError as exc:
        raise TouchMarkError(str(exc)) from exc
    rallies = (asset.get("rally_index") or {}).get("rallies") or []
    if not rallies:
        raise TouchMarkError("Confirm a rally sample before marking touches.")
    fps_num, fps_den = fps_rational(float(asset["probe"]["avg_fps"]))
    saved = {int(item["rally"]): item for item in (asset.get("touch_marks") or {}).get("rallies") or [] if "rally" in item}
    slots = []
    for rally in rallies:
        start = int(rally["clip_start_ms"])
        end = int(rally["clip_end_ms"])
        serve = min(end, max(start, int(rally.get("serve_ms") or start)))
        existing = saved.get(int(rally["number"]))
        slots.append(
            {
                "rally": int(rally["number"]),
                "media_ms": serve,
                "clip_start_ms": start,
                "clip_end_ms": end,
                "serve_ms": serve,
                "dead_ms": min(end, max(start, int(rally.get("dead_ms") or end))),
                "fps_num": fps_num,
                "fps_den": fps_den,
                "touches": list((existing or {}).get("touches") or []),
            }
        )
    return slots


def snap_media_ms(media_ms: int, fps_num: int, fps_den: int, start: int, end: int) -> int:
    if media_ms < start or media_ms > end:
        raise TouchMarkError("That touch is outside the rally clip.")
    index = max(0, (int(media_ms) * fps_num) // (1000 * fps_den))
    while pts_ms(index, fps_num, fps_den) < start:
        index += 1
    candidates = []
    for item in (index - 1, index, index + 1):
        if item < 0:
            continue
        stamp = pts_ms(item, fps_num, fps_den)
        if start <= stamp <= end:
            candidates.append(stamp)
    if not candidates:
        raise TouchMarkError("That touch is outside the rally clip.")
    return min(candidates, key=lambda stamp: (abs(stamp - int(media_ms)), stamp))


def revision_matches(client_updated_at: str | None, stored_updated_at: str | None) -> bool:
    if not client_updated_at:
        return True
    return client_updated_at == stored_updated_at


# The ten clicks that had no side on sr v herr2 before that pass was recorded.
REOPENED_SIDE_MISSES = (
    {"rally": 1, "index": 4, "media_ms": 22667},
    {"rally": 1, "index": 6, "media_ms": 26000},
    {"rally": 3, "index": 1, "media_ms": 292667},
    {"rally": 4, "index": 1, "media_ms": 404733},
    {"rally": 5, "index": 6, "media_ms": 462467},
    {"rally": 6, "index": 4, "media_ms": 571067},
    {"rally": 6, "index": 7, "media_ms": 575200},
    {"rally": 7, "index": 1, "media_ms": 624967},
    {"rally": 8, "index": 3, "media_ms": 769867},
    {"rally": 9, "index": 10, "media_ms": 854000},
)


def side_misses(slots: list[dict]) -> list[dict]:
    """Clicks that landed off the floor and therefore have no near/far side."""
    misses = []
    for slot in slots:
        for touch in slot.get("touches") or []:
            if touch.get("side") in ("near", "far"):
                continue
            misses.append({"rally": int(slot["rally"]), "index": int(touch["index"]), "media_ms": int(touch["media_ms"])})
    return misses


def _touch_at(slots: list[dict], rally: int, media_ms: int) -> dict | None:
    for slot in slots:
        if int(slot.get("rally") or 0) != rally:
            continue
        for touch in slot.get("touches") or []:
            if int(touch.get("media_ms") or 0) == media_ms:
                return touch
    return None


def reopen_cues(slots: list[dict], pending: list[dict]) -> list[dict]:
    """The earlier side misses that have not been clicked again."""
    cues = []
    for item in pending:
        touch = _touch_at(slots, int(item["rally"]), int(item["media_ms"]))
        if touch is None:
            continue
        cues.append({"rally": int(item["rally"]), "index": int(touch["index"]), "media_ms": int(touch["media_ms"])})
    return cues


def drop_replaced(pending: list[dict], before: list[dict], after: list[dict]) -> list[dict]:
    """Leave the queue once that click moves or is removed."""
    kept = []
    for item in pending:
        rally = int(item["rally"])
        media_ms = int(item["media_ms"])
        old = _touch_at(before, rally, media_ms)
        new = _touch_at(after, rally, media_ms)
        if old is not None and new is not None and (old.get("x"), old.get("y")) == (new.get("x"), new.get("y")):
            kept.append(item)
    return kept


def build_touch_marks(asset: dict, incoming_rallies: list[dict] | None) -> dict:
    court = setup_map(asset)
    width = int(asset["probe"]["width"])
    height = int(asset["probe"]["height"])
    fps_num, fps_den = fps_rational(float(asset["probe"]["avg_fps"]))
    by_rally = {int(item.get("rally") or 0): item for item in incoming_rallies or []}
    rallies = []
    for slot in touch_slots(asset):
        incoming = by_rally.get(slot["rally"]) or {}
        start, end = slot["clip_start_ms"], slot["clip_end_ms"]
        media_ms = int(incoming.get("media_ms") or slot["media_ms"])
        if not start <= media_ms <= end:
            raise TouchMarkError(f"Rally {slot['rally']} is showing a frame outside its clip.")
        touches = _touches(
            incoming.get("touches") or [],
            rally=slot["rally"],
            width=width,
            height=height,
            image_to_court=court["image_to_court"],
            fps_num=fps_num,
            fps_den=fps_den,
            start=start,
            end=end,
        )
        rallies.append(
            {
                **slot,
                "media_ms": snap_media_ms(media_ms, fps_num, fps_den, start, end),
                "touches": touches,
                "touch_count": len(touches),
                "unknown_count": sum(1 for touch in touches if touch["jersey"] is None),
            }
        )
    return {"schema": TOUCH_MARKS_SCHEMA, "source": "human", "rallies": rallies}


def _touches(marks: list, *, rally: int, width: int, height: int, image_to_court: list[float], fps_num: int, fps_den: int, start: int, end: int) -> list[dict]:
    cleaned = []
    for order, mark in enumerate(marks):
        if not isinstance(mark, dict) or "x" not in mark or "y" not in mark:
            raise TouchMarkError(f"Rally {rally} has a touch that is not a click.")
        x = float(mark["x"])
        y = float(mark["y"])
        if not (0 <= x <= width and 0 <= y <= height):
            raise TouchMarkError(f"Rally {rally} has a click outside the picture.")
        try:
            media_ms = snap_media_ms(int(mark.get("media_ms")), fps_num, fps_den, start, end)
        except (TypeError, ValueError) as exc:
            raise TouchMarkError(f"Rally {rally} has a touch without a time.") from exc
        jersey = _jersey(mark.get("jersey"), rally)
        try:
            located = locate_click(image_to_court, x, y)
        except PlayerMarkError as exc:
            raise TouchMarkError(str(exc)) from exc
        side = mark.get("side")
        if side in SIDES:
            located["side"] = side
        elif side not in (None, ""):
            raise TouchMarkError(f"Rally {rally} has a side that is not near or far.")
        cleaned.append(
            (
                order,
                {
                    "media_ms": media_ms,
                    "x": round(x, 2),
                    "y": round(y, 2),
                    "jersey": jersey,
                    "side": located["side"],
                    "court_x": located["court_x"],
                    "court_y": located["court_y"],
                    "on_court": located["on_court"],
                },
            )
        )
    cleaned.sort(key=lambda item: (item[1]["media_ms"], item[0]))
    touches = []
    for index, (_order, touch) in enumerate(cleaned, start=1):
        touch["index"] = index
        touches.append(touch)
    return touches


def _jersey(value, rally: int) -> int | None:
    if value is None or value == "":
        return None
    try:
        number = int(value)
    except (TypeError, ValueError) as exc:
        raise TouchMarkError(f"Rally {rally} has a jersey that is not a number.") from exc
    if not 1 <= number <= 99:
        raise TouchMarkError(f"Rally {rally} jersey {number} is outside 1-99. Leave it unknown if you cannot read it.")
    return number
