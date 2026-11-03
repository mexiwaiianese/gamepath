"""Locked ingestion constants shared by training and live capture.

Step 1 enforces the capture profile. Later steps import the same values
instead of inventing a second preprocess.
"""

PROFILE_ID = "gym-baseline-v1"

FRAME_WIDTH = 1920
FRAME_HEIGHT = 1080
ALLOWED_CODECS = frozenset({"h264", "hevc"})

# 59.94 (60000/1001) and 29.97 (30000/1001) fall inside these bands.
FPS_60_RANGE = (59.0, 60.5)
FPS_30_RANGE = (29.5, 30.5)
VFR_RELATIVE_TOLERANCE = 0.01

MODEL_INPUT_WIDTH = 1280
MODEL_INPUT_HEIGHT = 720
STUDENT_FPS = 30
STUDENT_LOOKAHEAD_MS = 167
PREROLL_MS = 1000
POSTROLL_MS = 1500

FLAG_FPS_30 = "fps_30_excluded_from_ball"
