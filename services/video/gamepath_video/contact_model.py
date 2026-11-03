"""Predict the next human contact, then score rallies the model was not shown.

Each touch index keeps the usual delay after the serve, the usual jersey,
side, and court spot from the rallies used for fitting. Held-out rallies
are scored against their human marks. Those marks are not replaced.
"""

from collections import Counter
from math import hypot

from gamepath_video.contract import STUDENT_LOOKAHEAD_MS
from gamepath_video.train import TrainError

CONTACT_MODEL_SCHEMA = "gamepath.contact_model.v1"


def split_rallies(numbers: list[int]) -> tuple[list[int], list[int]]:
    ordered = sorted(set(int(number) for number in numbers))
    if len(ordered) < 2:
        raise TrainError("Need touches from at least two rallies to hold one out.")
    hold_count = max(1, (len(ordered) + 4) // 5)
    if hold_count >= len(ordered):
        hold_count = 1
    return ordered[:-hold_count], ordered[-hold_count:]


def fit_contact_model(examples: list[dict], serve_ms_by_rally: dict[int, int], lookahead_ms: int = STUDENT_LOOKAHEAD_MS) -> dict:
    touches = _unique_touches(examples, serve_ms_by_rally)
    trained, held_out = split_rallies([touch["rally"] for touch in touches])
    trained_set = set(trained)
    grouped: dict[int, list[dict]] = {}
    for touch in touches:
        if touch["rally"] not in trained_set:
            continue
        grouped.setdefault(touch["index"], []).append(touch)
    if not grouped:
        raise TrainError("The training rallies have no human touches.")
    prototypes = []
    for index in sorted(grouped):
        rows = grouped[index]
        prototypes.append(
            {
                "index": index,
                "delay_ms": _median_int([row["delay_ms"] for row in rows]),
                "jersey": _mode([row["jersey"] for row in rows]),
                "side": _mode([row["side"] for row in rows]),
                "court_x": _median_float([row["court_x"] for row in rows if row["court_x"] is not None]),
                "court_y": _median_float([row["court_y"] for row in rows if row["court_y"] is not None]),
                "samples": len(rows),
            }
        )
    return {
        "schema": CONTACT_MODEL_SCHEMA,
        "lookahead_ms": lookahead_ms,
        "trained_rallies": trained,
        "held_out_rallies": held_out,
        "touches": prototypes,
    }


def predict_contact(model: dict, media_ms: int, serve_ms: int) -> dict | None:
    elapsed = media_ms - serve_ms
    upcoming = []
    for touch in model["touches"]:
        offset = int(touch["delay_ms"]) - elapsed
        if 0 <= offset <= int(model["lookahead_ms"]):
            upcoming.append((offset, int(touch["index"]), touch))
    if not upcoming:
        return None
    offset, _index, touch = min(upcoming)
    return {
        "offset_ms": offset,
        "index": touch["index"],
        "jersey": touch["jersey"],
        "side": touch["side"],
        "court_x": touch["court_x"],
        "court_y": touch["court_y"],
    }


def score_held_out(examples: list[dict], model: dict, serve_ms_by_rally: dict[int, int]) -> dict:
    held = set(model["held_out_rallies"])
    true_positive = false_positive = false_negative = 0
    side_hit = side_total = jersey_hit = jersey_total = 0
    court_error = []
    frames = 0
    for row in examples:
        rally = int(row["rally"])
        if rally not in held:
            continue
        frames += 1
        if rally not in serve_ms_by_rally:
            raise TrainError(f"Rally {rally} has no serve time.")
        predicted = predict_contact(model, int(row["media_ms"]), int(serve_ms_by_rally[rally]))
        actual = row.get("contact")
        if actual and predicted:
            true_positive += 1
            side_total += 1
            jersey_total += 1
            if actual.get("side") == predicted.get("side"):
                side_hit += 1
            if actual.get("jersey") == predicted.get("jersey"):
                jersey_hit += 1
            if None not in (actual.get("court_x"), actual.get("court_y"), predicted.get("court_x"), predicted.get("court_y")):
                court_error.append(hypot(float(actual["court_x"]) - float(predicted["court_x"]), float(actual["court_y"]) - float(predicted["court_y"])))
        elif predicted:
            false_positive += 1
        elif actual:
            false_negative += 1
    return {
        "schema": CONTACT_MODEL_SCHEMA,
        "trained_rallies": list(model["trained_rallies"]),
        "held_out_rallies": list(model["held_out_rallies"]),
        "frames": frames,
        "true_positive": true_positive,
        "false_positive": false_positive,
        "false_negative": false_negative,
        "contact_precision": _rate(true_positive, true_positive + false_positive),
        "contact_recall": _rate(true_positive, true_positive + false_negative),
        "side_accuracy": _rate(side_hit, side_total),
        "jersey_accuracy": _rate(jersey_hit, jersey_total),
        "court_error_m": round(sum(court_error) / len(court_error), 2) if court_error else None,
    }


def _unique_touches(examples: list[dict], serve_ms_by_rally: dict[int, int]) -> list[dict]:
    found: dict[tuple[int, int, int], dict] = {}
    for row in examples:
        contact = row.get("contact")
        if not contact or contact.get("index") is None:
            continue
        rally = int(row["rally"])
        if rally not in serve_ms_by_rally:
            raise TrainError(f"Rally {rally} has no serve time.")
        at = int(row["media_ms"]) + int(contact["offset_ms"])
        index = int(contact["index"])
        key = (rally, index, at)
        if key in found:
            continue
        found[key] = {
            "rally": rally,
            "index": index,
            "delay_ms": at - int(serve_ms_by_rally[rally]),
            "jersey": contact.get("jersey"),
            "side": contact.get("side"),
            "court_x": contact.get("court_x"),
            "court_y": contact.get("court_y"),
        }
    if not found:
        raise TrainError("Student examples have no human touches.")
    return list(found.values())


def _median_int(values: list[int]) -> int:
    ordered = sorted(int(value) for value in values)
    mid = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) // 2


def _median_float(values: list[float]) -> float | None:
    if not values:
        return None
    ordered = sorted(float(value) for value in values)
    mid = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) / 2


def _mode(values: list):
    counts = Counter(values)
    return sorted(counts, key=lambda value: (-counts[value], value is None, "" if value is None else str(value)))[0]


def _rate(hit: int, total: int) -> float | None:
    if total == 0:
        return None
    return round(hit / total, 4)
