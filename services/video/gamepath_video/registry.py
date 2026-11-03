"""Local video asset registry. Paths stay on this machine."""

import hashlib
import json
import os
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from gamepath_video.anchors import apply_timing
from gamepath_video.contract import PROFILE_ID
from gamepath_video.profile import CameraAttestation, ProbeFacts, evaluate

REGISTRY_SCHEMA = "gamepath.video_assets.v1"
ASSET_SCHEMA = "gamepath.video_asset.v1"


def default_registry_path(cwd: Path | None = None) -> Path:
    return (cwd or Path.cwd()) / ".gamepath" / "video-assets.json"


def sha256_file(path: Path) -> tuple[str, int]:
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            size += len(chunk)
            digest.update(chunk)
    return digest.hexdigest(), size


def build_asset(
    path: Path,
    probe: ProbeFacts,
    attestation: CameraAttestation,
    *,
    sha256: str,
    byte_size: int,
    contains_minors: bool = True,
    asset_id: str | None = None,
    created_at: str | None = None,
) -> dict:
    decision = evaluate(probe, attestation)
    now = _now()
    return {
        "id": asset_id or str(uuid4()),
        "schema": ASSET_SCHEMA,
        "path": str(path.resolve()),
        "sha256": sha256,
        "byte_size": byte_size,
        "camera_profile": PROFILE_ID,
        "contains_minors": contains_minors,
        "created_at": created_at or now,
        "updated_at": now,
        "probe": asdict(probe),
        "attestation": asdict(attestation),
        "decision": decision.decision,
        "flags": list(decision.flags),
        "reasons": [asdict(reason) for reason in decision.reasons],
    }


def register_asset(
    path: Path,
    probe: ProbeFacts,
    attestation: CameraAttestation,
    *,
    registry_path: Path,
    contains_minors: bool = True,
) -> dict:
    sha256, byte_size = sha256_file(path)
    registry = load_registry(registry_path)
    existing = next((asset for asset in registry["assets"] if asset["sha256"] == sha256), None)
    asset = build_asset(
        path,
        probe,
        attestation,
        sha256=sha256,
        byte_size=byte_size,
        contains_minors=contains_minors,
        asset_id=existing["id"] if existing else None,
        created_at=existing["created_at"] if existing else None,
    )
    if existing and existing.get("timing"):
        asset = apply_timing(asset, existing["timing"])
    if existing and existing.get("rally_index"):
        asset["rally_index"] = existing["rally_index"]
    if existing and existing.get("frame_list"):
        asset["frame_list"] = existing["frame_list"]
    if existing and existing.get("court_maps"):
        asset["court_maps"] = existing["court_maps"]
    if existing and existing.get("player_marks"):
        asset["player_marks"] = existing["player_marks"]
    if existing and existing.get("touch_marks"):
        asset["touch_marks"] = existing["touch_marks"]
    if existing and existing.get("student_examples"):
        asset["student_examples"] = existing["student_examples"]
    if existing and existing.get("contact_model"):
        asset["contact_model"] = existing["contact_model"]
    if existing and existing.get("camera_angle"):
        asset["camera_angle"] = existing["camera_angle"]
    assets = [item for item in registry["assets"] if item["sha256"] != sha256]
    assets.append(asset)
    save_registry(registry_path, assets)
    return asset


def set_asset_timing(registry_path: Path, path: Path, timing: dict) -> dict:
    registry = load_registry(registry_path)
    resolved = str(path.resolve())
    existing = next((asset for asset in registry["assets"] if asset["path"] == resolved), None)
    if existing is None:
        raise ValueError(f"No registered asset for {resolved}. Register the file first.")
    asset = apply_timing(existing, timing)
    asset["updated_at"] = _now()
    assets = [asset if item["path"] == resolved else item for item in registry["assets"]]
    save_registry(registry_path, assets)
    return asset


def set_asset_rally_index(registry_path: Path, path: Path, rally_index: dict) -> dict:
    registry = load_registry(registry_path)
    resolved = str(path.resolve())
    existing = next((asset for asset in registry["assets"] if asset["path"] == resolved), None)
    if existing is None:
        raise ValueError(f"No registered asset for {resolved}. Register the file first.")
    asset = dict(existing)
    asset["rally_index"] = rally_index
    asset["updated_at"] = _now()
    assets = [asset if item["path"] == resolved else item for item in registry["assets"]]
    save_registry(registry_path, assets)
    return asset


