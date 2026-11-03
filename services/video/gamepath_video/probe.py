"""Read container facts with ffprobe. No frames are decoded."""

import json
import os
import shutil
import subprocess
from pathlib import Path

from gamepath_video.profile import ProbeFacts


class ProbeError(Exception):
    pass


def ffprobe_executable() -> str:
    found = shutil.which("ffprobe")
    if found:
        return found
    for candidate in _ffprobe_candidates():
        if candidate.is_file():
            return str(candidate)
    raise ProbeError(
        "ffprobe was not found. Install FFmpeg and open a new terminal. "
        "On Windows: winget install Gyan.FFmpeg"
    )


def ffmpeg_executable() -> str:
    found = shutil.which("ffmpeg")
    if found:
        return found
    for candidate in _ffprobe_candidates():
        swapped = Path(str(candidate).replace("ffprobe", "ffmpeg"))
        if swapped.is_file():
            return str(swapped)
    raise ProbeError(
        "ffmpeg was not found. Install FFmpeg and open a new terminal. "
        "On Windows: winget install Gyan.FFmpeg"
    )


def _ffprobe_candidates() -> list[Path]:
    """Locations that exist after a WinGet install, even in a shell opened before PATH changed."""
    candidates: list[Path] = []
    local = os.environ.get("LOCALAPPDATA")
    if local:
        root = Path(local)
        candidates.append(root / "Microsoft" / "WinGet" / "Links" / "ffprobe.exe")
        packages = root / "Microsoft" / "WinGet" / "Packages"
        if packages.is_dir():
            candidates.extend(packages.glob("Gyan.FFmpeg*/ffmpeg-*/bin/ffprobe.exe"))
    for directory in _saved_path_directories():
        name = "ffprobe.exe" if os.name == "nt" else "ffprobe"
        candidates.append(directory / name)
    return candidates


def _saved_path_directories() -> list[Path]:
    if os.name != "nt":
        return []
    import winreg

    directories: list[Path] = []
    keys = (
        (winreg.HKEY_CURRENT_USER, r"Environment"),
        (winreg.HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment"),
    )
    for hive, subkey in keys:
        try:
            with winreg.OpenKey(hive, subkey) as key:
                value, _ = winreg.QueryValueEx(key, "Path")
        except OSError:
            continue
        for part in str(value).split(os.pathsep):
            expanded = os.path.expandvars(part.strip().strip('"'))
            if expanded:
                directories.append(Path(expanded))
    return directories


def probe_file(path: Path, *, ffprobe: str | None = None) -> ProbeFacts:
    binary = ffprobe or ffprobe_executable()
    completed = subprocess.run(
        [
            binary,
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            str(path),
        ],
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    if completed.returncode != 0:
        detail = completed.stderr.strip() or f"ffprobe exited {completed.returncode}"
        raise ProbeError(detail)
    try:
        payload = json.loads(completed.stdout or "{}")
    except json.JSONDecodeError as exc:
        raise ProbeError("ffprobe returned non-JSON output") from exc
    return parse_ffprobe(payload)


def parse_ffprobe(payload: dict) -> ProbeFacts:
    streams = payload.get("streams") or []
    video_streams = [stream for stream in streams if stream.get("codec_type") == "video"]
    if not video_streams:
        raise ProbeError("ffprobe found no video stream")

    stream = video_streams[0]
    fmt = payload.get("format") or {}
    duration_raw = stream.get("duration", fmt.get("duration"))
    try:
        duration_ms = int(round(float(duration_raw) * 1000)) if duration_raw not in (None, "") else 0
    except (TypeError, ValueError):
        duration_ms = 0

    return ProbeFacts(
        width=int(stream.get("width") or 0),
        height=int(stream.get("height") or 0),
        codec=str(stream.get("codec_name") or ""),
        avg_fps=_parse_rate(stream.get("avg_frame_rate")),
        r_fps=_parse_rate(stream.get("r_frame_rate")),
        duration_ms=duration_ms,
        rotation_degrees=_rotation_degrees(stream),
        video_stream_count=len(video_streams),
    )


def _parse_rate(value: object) -> float:
    if value in (None, "", "0/0", "N/A"):
        return 0.0
    text = str(value)
    if "/" in text:
        numerator, denominator = text.split("/", 1)
        try:
            denom = float(denominator)
            if denom == 0:
                return 0.0
            return float(numerator) / denom
        except ValueError:
            return 0.0
    try:
        return float(text)
    except ValueError:
        return 0.0


def _rotation_degrees(stream: dict) -> int:
    for side in stream.get("side_data_list") or []:
        if "rotation" in side:
            return int(round(float(side["rotation"]))) % 360
    tags = stream.get("tags") or {}
    if "rotate" in tags:
        try:
            return int(round(float(tags["rotate"]))) % 360
        except ValueError:
            return 0
    return 0
