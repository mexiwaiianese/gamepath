import unittest
from pathlib import Path

from gamepath_video.train import TrainError, build_student_examples, on_student_clock, select_training_asset


def _asset(**overrides):
    asset = {
        "id": "asset-1",
        "sha256": "abc",
        "path": "C:/sets/sr v herr2.mp4",
        "decision": "accepted_flagged",
        "flags": ["fps_30_excluded_from_ball"],
        "probe": {"width": 1920, "height": 1080, "avg_fps": 30.0},
        "rally_index": {
            "review": "confirmed",
            "rallies": [{"number": 1, "clip_start_ms": 16_000, "clip_end_ms": 16_200}],
        },
        "touch_marks": {
            "source": "human",
            "rallies": [
                {
                    "rally": 1,
                    "touches": [
                        {"index": 1, "media_ms": 16_067, "jersey": 7, "side": "near", "court_x": 4.5, "court_y": 3.0}
                    ],
                }
            ],
        },
    }
    asset.update(overrides)
    return asset


class StudentExampleTests(unittest.TestCase):
    def test_a_touch_labels_the_frames_inside_the_lookahead(self):
        examples = build_student_examples(_asset())["examples"]
        by_time = {row["media_ms"]: row["contact"] for row in examples}
        self.assertEqual(by_time[16_000]["offset_ms"], 67)
        self.assertEqual(by_time[16_000]["jersey"], 7)
        self.assertEqual(by_time[16_067]["offset_ms"], 0)
        self.assertIsNone(by_time[16_200])

    def test_a_touch_beyond_167_ms_is_not_the_label(self):
        asset = _asset()
        asset["touch_marks"]["rallies"][0]["touches"][0]["media_ms"] = 16_200
        by_time = {row["media_ms"]: row["contact"] for row in build_student_examples(asset)["examples"]}
        self.assertIsNone(by_time[16_000])
        self.assertEqual(by_time[16_033]["offset_ms"], 167)
        self.assertEqual(by_time[16_200]["offset_ms"], 0)

    def test_30_fps_stays_out_of_ball_training(self):
        built = build_student_examples(_asset())
        self.assertFalse(built["ball_training"])
        self.assertEqual(built["ball_exclusion"], "fps_30_excluded_from_ball")
        self.assertEqual(built["label_source"], "human")

    def test_marks_that_are_not_human_are_refused(self):
        asset = _asset()
        asset["touch_marks"]["source"] = "model"
        with self.assertRaises(TrainError):
            build_student_examples(asset)

    def test_an_unmarked_rally_is_refused(self):
        asset = _asset()
        asset["touch_marks"]["rallies"] = []
        with self.assertRaises(TrainError):
            build_student_examples(asset)

    def test_60_fps_keeps_the_student_30_fps_clock(self):
        self.assertTrue(on_student_clock(0, 60, 1))
        self.assertFalse(on_student_clock(17, 60, 1))
        self.assertTrue(on_student_clock(33, 60, 1))

    def test_only_the_named_recording_can_train(self):
        assets = [
            {"path": r"C:\sets\skyridge v herriman.mp4"},
            {"path": r"C:\sets\sr v herr.mp4"},
            {"path": r"C:\sets\sr v herr2.mp4"},
        ]
        chosen = select_training_asset(assets)
        self.assertEqual(Path(chosen["path"]).name, "sr v herr2.mp4")
        with self.assertRaises(TrainError):
            select_training_asset(assets, Path(r"C:\sets\sr v herr.mp4"))
