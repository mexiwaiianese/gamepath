import unittest

from gamepath_video.court import CourtMapError, apply_homography, build_view, catalog_for, homography


class CourtMapTests(unittest.TestCase):
    def test_four_corners_roundtrip_to_the_floor(self):
        image = [(200, 900), (1700, 900), (600, 150), (1300, 150)]
        court = [(0, 0), (9, 0), (0, 18), (9, 18)]
        matrix = homography(image, court)
        for (u, v), (x, y) in zip(image, court):
            mapped_x, mapped_y = apply_homography(matrix, u, v)
            self.assertAlmostEqual(mapped_x, x, places=3)
            self.assertAlmostEqual(mapped_y, y, places=3)

    def test_ready_map_reports_a_small_pixel_error(self):
        view = build_view(
            {
                "near_left_baseline": {"x": 200, "y": 900},
                "near_right_baseline": {"x": 1700, "y": 900},
                "far_left_baseline": {"x": 600, "y": 150},
                "far_right_baseline": {"x": 1300, "y": 150},
                "center_left": None,
            },
            media_ms=18_000,
            width=1920,
            height=1080,
        )
        self.assertEqual(view["status"], "ready")
        self.assertEqual(view["click_count"], 4)
        self.assertLess(view["mean_error_px"], 1)
        self.assertIsNone(view["points"]["center_left"])

    def test_three_clicks_do_not_invent_a_map(self):
        view = build_view(
            {
                "near_left_baseline": {"x": 1, "y": 1},
                "near_right_baseline": {"x": 2, "y": 1},
                "far_left_baseline": {"x": 1, "y": 2},
            },
            media_ms=0,
            width=100,
            height=100,
        )
        self.assertEqual(view["status"], "needs_clicks")
        self.assertNotIn("image_to_court", view)

    def test_click_outside_the_picture_is_rejected(self):
        with self.assertRaises(CourtMapError):
            build_view(
                {"near_left_baseline": {"x": 2000, "y": 10}},
                media_ms=0,
                width=1920,
                height=1080,
            )

    def test_orientation_moves_the_near_end_to_the_chosen_edge(self):
        bottom = {item["id"]: item for item in catalog_for("bottom")}
        left = {item["id"]: item for item in catalog_for("left")}
        self.assertEqual(bottom["near_left_baseline"]["picture"], "Bottom left of the picture")
        self.assertEqual(bottom["far_right_baseline"]["picture"], "Top right of the picture")
        self.assertLess(left["near_left_baseline"]["x"], 15)
        self.assertGreater(left["near_left_baseline"]["y"], 70)
        self.assertLess(left["near_right_baseline"]["y"], 30)
        self.assertGreater(left["far_left_baseline"]["x"], 85)

    def test_saved_view_keeps_the_camera_orientation(self):
        view = build_view({}, media_ms=18_000, width=1920, height=1080, orientation="left")
        self.assertEqual(view["orientation"], "left")

    def test_clicks_on_one_line_are_rejected(self):
        with self.assertRaises(CourtMapError):
            homography([(0, 0), (10, 0), (20, 0), (30, 0)], [(0, 0), (9, 0), (0, 6), (9, 6)])


if __name__ == "__main__":
    unittest.main()
