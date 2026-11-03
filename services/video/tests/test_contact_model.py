import unittest

from gamepath_video.contact_model import fit_contact_model, predict_contact, score_held_out, split_rallies
from gamepath_video.train import TrainError


def _touch(rally: int, media_ms: int, index: int, jersey, side: str, court_x: float, court_y: float) -> dict:
    return {
        "type": "example",
        "rally": rally,
        "frame_index": media_ms,
        "media_ms": media_ms,
        "contact": {
            "offset_ms": 0,
            "index": index,
            "jersey": jersey,
            "side": side,
            "court_x": court_x,
            "court_y": court_y,
        },
    }


def _quiet(rally: int, media_ms: int) -> dict:
    return {"type": "example", "rally": rally, "frame_index": media_ms, "media_ms": media_ms, "contact": None}


class ContactModelTests(unittest.TestCase):
    def setUp(self):
        self.serves = {1: 10_000, 2: 20_000}
        self.examples = [
            _quiet(1, 10_000),
            _touch(1, 11_000, 1, 7, "near", 4.0, 3.0),
            _quiet(1, 12_000),
            _quiet(2, 20_000),
            _touch(2, 21_000, 1, 4, "far", 8.0, 16.0),
            _quiet(2, 22_000),
        ]

    def test_the_last_rally_is_held_out(self):
        trained, held = split_rallies([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
        self.assertEqual(held, [9, 10])
        self.assertNotIn(9, trained)
        self.assertNotIn(10, trained)

    def test_a_held_out_rally_does_not_change_the_learned_touch(self):
        model = fit_contact_model(self.examples, self.serves)
        self.assertEqual(model["trained_rallies"], [1])
        self.assertEqual(model["held_out_rallies"], [2])
        learned = model["touches"][0]
        self.assertEqual(learned["jersey"], 7)
        self.assertEqual(learned["side"], "near")
        self.assertEqual(learned["court_x"], 4.0)
        self.assertEqual(learned["court_y"], 3.0)
        self.assertEqual(learned["delay_ms"], 1_000)

    def test_prediction_is_only_inside_the_lookahead(self):
        model = fit_contact_model(self.examples, self.serves, lookahead_ms=167)
        self.assertIsNone(predict_contact(model, 20_000, self.serves[2]))
        predicted = predict_contact(model, 20_900, self.serves[2])
        self.assertEqual(predicted["offset_ms"], 100)
        self.assertEqual(predicted["jersey"], 7)
        self.assertEqual(predicted["side"], "near")

    def test_held_out_score_keeps_the_human_label_separate(self):
        model = fit_contact_model(self.examples, self.serves, lookahead_ms=167)
        score = score_held_out(self.examples, model, self.serves)
        self.assertEqual(score["held_out_rallies"], [2])
        self.assertEqual(score["true_positive"], 1)
        self.assertEqual(score["false_negative"], 0)
        self.assertEqual(score["side_accuracy"], 0.0)
        self.assertEqual(score["jersey_accuracy"], 0.0)
        self.assertEqual(self.examples[4]["contact"]["jersey"], 4)

    def test_one_rally_cannot_be_scored_on_itself(self):
        with self.assertRaises(TrainError):
            fit_contact_model(self.examples[:3], {1: 10_000})
