"""Several fixed cameras of one set, lined up on one clock.

Each angle stays its own file and its own court map. A sync instant that
is visible in every file is time zero. Match time then moves at real
speed, including a file recorded faster than real time.
"""

from uuid import uuid4

ANGLE_SCHEMA = "gamepath.camera_angle.v1"


class AngleError(ValueError):
    pass


def assign_primary(asset: dict, *, sync_sec: float, label: str) -> dict:
    existing = asset.get("camera_angle") or {}
    if existing.get("role") == "angle":
        raise AngleError("This file is already an extra angle on another camera's set.")
    set_id = existing.get("set_id") or str(uuid4())
    return _record(set_id=set_id, role="primary", label=label or "primary camera", sync_sec=sync_sec, duration_ms=int(asset["probe"]["duration_ms"]))


def assign_added(primary: dict, added: dict, *, sync_sec: float, label: str) -> dict:
    primary_angle = primary.get("camera_angle") or {}
    if primary_angle.get("role") != "primary":
        raise AngleError("Set the sync time on the primary camera first.")
    if added.get("id") == primary.get("id"):
        raise AngleError("A camera cannot be added to itself.")
    existing = added.get("camera_angle") or {}
    if existing.get("role") == "primary":
        raise AngleError("That file is already a primary camera.")
    if existing.get("set_id") and existing["set_id"] != primary_angle["set_id"]:
        raise AngleError("That file already belongs to another set of angles.")
    return _record(
        set_id=primary_angle["set_id"],
        role="angle",
        label=label or "extra camera",
        sync_sec=sync_sec,
        duration_ms=int(added["probe"]["duration_ms"]),
    )


def match_ms(media_ms: int, *, sync_media_ms: int, capture_speed: float = 1.0) -> int:
    speed = _speed(capture_speed)
    return int(round((int(media_ms) - int(sync_media_ms)) * speed))


def media_ms_for_match(match_time_ms: int, *, sync_media_ms: int, capture_speed: float = 1.0) -> int:
    speed = _speed(capture_speed)
    return int(round(int(sync_media_ms) + int(match_time_ms) / speed))


def aligned_media_ms(source: dict, target: dict, source_media_ms: int) -> int:
    source_angle = _same_set(source, target)
    target_angle = target["camera_angle"]
    shared = match_ms(
        source_media_ms,
        sync_media_ms=int(source_angle["sync_media_ms"]),
        capture_speed=_asset_speed(source),
    )
    return media_ms_for_match(
        shared,
        sync_media_ms=int(target_angle["sync_media_ms"]),
        capture_speed=_asset_speed(target),
    )


def _record(*, set_id: str, role: str, label: str, sync_sec: float, duration_ms: int) -> dict:
    name = label.strip()
    if not name:
        raise AngleError("A camera angle needs a name.")
    sync_media_ms = int(round(float(sync_sec) * 1000))
    if sync_media_ms < 0:
        raise AngleError("The sync time is before the start of the file.")
    if sync_media_ms > duration_ms:
        raise AngleError("The sync time is past the end of the file.")
    return {
        "schema": ANGLE_SCHEMA,
        "set_id": set_id,
        "role": role,
        "label": name,
        "sync_media_ms": sync_media_ms,
    }


def _same_set(source: dict, target: dict) -> dict:
    source_angle = source.get("camera_angle") or {}
    target_angle = target.get("camera_angle") or {}
    if not source_angle.get("set_id") or source_angle.get("set_id") != target_angle.get("set_id"):
        raise AngleError("Those cameras are not in the same set.")
    return source_angle


def _asset_speed(asset: dict) -> float:
    timing = asset.get("timing") or {}
    return _speed(timing.get("capture_speed") or 1)


def _speed(capture_speed: float) -> float:
    speed = float(capture_speed)
    if speed <= 0:
        raise AngleError("Capture speed must be above zero.")
    return speed
