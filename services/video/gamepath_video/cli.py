"""Register a local recording and print the gym-baseline-v1 decision."""

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from gamepath_video.anchors import AnchorError, build_timing
from gamepath_video.angles import AngleError, assign_added, assign_primary
from gamepath_video.frames import FRAME_LIST_SCHEMA, FrameListError, iter_frames
from gamepath_video.marker import MarkerError, serve
from gamepath_video.player_marker import serve as serve_players
from gamepath_video.players import PlayerMarkError
from gamepath_video.touches import TouchMarkError
from gamepath_video.touch_marker import serve as serve_touches
from gamepath_video.probe import ProbeError, probe_file
from gamepath_video.profile import CameraAttestation
from gamepath_video.rallies import RallyError, build_rally_index, confirm_rally_index, parse_rally_span
from gamepath_video.registry import (
    default_registry_path,
    load_registry,
    register_asset,
    set_camera_angles,
    set_asset_frame_list,
    set_asset_rally_index,
    set_asset_contact_model,
    set_asset_student_examples,
    set_asset_timing,
)
from gamepath_video.contact_model import CONTACT_MODEL_SCHEMA, fit_contact_model, score_held_out
from gamepath_video.train import STUDENT_SCHEMA, TrainError, build_student_examples, select_training_asset


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="gamepath-video",
        description="Probe a local recording, hash it, and accept or reject it against gym-baseline-v1.",
    )
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--registry", type=Path, default=None, help="Registry JSON path. Default: .gamepath/video-assets.json")
    sub = parser.add_subparsers(dest="command", required=True)

    register = sub.add_parser("register", parents=[common], help="Probe a file and write a video asset record")
    register.add_argument("path", type=Path)
    register.add_argument("--fixed-camera", action="store_true", help="Camera stayed fixed for the whole set")
    register.add_argument("--full-court", action="store_true", help="The full court is in frame")
    register.add_argument("--baselines", action="store_true", help="Both baselines are in frame")
    register.add_argument("--net", action="store_true", help="The net is in frame")
    register.add_argument("--no-minors", action="store_true", help="Recording does not contain minors")
    register.add_argument("--json", action="store_true", help="Print the asset record as JSON")

    listing = sub.add_parser("list", parents=[common], help="List registered assets")
    listing.add_argument("--json", action="store_true")

    anchors = sub.add_parser("anchors", parents=[common], help="Store first-serve and set-end times on a registered file")
    anchors.add_argument("path", type=Path)
    anchors.add_argument("--first-serve-sec", type=float, required=True)
    anchors.add_argument("--set-end-sec", type=float, required=True)
    anchors.add_argument("--capture-speed", type=float, default=1.0, help="1 is real time. 3 means the file plays at 3x.")
    anchors.add_argument("--server-off-camera", action="store_true")
    anchors.add_argument("--json", action="store_true")

    rallies = sub.add_parser("rallies", parents=[common], help="Store sample rally windows on a registered file")
    rallies.add_argument("path", type=Path)
    rallies.add_argument("--rally", action="append", help="Serve and dead-ball seconds, like 17-27")
    rallies.add_argument("--confirm", action="store_true", help="Mark the stored sample reviewed and good")
    rallies.add_argument("--json", action="store_true")

    frames = sub.add_parser("frames", parents=[common], help="Write the shared frame list for a confirmed rally sample")
    frames.add_argument("path", type=Path)

    mark = sub.add_parser("mark", parents=[common], help="Open the local court marker for a confirmed recording")
    mark.add_argument("--port", type=int, default=8765)
    mark.add_argument("--no-browser", action="store_true")
    mark.add_argument("--asset", default=None, help="Asset id or path to open. Default: most recently confirmed recording")

    players = sub.add_parser("players", parents=[common], help="Open the local player marker for a confirmed recording")
    players.add_argument("--port", type=int, default=8766)
    players.add_argument("--no-browser", action="store_true")
    players.add_argument("--asset", default=None, help="Asset id or path to open. Default: most recently confirmed recording")

    touches = sub.add_parser("touches", parents=[common], help="Open the touch marker for this computer and the same Wi-Fi")
    touches.add_argument("--port", type=int, default=8767)
    touches.add_argument("--no-browser", action="store_true")
    touches.add_argument("--asset", default=None, help="Asset id or path to open. Default: most recently confirmed recording")
    touches.add_argument("--review", choices=["misses", "reopen"], default=None, help="Open clicks with no side, or the ten side misses again")

    train = sub.add_parser("train", parents=[common], help="Build student contact examples from sr v herr2")
    train.add_argument("path", nargs="?", type=Path, default=None, help="Registered recording. Only sr v herr2.mp4 is accepted.")

    angles = sub.add_parser("angles", parents=[common], help="Group fixed cameras of one set on a shared clock")
    angles.add_argument("path", type=Path, help="Primary camera file")
    angles.add_argument("--sync-sec", type=float, required=True, help="Seconds in the file being set for an instant visible on every camera")
    angles.add_argument("--label", default="", help="Name for this angle, such as end line or sideline")
    angles.add_argument("--add", type=Path, default=None, help="Extra camera file to group with the primary")

    args = parser.parse_args(argv)
    registry_path = args.registry or default_registry_path()

    if args.command == "list":
        return _list(registry_path, as_json=args.json)
    if args.command == "anchors":
        return _anchors(args, registry_path)
    if args.command == "rallies":
        return _rallies(args, registry_path)
    if args.command == "frames":
        return _frames(args, registry_path)
    if args.command == "mark":
        return _mark(args, registry_path)
    if args.command == "players":
        return _players(args, registry_path)
    if args.command == "touches":
        return _touches(args, registry_path)
    if args.command == "train":
        return _train(args, registry_path)
    if args.command == "angles":
        return _angles(args, registry_path)
    return _register(args, registry_path)


