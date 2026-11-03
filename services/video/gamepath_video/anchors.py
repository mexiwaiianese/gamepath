"""Operator anchors on the media clock. Probe data cannot see these."""

FLAG_CAPTURE_SPEED = "capture_speed_not_1x"
FLAG_SERVER_OFF_CAMERA = "server_off_camera"
TIMING_FLAGS = frozenset({FLAG_CAPTURE_SPEED, FLAG_SERVER_OFF_CAMERA})


class AnchorError(ValueError):
    pass


def build_timing(
    *,
    first_serve_sec: float,
    set_end_sec: float,
    capture_speed: float,
    duration_ms: int,
    avg_fps: float,
    server_visible: bool,
) -> dict:
    if capture_speed <= 0:
        raise AnchorError("Capture speed must be greater than zero.")
    first_ms = int(round(first_serve_sec * 1000))
    end_ms = int(round(set_end_sec * 1000))
    if first_ms < 0 or end_ms <= first_ms:
        raise AnchorError("Set end must be after the first serve.")
    if duration_ms and end_ms > duration_ms:
        raise AnchorError(f"Set end is {end_ms} ms and the file is {duration_ms} ms.")

    video_span_ms = end_ms - first_ms
    real_span_ms = int(round(video_span_ms * capture_speed))
    timing = {
        "clock": "media_ms",
        "first_serve_ms": first_ms,
        "set_end_ms": end_ms,
        "capture_speed": capture_speed,
        "server_visible": server_visible,
        "video_span_ms": video_span_ms,
        "real_span_ms": real_span_ms,
        "real_fps": (avg_fps / capture_speed) if avg_fps > 0 else None,
        "source": "operator",
    }
    if not server_visible:
        timing["note"] = (
            "Server is off camera. The first-serve mark is the operator's time, not a visible contact."
        )
    return timing


def timing_flags(timing: dict) -> list[str]:
    flags: list[str] = []
    if timing["capture_speed"] != 1:
        flags.append(FLAG_CAPTURE_SPEED)
    if not timing["server_visible"]:
        flags.append(FLAG_SERVER_OFF_CAMERA)
    return flags


def apply_timing(asset: dict, timing: dict) -> dict:
    updated = dict(asset)
    kept = [flag for flag in asset.get("flags", []) if flag not in TIMING_FLAGS]
    updated["timing"] = timing
    updated["flags"] = kept + timing_flags(timing)
    if updated.get("reasons"):
        updated["decision"] = "rejected"
    elif updated["flags"]:
        updated["decision"] = "accepted_flagged"
    else:
        updated["decision"] = "accepted"
    return updated
