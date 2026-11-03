import unittest
from pathlib import Path

from gamepath_video.probe import ProbeError, ffprobe_executable, parse_ffprobe


CLEAN = {
    "streams": [
        {
            "codec_type": "video",
            "codec_name": "h264",
            "width": 1920,
            "height": 1080,
            "avg_frame_rate": "60000/1001",
            "r_frame_rate": "60000/1001",
            "duration": "90.5",
        },
        {"codec_type": "audio", "codec_name": "aac"},
    ],
    "format": {"duration": "90.5"},
}


class ProbeParseTests(unittest.TestCase):
    def test_parses_ntsc_rate_duration_and_ignores_audio(self):
        facts = parse_ffprobe(CLEAN)
        self.assertEqual(facts.width, 1920)
        self.assertEqual(facts.height, 1080)
        self.assertEqual(facts.codec, "h264")
        self.assertAlmostEqual(facts.avg_fps, 60000 / 1001)
        self.assertAlmostEqual(facts.r_fps, 60000 / 1001)
        self.assertEqual(facts.duration_ms, 90500)
        self.assertEqual(facts.rotation_degrees, 0)
        self.assertEqual(facts.video_stream_count, 1)

    def test_reads_display_matrix_rotation(self):
        payload = {
            "streams": [
                {
                    "codec_type": "video",
                    "codec_name": "hevc",
                    "width": 1920,
                    "height": 1080,
                    "avg_frame_rate": "30/1",
                    "r_frame_rate": "30/1",
                    "side_data_list": [{"side_data_type": "Display Matrix", "rotation": -90}],
                }
            ],
            "format": {"duration": "10"},
        }
        facts = parse_ffprobe(payload)
        self.assertEqual(facts.rotation_degrees, 270)
        self.assertEqual(facts.duration_ms, 10000)

    def test_missing_video_stream_raises(self):
        with self.assertRaises(ProbeError):
            parse_ffprobe({"streams": [{"codec_type": "audio"}], "format": {}})

    def test_finds_ffprobe_outside_the_current_path(self):
        try:
            binary = ffprobe_executable()
        except ProbeError:
            self.skipTest("ffprobe is not installed")
        self.assertTrue(Path(binary).is_file())

    def test_zero_rate_token_parses_as_zero(self):
        payload = {
            "streams": [
                {
                    "codec_type": "video",
                    "codec_name": "h264",
                    "width": 1920,
                    "height": 1080,
                    "avg_frame_rate": "0/0",
                    "r_frame_rate": "N/A",
                }
            ],
            "format": {},
        }
        facts = parse_ffprobe(payload)
        self.assertEqual(facts.avg_fps, 0.0)
        self.assertEqual(facts.r_fps, 0.0)
        self.assertEqual(facts.duration_ms, 0)


if __name__ == "__main__":
    unittest.main()