def _angles(args: argparse.Namespace, registry_path: Path) -> int:
    try:
        registry = load_registry(registry_path)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    primary_path = str(args.path.resolve())
    primary = next((asset for asset in registry["assets"] if asset["path"] == primary_path), None)
    if primary is None:
        print(f"No registered asset for {primary_path}. Register the file first.", file=sys.stderr)
        return 1
    try:
        if args.add is None:
            record = assign_primary(primary, sync_sec=args.sync_sec, label=args.label)
            set_camera_angles(registry_path, {primary_path: record})
        else:
            added_path = str(args.add.resolve())
            added = next((asset for asset in registry["assets"] if asset["path"] == added_path), None)
            if added is None:
                print(f"No registered asset for {added_path}. Register the file first.", file=sys.stderr)
                return 1
            record = assign_added(primary, added, sync_sec=args.sync_sec, label=args.label)
            set_camera_angles(registry_path, {added_path: record})
    except (AngleError, ValueError) as exc:
        print(str(exc), file=sys.stderr)
        return 1
    fresh = load_registry(registry_path)
    set_id = record["set_id"]
    members = [asset for asset in fresh["assets"] if (asset.get("camera_angle") or {}).get("set_id") == set_id]
    _print_angles(members)
    return 0


def _print_angles(members: list[dict]) -> None:
    print(f"{len(members)} camera angles on one clock")
    for asset in members:
        angle = asset["camera_angle"]
        print(f"{angle['role']:8}  {angle['label']}  sync {angle['sync_media_ms'] / 1000:.3f} s  {asset['path']}")
    print("time zero is that sync instant on every camera")
    print("each angle keeps its own court map")


def _touches(args: argparse.Namespace, registry_path: Path) -> int:
    try:
        serve_touches(registry_path, port=args.port, open_browser=not args.no_browser, review=args.review, asset_selector=args.asset)
    except (TouchMarkError, MarkerError, OSError) as exc:
        print(str(exc), file=sys.stderr)
        return 1
    return 0


