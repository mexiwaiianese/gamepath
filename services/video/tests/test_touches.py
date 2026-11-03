import tempfile
import unittest
from pathlib import Path

from gamepath_video.court import apply_homography, build_view
from gamepath_video.profile import CameraAttestation, ProbeFacts
from gamepath_video.registry import load_registry, register_asset, set_asset_touch_marks
from gamepath_video.touches import (
    REOPENED_SIDE_MISSES,
    TouchMarkError,
    build_touch_marks,
    drop_replaced,
    reopen_cues,
    revision_matches,
    side_misses,
    snap_media_ms,
)
from gamepath_video.touch_marker import advertised_lan_addresses, shareable_lan_addresses


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
    view["status"] = "ready"
    return {
        "probe": {"width": 1920, "height": 1080, "avg_fps": 30.0},
        "court_maps": [view],
        "rally_index": {
            "rallies": [
                {
                    "number": 1,
                    "clip_start_ms": 16_000,
                    "clip_end_ms": 28_500,
                    "serve_ms": 17_000,
                    "dead_ms": 27_000,
                }
            ]
        },
    }


class TouchMarkTests(unittest.TestCase):
    def test_contacts_are_ordered_by_time_and_keep_the_jersey(self):
        asset = _asset()
        court_to_image = asset["court_maps"][0]["court_to_image"]
        later = apply_homography(court_to_image, 4.5, 3.0)
        earlier = apply_homography(court_to_image, 2.0, 4.0)
        saved = build_touch_marks(
            asset,
            [
                {
                    "rally": 1,
                    "media_ms": 17_000,
                    "touches": [
                        {"x": later[0], "y": later[1], "media_ms": 19_000, "jersey": 11},
                        {"x": earlier[0], "y": earlier[1], "media_ms": 17_000, "jersey": 11},
                    ],
                }
            ],
        )
        touches = saved["rallies"][0]["touches"]
        self.assertEqual([touch["index"] for touch in touches], [1, 2])
        self.assertEqual(touches[0]["media_ms"], 17_000)
        self.assertEqual(touches[0]["jersey"], 11)
        self.assertEqual(touches[1]["jersey"], 11)
        self.assertEqual(touches[0]["side"], "near")

    def test_a_touch_lands_on_the_nearest_frame(self):
        self.assertEqual(snap_media_ms(17_010, 30, 1, 16_000, 28_500), 17_000)

    def test_a_touch_outside_the_rally_is_rejected(self):
        asset = _asset()
        point = apply_homography(asset["court_maps"][0]["court_to_image"], 4.5, 3.0)
        with self.assertRaises(TouchMarkError):
            build_touch_marks(asset, [{"rally": 1, "touches": [{"x": point[0], "y": point[1], "media_ms": 1_000, "jersey": 7}]}])

    def test_an_unreadable_number_stays_unknown(self):
        asset = _asset()
        point = apply_homography(asset["court_maps"][0]["court_to_image"], 4.5, 3.0)
        with self.assertRaises(TouchMarkError):
            build_touch_marks(asset, [{"rally": 1, "touches": [{"x": point[0], "y": point[1], "media_ms": 17_000, "jersey": 0}]}])

    def test_register_keeps_touch_marks(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            video = root / "set.mp4"
            video.write_bytes(b"touches")
            registry = root / "video-assets.json"
            facts = ProbeFacts(1920, 1080, "h264", 60.0, 60.0, 10_000, 0, 1)
            register_asset(video, facts, CameraAttestation(True, True, True, True), registry_path=registry)
            stored = load_registry(registry)["assets"][0]
            marks = {"schema": "gamepath.touch_marks.v1", "source": "human", "rallies": []}
            set_asset_touch_marks(registry, video, marks)
            register_asset(video, facts, CameraAttestation(True, True, True, True), registry_path=registry)
            kept = load_registry(registry)["assets"][0]
            self.assertEqual(kept["touch_marks"]["source"], "human")


class SideMissTests(unittest.TestCase):
    def test_only_clicks_without_a_side_are_cued(self):
        misses = side_misses([
            {"rally": 1, "touches": [{"index": 1, "media_ms": 1000, "side": "near"}, {"index": 2, "media_ms": 2000, "side": None}]},
            {"rally": 6, "touches": [{"index": 7, "media_ms": 575200, "side": None}]},
        ])
        self.assertEqual(misses, [{"rally": 1, "index": 2, "media_ms": 2000}, {"rally": 6, "index": 7, "media_ms": 575200}])

    def test_reopen_cues_the_same_ten_after_they_have_a_side(self):
        self.assertEqual(
            [(item["rally"], item["media_ms"]) for item in REOPENED_SIDE_MISSES],
            [
                (1, 22667),
                (1, 26000),
                (3, 292667),
                (4, 404733),
                (5, 462467),
                (6, 571067),
                (6, 575200),
                (7, 624967),
                (8, 769867),
                (9, 854000),
            ],
        )
        slots = [
            {"rally": 1, "touches": [{"index": 4, "media_ms": 22667, "x": 1, "y": 2, "side": "near"}]},
            {"rally": 6, "touches": [{"index": 8, "media_ms": 575200, "x": 3, "y": 4, "side": "far"}]},
        ]
        cues = reopen_cues(slots, [{"rally": 1, "media_ms": 22667}, {"rally": 6, "media_ms": 575200}])
        self.assertEqual(cues, [
            {"rally": 1, "index": 4, "media_ms": 22667},
            {"rally": 6, "index": 8, "media_ms": 575200},
        ])

    def test_a_new_click_leaves_the_reopen_queue(self):
        pending = [{"rally": 1, "media_ms": 22667}, {"rally": 6, "media_ms": 575200}]
        before = [
            {"rally": 1, "touches": [{"media_ms": 22667, "x": 10, "y": 20}]},
            {"rally": 6, "touches": [{"media_ms": 575200, "x": 30, "y": 40}]},
        ]
        after = [
            {"rally": 1, "touches": [{"media_ms": 22667, "x": 11, "y": 20}]},
            {"rally": 6, "touches": [{"media_ms": 575200, "x": 30, "y": 40}]},
        ]
        self.assertEqual(drop_replaced(pending, before, after), [{"rally": 6, "media_ms": 575200}])

    def test_a_stale_computer_does_not_overwrite_this_record(self):
        self.assertTrue(revision_matches(None, "2026-10-11T00:00:00+00:00"))
        self.assertTrue(revision_matches("2026-10-11T00:00:00+00:00", "2026-10-11T00:00:00+00:00"))
        self.assertFalse(revision_matches("2026-10-11T00:00:00+00:00", "2026-10-11T00:00:01+00:00"))


class LanAddressTests(unittest.TestCase):
    def test_same_wifi_addresses_skip_the_virtual_switch(self):
        addresses = shareable_lan_addresses(
            ["127.0.0.1", "172.20.176.1", "192.168.86.36", "192.168.86.49", "169.254.1.1"],
            primary="192.168.86.49",
        )
        self.assertEqual(addresses, ["192.168.86.49", "192.168.86.36"])

    def test_the_tagger_advertises_the_address_other_computers_can_open(self):
        addresses = advertised_lan_addresses(
            ["172.20.176.1", "192.168.86.36", "192.168.86.49", "192.168.137.1"],
            primary="192.168.86.49",
        )
        self.assertEqual(addresses, ["192.168.86.49", "192.168.137.1"])
