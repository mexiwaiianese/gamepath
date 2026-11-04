import unittest

from gamepath_video.marker import MarkerError, choose_asset, has_ready_court_map


def _asset(asset_id, path, confirmed=True, frames=False, confirmed_at=None, court_map=False):
    index = {"review": "confirmed" if confirmed else "pending"}
    if confirmed_at:
        index["confirmed_at"] = confirmed_at
    asset = {"id": asset_id, "path": path, "rally_index": index}
    if frames:
        asset["frame_list"] = {"row_count": 1}
    if court_map:
        asset["court_maps"] = [{"role": "setup", "status": "ready", "image_to_court": [1, 0, 0, 0, 1, 0, 0, 0, 1]}]
    return asset


class ChooseAssetTest(unittest.TestCase):
    def setUp(self):
        self.registry = {
            "assets": [
                _asset("a", "C:\\v\\a.mp4", frames=True),
                _asset("b", "C:\\v\\b.mp4"),
                _asset("c", "C:\\v\\c.mp4", confirmed=False),
            ]
        }

    def test_default_prefers_newest_with_frames(self):
        self.assertEqual(choose_asset(self.registry)["id"], "a")

    def test_selects_by_id_or_path(self):
        self.assertEqual(choose_asset(self.registry, "b")["id"], "b")
        self.assertEqual(choose_asset(self.registry, "C:\\v\\b.mp4")["id"], "b")

    def test_rejects_unconfirmed_or_unknown(self):
        with self.assertRaises(MarkerError):
            choose_asset(self.registry, "c")
        with self.assertRaises(MarkerError):
            choose_asset(self.registry, "zzz")

    def test_nothing_confirmed_is_an_error(self):
        with self.assertRaises(MarkerError):
            choose_asset({"assets": [_asset("c", "C:\\v\\c.mp4", confirmed=False)]})


class NewestConfirmedTest(unittest.TestCase):
    def test_most_recently_confirmed_beats_registry_order(self):
        registry = {
            "assets": [
                _asset("old", "/v/old.mp4", frames=True, confirmed_at="2026-10-01T12:00:00+00:00"),
                _asset("new", "/v/new.mp4", frames=True, confirmed_at="2026-11-02T12:00:00+00:00"),
                _asset("registered-last", "/v/last.mp4", frames=True, confirmed_at="2026-10-15T12:00:00+00:00"),
            ]
        }
        self.assertEqual(choose_asset(registry)["id"], "new")

    def test_registry_order_is_the_fallback(self):
        registry = {
            "assets": [
                _asset("first", "/v/1.mp4", frames=True),
                _asset("second", "/v/2.mp4", frames=True),
            ]
        }
        self.assertEqual(choose_asset(registry)["id"], "second")

    def test_stamped_asset_beats_unstamped_even_when_registered_earlier(self):
        registry = {
            "assets": [
                _asset("stamped", "/v/1.mp4", frames=True, confirmed_at="2026-11-01T00:00:00+00:00"),
                _asset("legacy", "/v/2.mp4", frames=True),
            ]
        }
        self.assertEqual(choose_asset(registry)["id"], "stamped")

    def test_times_compare_as_instants_not_strings(self):
        registry = {
            "assets": [
                _asset("later", "/v/1.mp4", frames=True, confirmed_at="2026-11-02T01:00:00+00:00"),
                # 23:00 at UTC-7 is 06:00 UTC the next day, so this one is newer although its text sorts lower.
                _asset("newer", "/v/2.mp4", frames=True, confirmed_at="2026-11-01T23:00:00-07:00"),
            ]
        }
        self.assertEqual(choose_asset(registry)["id"], "newer")

    def test_bad_timestamp_counts_as_unstamped(self):
        registry = {
            "assets": [
                _asset("good", "/v/1.mp4", frames=True, confirmed_at="2026-11-01T00:00:00+00:00"),
                _asset("junk", "/v/2.mp4", frames=True, confirmed_at="not a time"),
            ]
        }
        self.assertEqual(choose_asset(registry)["id"], "good")

    def test_frames_are_preferred_over_a_newer_confirmed_asset_without_them(self):
        registry = {
            "assets": [
                _asset("framed", "/v/1.mp4", frames=True, confirmed_at="2026-10-01T00:00:00+00:00"),
                _asset("newer-no-frames", "/v/2.mp4", confirmed_at="2026-11-01T00:00:00+00:00"),
            ]
        }
        self.assertEqual(choose_asset(registry)["id"], "framed")

    def test_without_any_frames_the_newest_confirmed_is_used(self):
        registry = {
            "assets": [
                _asset("a", "/v/1.mp4", confirmed_at="2026-11-01T00:00:00+00:00"),
                _asset("b", "/v/2.mp4", confirmed_at="2026-10-01T00:00:00+00:00"),
            ]
        }
        self.assertEqual(choose_asset(registry)["id"], "a")

    def test_explicit_selector_ignores_recency(self):
        registry = {
            "assets": [
                _asset("a", "/v/1.mp4", frames=True, confirmed_at="2026-10-01T00:00:00+00:00"),
                _asset("b", "/v/2.mp4", frames=True, confirmed_at="2026-11-01T00:00:00+00:00"),
            ]
        }
        self.assertEqual(choose_asset(registry, "a")["id"], "a")


class NeedCourtMapTest(unittest.TestCase):
    def test_players_and_touches_prefer_assets_with_a_saved_court_map(self):
        registry = {
            "assets": [
                _asset("mapped", "/v/1.mp4", frames=True, court_map=True, confirmed_at="2026-10-01T00:00:00+00:00"),
                _asset("newer", "/v/2.mp4", frames=True, confirmed_at="2026-11-01T00:00:00+00:00"),
            ]
        }
        self.assertEqual(choose_asset(registry)["id"], "newer")
        self.assertEqual(choose_asset(registry, need_court_map=True)["id"], "mapped")

    def test_newest_of_the_mapped_assets_wins(self):
        registry = {
            "assets": [
                _asset("a", "/v/1.mp4", court_map=True, confirmed_at="2026-10-01T00:00:00+00:00"),
                _asset("b", "/v/2.mp4", court_map=True, confirmed_at="2026-11-01T00:00:00+00:00"),
            ]
        }
        self.assertEqual(choose_asset(registry, need_court_map=True)["id"], "b")

    def test_falls_back_to_newest_confirmed_so_the_marker_can_explain_what_is_missing(self):
        registry = {"assets": [_asset("a", "/v/1.mp4", confirmed_at="2026-10-01T00:00:00+00:00"), _asset("b", "/v/2.mp4", confirmed_at="2026-11-01T00:00:00+00:00")]}
        self.assertEqual(choose_asset(registry, need_court_map=True)["id"], "b")

    def test_an_invalid_court_map_does_not_count(self):
        asset = _asset("a", "/v/1.mp4")
        asset["court_maps"] = [{"role": "setup", "status": "invalid", "image_to_court": None}]
        self.assertFalse(has_ready_court_map(asset))
        self.assertTrue(has_ready_court_map(_asset("b", "/v/2.mp4", court_map=True)))


if __name__ == "__main__":
    unittest.main()
