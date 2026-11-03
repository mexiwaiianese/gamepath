"""Accept or reject a probed recording against gym-baseline-v1."""

from dataclasses import dataclass

from gamepath_video.contract import (
    ALLOWED_CODECS,
    FLAG_FPS_30,
    FPS_30_RANGE,
    FPS_60_RANGE,
    FRAME_HEIGHT,
    FRAME_WIDTH,
    PROFILE_ID,
    VFR_RELATIVE_TOLERANCE,
)


@dataclass(frozen=True)
class ProbeFacts:
    width: int
    height: int
    codec: str
    avg_fps: float
    r_fps: float
    duration_ms: int
    rotation_degrees: int
    video_stream_count: int


@dataclass(frozen=True)
class CameraAttestation:
    """Operator confirmation. A file probe cannot see the gym."""

    camera_fixed: bool = False
    full_court: bool = False
    baselines_visible: bool = False
    net_visible: bool = False


@dataclass(frozen=True)
class Reason:
    code: str
    message: str


@dataclass(frozen=True)
class ProfileDecision:
    decision: str
    flags: tuple[str, ...]
    reasons: tuple[Reason, ...]
    camera_profile: str = PROFILE_ID

    @property
    def accepted(self) -> bool:
        return self.decision in {"accepted", "accepted_flagged"}


def is_variable_frame_rate(avg_fps: float, r_fps: float) -> bool:
    if avg_fps <= 0 or r_fps <= 0:
        return True
    baseline = max(avg_fps, r_fps)
    return abs(avg_fps - r_fps) / baseline > VFR_RELATIVE_TOLERANCE


def nominal_fps(avg_fps: float) -> str | None:
    low_60, high_60 = FPS_60_RANGE
    low_30, high_30 = FPS_30_RANGE
    if low_60 <= avg_fps <= high_60:
        return "60"
    if low_30 <= avg_fps <= high_30:
        return "30"
    return None


def evaluate(probe: ProbeFacts, attestation: CameraAttestation) -> ProfileDecision:
    reasons: list[Reason] = []

    if probe.video_stream_count != 1:
        reasons.append(
            Reason(
                "multiple_video_streams",
                f"File has {probe.video_stream_count} video streams. Export a single video stream.",
            )
        )

    if probe.rotation_degrees != 0:
        reasons.append(
            Reason(
                "rotation",
                f"Display rotation is {probe.rotation_degrees} degrees. Re-export as upright 1920x1080 with no rotation tag.",
            )
        )

    if probe.width != FRAME_WIDTH or probe.height != FRAME_HEIGHT:
        reasons.append(
            Reason(
                "resolution",
                f"Frame is {probe.width}x{probe.height}. {PROFILE_ID} requires {FRAME_WIDTH}x{FRAME_HEIGHT}.",
            )
        )

    codec = probe.codec.lower()
    if codec not in ALLOWED_CODECS:
        allowed = ", ".join(sorted(ALLOWED_CODECS))
        reasons.append(Reason("codec", f"Codec is {probe.codec or 'unknown'}. {PROFILE_ID} accepts {allowed}."))

    nominal = None
    if probe.avg_fps <= 0 or probe.r_fps <= 0:
        reasons.append(Reason("frame_rate", "Frame rate is missing or zero."))
    elif is_variable_frame_rate(probe.avg_fps, probe.r_fps):
        reasons.append(
            Reason(
                "variable_frame_rate",
                (
                    f"Frame rate is variable ({probe.avg_fps:.3f} fps average, {probe.r_fps:.3f} fps reported). "
                    "Convert to constant 60 fps before labeling."
                ),
            )
        )
    else:
        nominal = nominal_fps(probe.avg_fps)
        if nominal is None:
            reasons.append(
                Reason(
                    "frame_rate",
                    (
                        f"Average frame rate is {probe.avg_fps:.3f} fps. {PROFILE_ID} accepts constant 60 fps, "
                        "or constant 30 fps with a ball-training exclusion."
                    ),
                )
            )

    if probe.duration_ms <= 0:
        reasons.append(Reason("duration", "Duration is missing or zero."))

    if not attestation.camera_fixed:
        reasons.append(Reason("camera_fixed", "Camera was not attested as fixed for the whole set."))
    if not attestation.full_court:
        reasons.append(Reason("full_court", "Full-court framing was not attested."))
    if not attestation.baselines_visible:
        reasons.append(Reason("baselines_visible", "Both baselines in frame were not attested."))
    if not attestation.net_visible:
        reasons.append(Reason("net_visible", "Net in frame was not attested."))

    flags: list[str] = []
    if nominal == "30":
        flags.append(FLAG_FPS_30)

    if reasons:
        decision = "rejected"
    elif flags:
        decision = "accepted_flagged"
    else:
        decision = "accepted"

    return ProfileDecision(decision=decision, flags=tuple(flags), reasons=tuple(reasons))