def set_asset_frame_list(registry_path: Path, path: Path, frame_list: dict) -> dict:
    registry = load_registry(registry_path)
    resolved = str(path.resolve())
    existing = next((asset for asset in registry["assets"] if asset["path"] == resolved), None)
    if existing is None:
        raise ValueError(f"No registered asset for {resolved}. Register the file first.")
    asset = dict(existing)
    asset["frame_list"] = frame_list
    asset["updated_at"] = _now()
    assets = [asset if item["path"] == resolved else item for item in registry["assets"]]
    save_registry(registry_path, assets)
    return asset


def set_asset_court_maps(registry_path: Path, path: Path, court_maps: list) -> dict:
    registry = load_registry(registry_path)
    resolved = str(path.resolve())
    existing = next((asset for asset in registry["assets"] if asset["path"] == resolved), None)
    if existing is None:
        raise ValueError(f"No registered asset for {resolved}. Register the file first.")
    asset = dict(existing)
    asset["court_maps"] = court_maps
    asset["updated_at"] = _now()
    assets = [asset if item["path"] == resolved else item for item in registry["assets"]]
    save_registry(registry_path, assets)
    return asset


def set_asset_player_marks(registry_path: Path, path: Path, player_marks: dict) -> dict:
    registry = load_registry(registry_path)
    resolved = str(path.resolve())
    existing = next((asset for asset in registry["assets"] if asset["path"] == resolved), None)
    if existing is None:
        raise ValueError(f"No registered asset for {resolved}. Register the file first.")
    asset = dict(existing)
    asset["player_marks"] = player_marks
    asset["updated_at"] = _now()
    assets = [asset if item["path"] == resolved else item for item in registry["assets"]]
    save_registry(registry_path, assets)
    return asset


def set_asset_touch_marks(registry_path: Path, path: Path, touch_marks: dict) -> dict:
    registry = load_registry(registry_path)
    resolved = str(path.resolve())
    existing = next((asset for asset in registry["assets"] if asset["path"] == resolved), None)
    if existing is None:
        raise ValueError(f"No registered asset for {resolved}. Register the file first.")
    asset = dict(existing)
    asset["touch_marks"] = touch_marks
    asset["updated_at"] = _now()
    assets = [asset if item["path"] == resolved else item for item in registry["assets"]]
    save_registry(registry_path, assets)
    return asset


def set_asset_student_examples(registry_path: Path, path: Path, student_examples: dict) -> dict:
    registry = load_registry(registry_path)
    resolved = str(path.resolve())
    existing = next((asset for asset in registry["assets"] if asset["path"] == resolved), None)
    if existing is None:
        raise ValueError(f"No registered asset for {resolved}. Register the file first.")
    asset = dict(existing)
    asset["student_examples"] = student_examples
    asset["updated_at"] = _now()
    assets = [asset if item["path"] == resolved else item for item in registry["assets"]]
    save_registry(registry_path, assets)
    return asset


def set_asset_contact_model(registry_path: Path, path: Path, contact_model: dict) -> dict:
    registry = load_registry(registry_path)
    resolved = str(path.resolve())
    existing = next((asset for asset in registry["assets"] if asset["path"] == resolved), None)
    if existing is None:
        raise ValueError(f"No registered asset for {resolved}. Register the file first.")
    asset = dict(existing)
    asset["contact_model"] = contact_model
    asset["updated_at"] = _now()
    assets = [asset if item["path"] == resolved else item for item in registry["assets"]]
    save_registry(registry_path, assets)
    return asset


def set_camera_angles(registry_path: Path, records: dict[str, dict]) -> list[dict]:
    registry = load_registry(registry_path)
    by_path = {asset["path"]: asset for asset in registry["assets"]}
    updated = []
    for path, angle in records.items():
        existing = by_path.get(path)
        if existing is None:
            raise ValueError(f"No registered asset for {path}. Register the file first.")
        asset = dict(existing)
        asset["camera_angle"] = angle
        asset["updated_at"] = _now()
        updated.append(asset)
    replaced = {asset["path"]: asset for asset in updated}
    assets = [replaced.get(item["path"], item) for item in registry["assets"]]
    save_registry(registry_path, assets)
    return updated


def load_registry(path: Path) -> dict:
    if not path.exists():
        return {"schema": REGISTRY_SCHEMA, "assets": []}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"Registry is not valid JSON: {path}") from exc
    if payload.get("schema") != REGISTRY_SCHEMA or not isinstance(payload.get("assets"), list):
        raise ValueError(f"Registry schema is not {REGISTRY_SCHEMA}: {path}")
    return payload


def save_registry(path: Path, assets: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    body = json.dumps({"schema": REGISTRY_SCHEMA, "assets": assets}, indent=2) + "\n"
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(body, encoding="utf-8")
    os.replace(temporary, path)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()
