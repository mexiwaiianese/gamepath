"""Extract one still from a local recording. The still stays on this machine."""

import subprocess
from pathlib import Path

from gamepath_video.probe import ProbeError, ffmpeg_executable


def extract_still(video: Path, media_ms: int, dest: Path, *, ffmpeg: str | None = None) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.is_file() and dest.stat().st_size > 0:
        return dest
    binary = ffmpeg or ffmpeg_executable()
    completed = subprocess.run(
        [
            binary,
            "-y",
            "-ss",
            f"{media_ms / 1000:.3f}",
            "-i",
            str(video),
            "-frames:v",
            "1",
            "-q:v",
            "2",
            str(dest),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.returncode != 0 or not dest.is_file():
        detail = (completed.stderr or "").strip().splitlines()
        message = detail[-1] if detail else "ffmpeg could not read that frame."
        raise ProbeError(message)
    return dest