def _train(args: argparse.Namespace, registry_path: Path) -> int:
    try:
        registry = load_registry(registry_path)
        asset = select_training_asset(registry["assets"], args.path)
        built = build_student_examples(asset)
    except (TrainError, ValueError) as exc:
        print(str(exc), file=sys.stderr)
        return 1
    examples = built.pop("examples")
    list_path = registry_path.parent / "student-examples" / f"{asset['id']}.jsonl"
    list_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = list_path.with_suffix(".jsonl.tmp")
    header = {"type": "header", **built}
    with temporary.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(json.dumps(header) + "\n")
        for row in examples:
            handle.write(json.dumps(row) + "\n")
    temporary.replace(list_path)
    contacts = sum(1 for row in examples if row["contact"])
    summary = {
        "schema": STUDENT_SCHEMA,
        "path": str(list_path.resolve()),
        "example_count": len(examples),
        "contact_count": contacts,
        "student_fps": built["student_fps"],
        "lookahead_ms": built["lookahead_ms"],
        "ball_training": built["ball_training"],
        "ball_exclusion": built["ball_exclusion"],
        "label_source": built["label_source"],
    }
    try:
        set_asset_student_examples(registry_path, Path(asset["path"]), summary)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    print(f"{len(examples)} student frames, {contacts} inside {built['lookahead_ms']} ms of a human touch")
    print(f"ball training: {'yes' if built['ball_training'] else 'excluded'}")
    print(f"wrote {list_path}")
    serves = {int(rally["number"]): int(rally["serve_ms"]) for rally in (asset.get("rally_index") or {}).get("rallies") or []}
    try:
        model = fit_contact_model(examples, serves, lookahead_ms=built["lookahead_ms"])
        score = score_held_out(examples, model, serves)
    except TrainError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    report_path = registry_path.parent / "contact-model.json"
    report = {"model": model, "score": score, "label_source": "human"}
    temporary_report = report_path.with_suffix(".json.tmp")
    temporary_report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    temporary_report.replace(report_path)
    summary = {
        "schema": CONTACT_MODEL_SCHEMA,
        "path": str(report_path.resolve()),
        "trained_rallies": score["trained_rallies"],
        "held_out_rallies": score["held_out_rallies"],
        "contact_precision": score["contact_precision"],
        "contact_recall": score["contact_recall"],
        "side_accuracy": score["side_accuracy"],
        "jersey_accuracy": score["jersey_accuracy"],
        "court_error_m": score["court_error_m"],
    }
    try:
        set_asset_contact_model(registry_path, Path(asset["path"]), summary)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    held = ", ".join(str(number) for number in score["held_out_rallies"])
    print(f"held out rallies {held}")
    print(f"contact precision {score['contact_precision']}  recall {score['contact_recall']}")
    print(f"side {score['side_accuracy']}  jersey {score['jersey_accuracy']}  court error {score['court_error_m']} m")
    print(f"wrote {report_path}")
    return 0


def _players(args: argparse.Namespace, registry_path: Path) -> int:
    try:
        serve_players(registry_path, port=args.port, open_browser=not args.no_browser, asset_selector=args.asset)
    except (PlayerMarkError, MarkerError, OSError) as exc:
        print(str(exc), file=sys.stderr)
        return 1
    return 0


def _mark(args: argparse.Namespace, registry_path: Path) -> int:
    try:
        serve(registry_path, port=args.port, open_browser=not args.no_browser, asset_selector=args.asset)
    except (MarkerError, OSError) as exc:
        print(str(exc), file=sys.stderr)
        return 1
    return 0


