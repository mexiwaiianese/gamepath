import unittest

from gamepath_video.contract import FLAG_FPS_30, PROFILE_ID
from gamepath_video.profile import CameraAttestation, ProbeFacts, evaluate


def facts(**overrides) -> ProbeFacts:
    base = dict(
        width=1920,
        height=1080,
        codec="h264",
        avg_fps=60.0,
        r_fps=60.0,
        duration_ms=1_200_000,
        rotation_degrees=0,
        video_stream_count=1,
    )
    base.update(overrides)
    return ProbeFacts(**base)


def attested() -> CameraAttestation:
    return CameraAttestation(
        camera_fixed=True,
        full_court=True,
        baselines_visible=True,
        net_visible=True,
    )


class ProfileTests(unittest.TestCase):
    def test_constant_60_is_accepted(self):
        decision = evaluate(facts(), attested())
        self.assertEqual(decision.decision, "accepted")
        self.assertEqual(decision.flags, ())
        self.assertEqual(decision.reasons, ())
        self.assertEqual(decision.camera_profile, PROFILE_ID)

    def test_ntsc_59_94_is_accepted_as_60(self):
        rate = 60000 / 1001
        decision = evaluate(facts(avg_fps=rate, r_fps=rate, codec="hevc"), attested())
        self.assertEqual(decision.decision, "accepted")

    def test_constant_30_is_accepted_and_excluded_from_ball_training(self):
        rate = 30000 / 1001
        decision = evaluate(facts(avg_fps=rate, r_fps=rate), attested())
        self.assertEqual(decision.decision, "accepted_flagged")
        self.assertEqual(decision.flags, (FLAG_FPS_30,))
        self.assertTrue(decision.accepted)

    def test_wrong_resolution_is_rejected(self):
        decision = evaluate(facts(width=1280, height=720), attested())
        self.assertEqual(decision.decision, "rejected")
        self.assertEqual([reason.code for reason in decision.reasons], ["resolution"])

    def test_portrait_storage_is_rejected(self):
        decision = evaluate(facts(width=1080, height=1920), attested())
        codes = [reason.code for reason in decision.reasons]
        self.assertIn("resolution", codes)

    def test_rotation_tag_is_rejected(self):
        decision = evaluate(facts(rotation_degrees=90), attested())
        self.assertEqual([reason.code for reason in decision.reasons], ["rotation"])

    def test_variable_frame_rate_is_rejected_without_the_30fps_flag(self):
        decision = evaluate(facts(avg_fps=29.97, r_fps=120.0), attested())
        self.assertEqual(decision.decision, "rejected")
        self.assertEqual([reason.code for reason in decision.reasons], ["variable_frame_rate"])
        self.assertEqual(decision.flags, ())

    def test_unsupported_codec_and_frame_rate_collect_every_reason(self):
        decision = evaluate(facts(codec="vp9", avg_fps=24.0, r_fps=24.0, duration_ms=0), CameraAttestation())
        codes = [reason.code for reason in decision.reasons]
        self.assertEqual(
            codes,
            ["codec", "frame_rate", "duration", "camera_fixed", "full_court", "baselines_visible", "net_visible"],
        )

    def test_missing_frame_rate_is_rejected(self):
        decision = evaluate(facts(avg_fps=0.0, r_fps=0.0), attested())
        self.assertEqual([reason.code for reason in decision.reasons], ["frame_rate"])

    def test_extra_video_stream_is_rejected(self):
        decision = evaluate(facts(video_stream_count=2), attested())
        self.assertEqual([reason.code for reason in decision.reasons], ["multiple_video_streams"])

    def test_rejected_30fps_file_still_carries_the_ball_exclusion_flag(self):
        decision = evaluate(facts(avg_fps=30.0, r_fps=30.0, width=1280, height=720), attested())
        self.assertEqual(decision.decision, "rejected")
        self.assertEqual(decision.flags, (FLAG_FPS_30,))


if __name__ == "__main__":
    unittest.main()
