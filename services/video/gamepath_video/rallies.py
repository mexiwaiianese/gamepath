"""Sample rally windows on the media clock. Clips reference the source file."""

from gamepath_video.contract import POSTROLL_MS, PREROLL_MS


class RallyError(ValueError):
    pass


def parse_rally_span(text: str) -> tuple[float, float]:
    normalized = text.replace("–", "-").replace("—", "-")
    parts = [part.strip() for part in normalized.split("-") if part.strip()]
    if len(parts) != 2:
        raise RallyError(f"Rally span must look like 17-27, not {text!r}.")
    try:
        return float(parts[0]), float(parts[1])
    except ValueError as exc:
        raise RallyError(f"Rally span must look like 17-27, not {text!r}.") from exc


def build_rally_index(
    spans: list[tuple[float, float]],
    *,
    duration_ms: int,
    first_serve_ms: int | None = None,
    set_end_ms: int | None = None,
) -> dict:
    if not spans:
        raise RallyError("At least one rally is required.")

    rallies: list[dict] = []
    previous_dead_ms: int | None = None
    for number, (serve_sec, dead_sec) in enumerate(spans, start=1):
        serve_ms = int(round(serve_sec * 1000))
        dead_ms = int(round(dead_sec * 1000))
        if serve_ms < 0 or dead_ms <= serve_ms:
            raise RallyError(f"Rally {number} ends at or before it starts.")
        if first_serve_ms is not None and serve_ms < first_serve_ms:
            raise RallyError(f"Rally {number} starts before the first serve of the set.")
        if set_end_ms is not None and dead_ms > set_end_ms:
            raise RallyError(f"Rally {number} ends after the set.")
        if previous_dead_ms is not None and serve_ms < previous_dead_ms:
            raise RallyError(f"Rally {number} starts before rally {number - 1} ends.")

        clip_start_ms = max(0, serve_ms - PREROLL_MS)
        clip_end_ms = dead_ms + POSTROLL_MS
        if duration_ms and clip_end_ms > duration_ms:
            raise RallyError(f"Rally {number} clip runs past the end of the file.")
        rallies.append(
            {
                "number": number,
                "serve_ms": serve_ms,
                "dead_ms": dead_ms,
                "clip_start_ms": clip_start_ms,
                "clip_end_ms": clip_end_ms,
                "source": "operator",
            }
        )
        previous_dead_ms = dead_ms

    return {
        "coverage": "sample",
        "clock": "media_ms",
        "review": "pending",
        "preroll_ms": PREROLL_MS,
        "postroll_ms": POSTROLL_MS,
        "rallies": rallies,
    }


def confirm_rally_index(rally_index: dict, *, confirmed_at: str) -> dict:
    if not rally_index.get("rallies"):
        raise RallyError("No rally sample to confirm.")
    confirmed = dict(rally_index)
    confirmed["review"] = "confirmed"
    confirmed["confirmed_at"] = confirmed_at
    return confirmed
