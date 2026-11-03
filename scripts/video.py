"""Run the video registry from the repo root without installing the package."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services" / "video"))

from gamepath_video.cli import main

sys.exit(main())
