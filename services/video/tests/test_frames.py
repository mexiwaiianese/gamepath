import unittest

from gamepath_video.frames import frame_indexes, iter_frames, letterbox, pts_ms


class FrameListTests(unittest.TestCase):
    def test_closed_clip_includes_the_first_and_last_frame(self):
        indexes = list(frame_indexes(16_000, 28_500, 30, 1))
        self.assertEqual(pts_ms(indexes[0], 30, 1), 16_000)
        self.assertEqual(pts_ms(indexes[-1], 30, 1), 28_500)
        self.assertEqual(len(indexes), 376)

    def test_1920x1080_scales_to_1280x720_with_no_bars(self):
        box = letterbox(1920, 1080)
        self.assertEqual(box["content_width"], 1280)
        self.assertEqual(box["content_height"], 720)
        self.assertEqual(box["pad_x"], 0)
        self.assertEqual(box["pad_y"], 0)

    def test_4_by_3_frame_gets_side_bars(self):
        box = letterbox(1440, 1080)
        self.assertEqual(box["content_width"], 960)
        self.assertEqual(box["content_height"], 720)
        self.assertEqual(box["pad_x"], 160)
        self.assertEqual(box["pad_y"], 0)

    def test_confirmed_sample_emits_a_header_and_rows(self):
        asset = {
            "id": "asset-1",
            "sha256": "abc",
            "path": "C:/match.mp4",
            "probe": {"width": 1920, "height": 1080, "avg_fps": 30.0},
            "rally_index": {
                "review": "confirmed",
                "rallies": [{"number": 1, "clip_start_ms": 16_000, "clip_end_ms": 16_100}],
            },
        }
        rows = list(iter_frames(asset))
        self.assertEqual(rows[0]["type"], "header")
        self.assertEqual(rows[0]["model_width"], 1280)
        self.assertTrue(all(row["type"] == "frame" for row in rows[1:]))
        self.assertEqual(rows[1]["media_ms"], 16_000)
        self.assertEqual(rows[-1]["media_ms"], 16_100)

    def test_unconfirmed_sample_is_refused(self):
        asset = {
            "probe": {"width": 1920, "height": 1080, "avg_fps": 30},
            "rally_index": {"review": "pending", "rallies": [{"number": 1, "clip_start_ms": 0, "clip_end_ms": 1000}]},
        }
        with self.assertRaises(ValueError):
            list(iter_frames(asset))


if __name__ == "__main__":
    unittest.main()