def _frames(args: argparse.Namespace, registry_path: Path) -> int:
    resolved = args.path.resolve()
    try:
        registry = load_registry(registry_path)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    existing = next((asset for asset in registry["assets"] if asset["path"] == str(resolved)), None)
    if existing is None:
        print(f"No registered asset for {resolved}. Register the file first.", file=sys.stderr)
        return 1
    try:
        rows = list(iter_frames(existing))
    except FrameListError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    header, frames = rows[0], rows[1:]
    list_path = registry_path.parent / "frame-lists" / f"{existing['id']}.jsonl"
    list_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = list_path.with_suffix(".jsonl.tmp")
    with temporary.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(json.dumps(header) + "\n")
        for row in frames:
            handle.write(json.dumps(row) + "\n")
    temporary.replace(list_path)
    summary = {
        "schema": FRAME_LIST_SCHEMA,
        "path": str(list_path.resolve()),
        "row_count": len(frames),
        "fps_num": header["fps_num"],
        "fps_den": header["fps_den"],
        "model_width": header["model_width"],
        "model_height": header["model_height"],
        "content_width": header["content_width"],
        "content_height": header["content_height"],
        "pad_x": header["pad_x"],
        "pad_y": header["pad_y"],
    }
    set_asset_frame_list(registry_path, resolved, summary)
    print(f"{len(frames)} frames")
    print(f"scale: {header['content_width']}x{header['content_height']} inside {header['model_width']}x{header['model_height']}")
    print(f"list: {list_path}")
    return 0


def _register(args: argparse.Namespace, registry_path: Path) -> int:
    path = args.path
    if not path.is_file():
        print(f"File not found: {path}", file=sys.stderr)
        return 1

    try:
        probe = probe_file(path)
    except ProbeError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    attestation = CameraAttestation(
        camera_fixed=args.fixed_camera,
        full_court=args.full_court,
        baselines_visible=args.baselines,
        net_visible=args.net,
    )
    try:
        asset = register_asset(
            path,
            probe,
            attestation,
            registry_path=registry_path,
            contains_minors=not args.no_minors,
        )
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    if args.json:
        print(json.dumps(asset, indent=2))
    else:
        _print_asset(asset)
        print(f"registry: {registry_path}")
    return 0 if asset["decision"] != "rejected" else 2


def _anchors(args: argparse.Namespace, registry_path: Path) -> int:
    resolved = args.path.resolve()
    try:
        registry = load_registry(registry_path)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    existing = next((asset for asset in registry["assets"] if asset["path"] == str(resolved)), None)
    if existing is None:
        print(f"No registered asset for {resolved}. Register the file first.", file=sys.stderr)
        return 1
    probe = existing["probe"]
    try:
        timing = build_timing(
            first_serve_sec=args.first_serve_sec,
            set_end_sec=args.set_end_sec,
            capture_speed=args.capture_speed,
            duration_ms=int(probe["duration_ms"]),
            avg_fps=float(probe["avg_fps"]),
            server_visible=not args.server_off_camera,
        )
        asset = set_asset_timing(registry_path, resolved, timing)
    except (AnchorError, ValueError) as exc:
        print(str(exc), file=sys.stderr)
        return 1
    if args.json:
        print(json.dumps(asset, indent=2))
    else:
        _print_timing(asset)
    return 0


def _rallies(args: argparse.Namespace, registry_path: Path) -> int:
    resolved = args.path.resolve()
    try:
        registry = load_registry(registry_path)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    existing = next((asset for asset in registry["assets"] if asset["path"] == str(resolved)), None)
    if existing is None:
        print(f"No registered asset for {resolved}. Register the file first.", file=sys.stderr)
        return 1
    timing = existing.get("timing") or {}
    if not args.rally and not args.confirm:
        print("Pass --rally spans or --confirm.", file=sys.stderr)
        return 1
    try:
        if args.rally:
            spans = [parse_rally_span(text) for text in args.rally]
            rally_index = build_rally_index(
                spans,
                duration_ms=int(existing["probe"]["duration_ms"]),
                first_serve_ms=timing.get("first_serve_ms"),
                set_end_ms=timing.get("set_end_ms"),
            )
        else:
            rally_index = existing.get("rally_index")
            if not rally_index:
                raise RallyError("No rally sample to confirm.")
        if args.confirm:
            rally_index = confirm_rally_index(
                rally_index,
                confirmed_at=datetime.now(timezone.utc).isoformat(),
            )
        asset = set_asset_rally_index(registry_path, resolved, rally_index)
    except (RallyError, ValueError) as exc:
        print(str(exc), file=sys.stderr)
        return 1
    if args.json:
        print(json.dumps(asset["rally_index"], indent=2))
    else:
        _print_rallies(asset)
    return 0


