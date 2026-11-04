import unittest

from gamepath_video.marker import MarkerError, choose_asset


def _asset(asset_id, path, confirmed=True, frames=False):
    asset = {"id": asset_id, "path": path, "rally_index": {"review": "confirmed" if confirmed else "pending"}}
    if frames:
        asset["frame_list"] = {"row_count": 1}
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


if __name__ == "__main__":
    unittest.main()
