import hashlib
import io
import json
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

from gamepath_video.cli import main
from gamepath_video.profile import CameraAttestation, ProbeFacts
from gamepath_video.registry import load_registry, register_asset


def facts(**overrides) -> ProbeFacts:
    base = dict(
        width=1920,
        height=1080,
        codec="h264",
        avg_fps=60.0,
        r_fps=60.0,
        duration_ms=10_000,
        rotation_degrees=0,
        video_stream_count=1,
    )
    base.update(overrides)
    return ProbeFacts(**base)


class RegistryTests(unittest.TestCase):
    def test_register_hashes_file_and_is_idempotent_by_hash(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            video = root / "set.mp4"
            video.write_bytes(b"not-a-real-video")
            registry = root / "video-assets.json"
            attestation = CameraAttestation(True, True, True, True)

            first = register_asset(video, facts(), attestation, registry_path=registry)
            second = register_asset(
                video,
                facts(avg_fps=30.0, r_fps=30.0),
                attestation,
                registry_path=registry,
            )

            stored = load_registry(registry)
            self.assertEqual(len(stored["assets"]), 1)
            self.assertEqual(first["id"], second["id"])
            self.assertEqual(first["created_at"], second["created_at"])
            self.assertEqual(second["decision"], "accepted_flagged")
            self.assertEqual(second["sha256"], hashlib.sha256(b"not-a-real-video").hexdigest())
            self.assertEqual(second["byte_size"], len(b"not-a-real-video"))
            self.assertTrue(second["contains_minors"])
            self.assertEqual(json.loads(registry.read_text(encoding="utf-8"))["schema"], stored["schema"])

    def test_distinct_files_stay_separate_records(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            first_file = root / "a.mp4"
            second_file = root / "b.mp4"
            first_file.write_bytes(b"a")
            second_file.write_bytes(b"b")
            registry = root / "video-assets.json"
            attestation = CameraAttestation(True, True, True, True)
            register_asset(first_file, facts(), attestation, registry_path=registry)
            register_asset(second_file, facts(width=1280, height=720), attestation, registry_path=registry)
            stored = load_registry(registry)
            self.assertEqual(len(stored["assets"]), 2)
            decisions = {asset["decision"] for asset in stored["assets"]}
            self.assertEqual(decisions, {"accepted", "rejected"})

    def test_list_missing_registry_is_empty(self):
        with tempfile.TemporaryDirectory() as temporary:
            registry = Path(temporary) / "missing.json"
            output = io.StringIO()
            with redirect_stdout(output):
                code = main(["list", "--registry", str(registry), "--json"])
            self.assertEqual(code, 0)
            self.assertEqual(json.loads(output.getvalue()), [])

    def test_register_missing_file_exits_1(self):
        with tempfile.TemporaryDirectory() as temporary:
            with redirect_stderr(io.StringIO()):
                code = main(["register", str(Path(temporary) / "nope.mp4"), "--registry", str(Path(temporary) / "r.json")])
            self.assertEqual(code, 1)


if __name__ == "__main__":
    unittest.main()
