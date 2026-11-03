"""Student contact examples from human touch marks.

The student runs at 30 fps and may look 167 ms ahead. A 30 fps recording
is excluded from ball training and can still teach contacts.
"""

from pathlib import Path

from gamepath_video.contract import FLAG_FPS_30, STUDENT_FPS, STUDENT_LOOKAHEAD_MS
from gamepath_video.frames import FrameListError, iter_frames, pts_ms

STUDENT_SCHEMA = "gamepath.student_examples.v1"
TRAINING_FILE = "sr v herr2.mp4"


class TrainError(ValueError):
    pass


def select_training_asset(assets: list[dict], path: Path | None = None) -> dict:
    if path is not None:
        resolved = str(path.resolve())
        if path.name != TRAINING_FILE:
            raise TrainError(f"Training uses {TRAINING_FILE} only.")
        asset = next((item for item in assets if item.get("path") == resolved), None)
        if asset is None:
            raise TrainError(f"No registered asset for {resolved}. Register the file first.")
        return asset
    matches = [item for item in assets if Path(str(item.get("path") or "")).name == TRAINING_FILE]
    if len(matches) != 1:
        raise TrainError(f"Training uses {TRAINING_FILE} only.")
    return matches[0]


def on_student_clock(media_ms: int, fps_num: int, fps_den: int) -> bool:
    nearest = pts_ms((media_ms * STUDENT_FPS + 500) // 1000, STUDENT_FPS, 1)
    half_frame = (500 * fps_den) // fps_num
    return abs(media_ms - nearest) <= half_frame


def build_student_examples(asset: dict) -> dict:
    marks = asset.get("touch_marks") or {}
    if marks.get("source") != "human":
        raise TrainError("Student examples come from human touch marks.")
    if asset.get("decision") not in {"accepted", "accepted_flagged"}:
        raise TrainError("Train from an accepted recording.")
    try:
        rows = list(iter_frames(asset))
    except FrameListError as exc:
        raise TrainError(str(exc)) from exc
    header, frames = rows[0], rows[1:]
    by_rally = {}
    for item in marks.get("rallies") or []:
        if "rally" not in item:
            continue
        by_rally[int(item["rally"])] = list(item.get("touches") or [])
    rallies = (asset.get("rally_index") or {}).get("rallies") or []
    missing = [int(rally["number"]) for rally in rallies if int(rally["number"]) not in by_rally]
    if missing:
        raise TrainError(f"Rally {missing[0]} has no human touch marks.")
    ball_training = FLAG_FPS_30 not in (asset.get("flags") or [])
    examples = []
    for frame in frames:
        if not on_student_clock(int(frame["media_ms"]), int(header["fps_num"]), int(header["fps_den"])):
            continue
        examples.append(
            {
                "type": "example",
                "rally": frame["rally"],
                "frame_index": frame["frame_index"],
                "media_ms": frame["media_ms"],
                "contact": _contact(int(frame["media_ms"]), by_rally.get(int(frame["rally"])) or []),
            }
        )
    return {
        "schema": STUDENT_SCHEMA,
        "task": "student_contact",
        "label_source": "human",
        "ball_training": ball_training,
        "ball_exclusion": None if ball_training else FLAG_FPS_30,
        "student_fps": STUDENT_FPS,
        "lookahead_ms": STUDENT_LOOKAHEAD_MS,
        "asset_id": asset["id"],
        "sha256": asset["sha256"],
        "source_path": asset["path"],
        "fps_num": header["fps_num"],
        "fps_den": header["fps_den"],
        "model_width": header["model_width"],
        "model_height": header["model_height"],
        "content_width": header["content_width"],
        "content_height": header["content_height"],
        "pad_x": header["pad_x"],
        "pad_y": header["pad_y"],
        "examples": examples,
    }


def _contact(media_ms: int, touches: list[dict]) -> dict | None:
    upcoming = []
    for touch in touches:
        offset = int(touch["media_ms"]) - media_ms
        if 0 <= offset <= STUDENT_LOOKAHEAD_MS:
            upcoming.append((offset, int(touch.get("index") or 0), touch))
    if not upcoming:
        return None
    offset, _index, touch = min(upcoming)
    return {
        "offset_ms": offset,
        "index": touch.get("index"),
        "jersey": touch.get("jersey"),
        "side": touch.get("side"),
        "court_x": touch.get("court_x"),
        "court_y": touch.get("court_y"),
    }
