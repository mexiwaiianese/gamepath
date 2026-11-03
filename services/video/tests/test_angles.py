import tempfile
import unittest
from pathlib import Path

from gamepath_video.angles import AngleError, aligned_media_ms, assign_added, assign_primary, match_ms
from gamepath_video.profile import CameraAttestation, ProbeFacts
from gamepath_video.registry import load_registry, register_asset, set_camera_angles


def _asset(path: str, asset_id: str, duration_ms: int = 60_000, capture_speed: float = 1) -> dict:
    asset = {
        "id": asset_id,
        "path": path,
        "probe": {"duration_ms": duration_ms},
    }
    if capture_speed != 1:
        asset["timing"] = {"capture_speed": capture_speed}
    return asset


class AngleTests(unittest.TestCase):
    def test_two_real_time_cameras_share_one_instant(self):
        primary = _asset("a.mp4", "a")
        added = _asset("b.mp4", "b")
        primary["camera_angle"] = assign_primary(primary, sync_sec=17, label="end line")
        added["camera_angle"] = assign_added(primary, added, sync_sec=45, label="sideline")
        self.assertEqual(aligned_media_ms(primary, added, 20_000), 48_000)
        self.assertEqual(aligned_media_ms(added, primary, 48_000), 20_000)
        self.assertEqual(match_ms(20_000, sync_media_ms=17_000), 3_000)

    def test_fast_recording_uses_real_time_on_the_shared_clock(self):
        primary = _asset("live.mp4", "live")
        taped = _asset("fast.mp4", "fast", capture_speed=3)
        primary["camera_angle"] = assign_primary(primary, sync_sec=17, label="end line")
        taped["camera_angle"] = assign_added(primary, taped, sync_sec=6, label="wide")
        self.assertEqual(aligned_media_ms(primary, taped, 26_000), 9_000)

    def test_sync_past_the_end_of_the_file_is_rejected(self):
        primary = _asset("a.mp4", "a", duration_ms=10_000)
        with self.assertRaises(AngleError):
            assign_primary(primary, sync_sec=11, label="end line")

    def test_a_file_cannot_join_two_sets(self):
        primary = _asset("a.mp4", "a")
        other = _asset("b.mp4", "b")
        third = _asset("c.mp4", "c")
        primary["camera_angle"] = assign_primary(primary, sync_sec=1, label="end line")
        other["camera_angle"] = assign_added(primary, other, sync_sec=2, label="sideline")
        third["camera_angle"] = assign_primary(third, sync_sec=1, label="other match")
        with self.assertRaises(AngleError):
            assign_added(third, other, sync_sec=3, label="moved")

    def test_register_keeps_the_camera_angle(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            video = root / "set.mp4"
            video.write_bytes(b"angles")
            registry = root / "video-assets.json"
            facts = ProbeFacts(1920, 1080, "h264", 60.0, 60.0, 10_000, 0, 1)
            attestation = CameraAttestation(True, True, True, True)
            register_asset(video, facts, attestation, registry_path=registry)
            stored = load_registry(registry)["assets"][0]
            angle = assign_primary(stored, sync_sec=1, label="end line")
            set_camera_angles(registry, {stored["path"]: angle})
            register_asset(video, facts, attestation, registry_path=registry)
            kept = load_registry(registry)["assets"][0]
            self.assertEqual(kept["camera_angle"]["label"], "end line")
            self.assertEqual(kept["camera_angle"]["role"], "primary")