def _print_rallies(asset: dict) -> None:
    index = asset["rally_index"]
    print(f"{asset['decision']}  {len(index['rallies'])} sample rallies  {index.get('review', 'pending')}")
    print(f"path: {asset['path']}")
    print(f"clip opens {index['preroll_ms'] / 1000:.1f} s before the serve and closes {index['postroll_ms'] / 1000:.1f} s after the dead ball")
    for rally in index["rallies"]:
        print(
            f"{rally['number']:2}  serve {rally['serve_ms'] / 1000:.3f}  dead {rally['dead_ms'] / 1000:.3f}  "
            f"clip {rally['clip_start_ms'] / 1000:.3f}-{rally['clip_end_ms'] / 1000:.3f}"
        )


def _print_timing(asset: dict) -> None:
    timing = asset["timing"]
    speed = timing["capture_speed"]
    print(f"{asset['decision']}  {asset['camera_profile']}")
    print(f"path: {asset['path']}")
    print(
        f"first serve: {timing['first_serve_ms'] / 1000:.3f} s in the file"
        f"  ({timing['first_serve_ms'] * speed / 1000:.3f} s of game time)"
    )
    print(
        f"set end: {timing['set_end_ms'] / 1000:.3f} s in the file"
        f"  ({timing['set_end_ms'] * speed / 1000:.3f} s of game time)"
    )
    print(
        f"set length: {timing['video_span_ms'] / 1000:.3f} s of video, "
        f"{timing['real_span_ms'] / 1000:.3f} s of game"
    )
    if timing["real_fps"] is not None:
        print(f"motion sampling: {timing['real_fps']:.3f} frames per real second")
    if asset["flags"]:
        print("flags: " + ", ".join(asset["flags"]))
    if timing.get("note"):
        print(timing["note"])


def _list(registry_path: Path, *, as_json: bool) -> int:
    try:
        registry = load_registry(registry_path)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    if as_json:
        print(json.dumps(registry["assets"], indent=2))
        return 0
    if not registry["assets"]:
        print("No video assets registered.")
        return 0
    for asset in registry["assets"]:
        probe = asset["probe"]
        print(
            f"{asset['decision']:17} {asset['sha256'][:12]}  "
            f"{probe['width']}x{probe['height']} {probe['codec']} {probe['avg_fps']:.3f} fps  {asset['path']}"
        )
    return 0


def _print_asset(asset: dict) -> None:
    probe = asset["probe"]
    print(f"{asset['decision']}  {asset['camera_profile']}")
    print(f"path: {asset['path']}")
    print(f"sha256: {asset['sha256']}")
    print(
        f"{probe['width']}x{probe['height']} {probe['codec']}  "
        f"{probe['avg_fps']:.3f} fps average  {probe['r_fps']:.3f} fps reported  "
        f"rotation {probe['rotation_degrees']} deg  {probe['duration_ms']} ms"
    )
    if asset["flags"]:
        print("flags: " + ", ".join(asset["flags"]))
    if asset["reasons"]:
        print("reasons:")
        for reason in asset["reasons"]:
            print(f"- {reason['code']}: {reason['message']}")
    else:
        print("reasons: none")
