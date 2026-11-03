"""Local video ingestion. This package owns pixels; the app owns the event log."""

from gamepath_video.contract import PROFILE_ID
from gamepath_video.profile import evaluate

__all__ = ["PROFILE_ID", "evaluate"]
