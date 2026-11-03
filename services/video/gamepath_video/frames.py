"""Shared frame list. Rows point at the source file. They do not copy pixels."""

from gamepath_video.contract import MODEL_INPUT_HEIGHT, MODEL_INPUT_WIDTH

FRAME_LIST_SCHEMA = "gamepath.frame_list.v1"


class FrameListError(ValueError):
    pass


def fps_rational(avg_fps: float) -> tuple[int, int]:
    known = ((30, 1), (30000, 1001), (60, 1), (60000, 1001))
    for numerator, denominator in known:
        if abs(avg_fps - (numerator / denominator)) < 0.02:
            return numerator, denominator
    raise FrameListError(f"Frame rate {avg_fps:.3f} fps has no exact shared clock.")


def pts_ms(index: int, fps_num: int, fps_den: int) -> int:
    return (index * 1000 * fps_den + fps_num // 2) // fps_num


def frame_indexes(start_ms: int, end_ms: int, fps_num: int, fps_den: int) -> range:
    """Source frames whose timestamp falls inside the clip, both ends included."""
    index = max(0, (start_ms * fps_num) // (1000 * fps_den))
    while pts_ms(index, fps_num, fps_den) < start_ms:
        index += 1
    while index > 0 and pts_ms(index - 1, fps_num, fps_den) >= start_ms:
        index -= 1
    last = index
    while pts_ms(last + 1, fps_num, fps_den) <= end_ms:
        last += 1
    if pts_ms(index, fps_num, fps_den) > end_ms:
        return range(0)
    return range(index, last + 1)


def letterbox(src_width: int, src_height: int, dst_width: int = MODEL_INPUT_WIDTH, dst_height: int = MODEL_INPUT_HEIGHT) -> dict:
    if src_width <= 0 or src_height <= 0:
        raise FrameListError("Source frame size is missing.")
    scale = min(dst_width / src_width, dst_height / src_height)
    content_width = int(round(src_width * scale))
    content_height = int(round(src_height * scale))
    content_width -= content_width % 2
    content_height -= content_height % 2
    return {
        "model_width": dst_width,
        "model_height": dst_height,
        "content_width": content_width,
        "content_height": content_height,
        "pad_x": (dst_width - content_width) // 2,
        "pad_y": (dst_height - content_height) // 2,
    }


def iter_frames(asset: dict):
    index = asset.get("rally_index") or {}
    if index.get("review") != "confirmed":
        raise FrameListError("Confirm the rally sample before building the frame list.")
    probe = asset["probe"]
    fps_num, fps_den = fps_rational(float(probe["avg_fps"]))
    preprocess = letterbox(int(probe["width"]), int(probe["height"]))
    header = {
        "type": "header",
        "schema": FRAME_LIST_SCHEMA,
        "asset_id": asset["id"],
        "sha256": asset["sha256"],
        "source_path": asset["path"],
        "fps_num": fps_num,
        "fps_den": fps_den,
        **preprocess,
    }
    yield header
    for rally in index["rallies"]:
        for frame_index in frame_indexes(rally["clip_start_ms"], rally["clip_end_ms"], fps_num, fps_den):
            yield {
                "type": "frame",
                "rally": rally["number"],
                "frame_index": frame_index,
                "media_ms": pts_ms(frame_index, fps_num, fps_den),
            }
