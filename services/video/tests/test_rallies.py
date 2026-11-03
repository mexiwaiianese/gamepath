import unittest

from gamepath_video.rallies import RallyError, build_rally_index, confirm_rally_index, parse_rally_span


class RallyIndexTests(unittest.TestCase):
    def test_clip_opens_before_the_serve_and_closes_after_the_dead_ball(self):
        index = build_rally_index(
            [(17, 27), (193, 204)],
            duration_ms=2_562_933,
            first_serve_ms=17_000,
            set_end_ms=2_539_000,
        )
        first, second = index["rallies"]
        self.assertEqual(index["coverage"], "sample")
        self.assertEqual(index["review"], "pending")
        self.assertEqual(first["serve_ms"], 17_000)
        self.assertEqual(first["dead_ms"], 27_000)
        self.assertEqual(first["clip_start_ms"], 16_000)
        self.assertEqual(first["clip_end_ms"], 28_500)
        self.assertEqual(second["number"], 2)
        self.assertEqual(second["clip_start_ms"], 192_000)
        self.assertEqual(second["clip_end_ms"], 205_500)

    def test_preroll_does_not_start_before_the_file(self):
        index = build_rally_index([(0.4, 2)], duration_ms=10_000)
        self.assertEqual(index["rallies"][0]["clip_start_ms"], 0)

    def test_overlap_is_rejected(self):
        with self.assertRaises(RallyError):
            build_rally_index([(17, 27), (20, 30)], duration_ms=60_000)

    def test_rally_after_the_set_is_rejected(self):
        with self.assertRaises(RallyError):
            build_rally_index([(17, 27)], duration_ms=60_000, first_serve_ms=17_000, set_end_ms=20_000)

    def test_confirm_marks_the_sample_reviewed(self):
        index = build_rally_index([(17, 27)], duration_ms=60_000)
        confirmed = confirm_rally_index(index, confirmed_at="2026-09-28T18:00:00+00:00")
        self.assertEqual(confirmed["review"], "confirmed")
        self.assertEqual(confirmed["rallies"], index["rallies"])

    def test_span_parser_accepts_spaces(self):
        self.assertEqual(parse_rally_span("17 - 27"), (17.0, 27.0))


if __name__ == "__main__":
    unittest.main()
