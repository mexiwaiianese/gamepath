import tempfile
import unittest
from pathlib import Path

from gamepath_video.anchors import AnchorError, apply_timing, build_timing
from gamepath_video.profile import CameraAttestation, ProbeFacts
from gamepath_video.registry import register_asset, set_asset_timing


class AnchorTests(unittest.TestCase):
    def test_three_times_speed_converts_file_time_to_game_time(self):
        timing = build_timing(
            first_serve_sec=6,
            set_end_sec=374,
            capture_speed=3,
            duration_ms=1_199_700,
            avg_fps=30,
            server_visible=False,
        )
        self.assertEqual(timing["first_serve_ms"], 6000)
        self.assertEqual(timing["set_end_ms"], 374000)
        self.assertEqual(timing["video_span_ms"], 368000)
        self.assertEqual(timing["real_span_ms"], 1_104_000)
        self.assertEqual(timing["real_fps"], 10)
        self.assertIn("off camera", timing["note"])

    def test_set_end_past_the_file_is_rejected(self):
        with self.assertRaises(AnchorError):
            build_timing(
                first_serve_sec=6,
                set_end_sec=374,
                capture_speed=3,
                duration_ms=100_000,
                avg_fps=30,
                server_visible=True,
            )

    def test_apply_timing_keeps_the_30fps_flag_and_adds_speed_flags(self):
        asset = {"decision": "accepted_flagged", "flags": ["fps_30_excluded_from_ball"], "reasons": []}
        timing = build_timing(
            first_serve_sec=6,
            set_end_sec=374,
            capture_speed=3,
            duration_ms=1_199_700,
            avg_fps=30,
            server_visible=False,
        )
        updated = apply_timing(asset, timing)
        self.assertEqual(updated["decision"], "accepted_flagged")
        self.assertEqual(
            updated["flags"],
            ["fps_30_excluded_from_ball", "capture_speed_not_1x", "server_off_camera"],
        )

    def test_reregister_keeps_stored_timing(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            video = root / "set.mp4"
            video.write_bytes(b"video-bytes")
            registry = root / "video-assets.json"
            attestation = CameraAttestation(True, True, True, True)
            probe = ProbeFacts(1920, 1080, "h264", 30, 30, 1_199_700, 0, 1)
            register_asset(video, probe, attestation, registry_path=registry)
            timing = build_timing(
                first_serve_sec=6,
                set_end_sec=374,
                capture_speed=3,
                duration_ms=1_199_700,
                avg_fps=30,
                server_visible=False,
            )
            set_asset_timing(registry, video, timing)
            again = register_asset(video, probe, attestation, registry_path=registry)
            self.assertEqual(again["timing"]["set_end_ms"], 374000)
            self.assertIn("capture_speed_not_1x", again["flags"])


if __name__ == "__main__":
    unittest.main()
