import tempfile
import unittest
from pathlib import Path

from gamepath_video.court import apply_homography, build_view
from gamepath_video.players import PlayerMarkError, build_player_marks, locate_click
from gamepath_video.profile import CameraAttestation, ProbeFacts
from gamepath_video.registry import load_registry, register_asset, set_asset_player_marks


def _asset():
    view = build_view(
        {
            "near_left_baseline": {"x": 100, "y": 900},
            "near_right_baseline": {"x": 800, "y": 900},
            "far_left_baseline": {"x": 250, "y": 200},
            "far_right_baseline": {"x": 650, "y": 200},
        },
        media_ms=0,
        width=1920,
        height=1080,
    )
    view["role"] = "setup"
    return {
        "probe": {"width": 1920, "height": 1080},
        "court_maps": [view],
        "rally_index": {"rallies": [{"number": 1, "clip_start_ms": 16_000, "clip_end_ms": 28_500}]},
    }


class PlayerMarkTests(unittest.TestCase):
    def test_click_on_the_near_half_keeps_the_jersey_and_the_side(self):
        asset = _asset()
        court_to_image = asset["court_maps"][0]["court_to_image"]
        x, y = apply_homography(court_to_image, 4.5, 3.0)
        saved = build_player_marks(asset, [{"rally": 1, "media_ms": 18_000, "marks": [{"x": x, "y": y, "jersey": 7}]}])
        mark = saved["frames"][0]["marks"][0]
        self.assertEqual(mark["jersey"], 7)
        self.assertEqual(mark["side"], "near")
        self.assertEqual(mark["track"], 1)
        self.assertTrue(mark["on_court"])
        self.assertAlmostEqual(mark["court_x"], 4.5, delta=0.05)
        self.assertAlmostEqual(mark["court_y"], 3.0, delta=0.05)

    def test_far_side_is_the_half_away_from_the_camera(self):
        asset = _asset()
        x, y = apply_homography(asset["court_maps"][0]["court_to_image"], 4.5, 15.0)
        located = locate_click(asset["court_maps"][0]["image_to_court"], x, y)
        self.assertEqual(located["side"], "far")

    def test_same_jersey_can_stand_on_both_sides(self):
        asset = _asset()
        near = apply_homography(asset["court_maps"][0]["court_to_image"], 2.0, 2.0)
        far = apply_homography(asset["court_maps"][0]["court_to_image"], 2.0, 16.0)
        saved = build_player_marks(
            asset,
            [{"rally": 1, "marks": [{"x": near[0], "y": near[1], "jersey": 4}, {"x": far[0], "y": far[1], "jersey": 4}]}],
        )
        self.assertEqual([item["jersey"] for item in saved["frames"][0]["marks"]], [4, 4])

    def test_duplicate_jersey_on_one_side_is_rejected(self):
        asset = _asset()
        first = apply_homography(asset["court_maps"][0]["court_to_image"], 2.0, 2.0)
        second = apply_homography(asset["court_maps"][0]["court_to_image"], 6.0, 4.0)
        with self.assertRaises(PlayerMarkError):
            build_player_marks(
                asset,
                [{"rally": 1, "marks": [{"x": first[0], "y": first[1], "jersey": 7}, {"x": second[0], "y": second[1], "jersey": 7}]}],
            )

    def test_unknown_jerseys_can_repeat(self):
        asset = _asset()
        first = apply_homography(asset["court_maps"][0]["court_to_image"], 2.0, 2.0)
        second = apply_homography(asset["court_maps"][0]["court_to_image"], 6.0, 4.0)
        saved = build_player_marks(
            asset,
            [{"rally": 1, "marks": [{"x": first[0], "y": first[1]}, {"x": second[0], "y": second[1]}]}],
        )
        self.assertEqual(saved["frames"][0]["unknown_count"], 2)

    def test_unreadable_numbers_stay_unknown(self):
        asset = _asset()
        point = apply_homography(asset["court_maps"][0]["court_to_image"], 4.5, 3.0)
        with self.assertRaises(PlayerMarkError):
            build_player_marks(asset, [{"rally": 1, "marks": [{"x": point[0], "y": point[1], "jersey": 0}]}])

    def test_register_keeps_player_marks(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            video = root / "set.mp4"
            video.write_bytes(b"players")
            registry = root / "video-assets.json"
            register_asset(video, ProbeFacts(1920, 1080, "h264", 60.0, 60.0, 10_000, 0, 1), CameraAttestation(True, True, True, True), registry_path=registry)
            marks = {"schema": "gamepath.player_marks.v1", "source": "human", "frames": []}
            set_asset_player_marks(registry, video, marks)
            register_asset(video, ProbeFacts(1920, 1080, "h264", 60.0, 60.0, 10_000, 0, 1), CameraAttestation(True, True, True, True), registry_path=registry)
            stored = load_registry(registry)["assets"][0]
            self.assertEqual(stored["player_marks"]["source"], "human")
