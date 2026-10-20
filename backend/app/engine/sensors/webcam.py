"""Posture source for real mode.

MediaPipe runs in the browser (see ``frontend/src/hooks/usePostureTracking.ts``)
which already produces the five posture features. This class just holds the
most recent frame the browser posted so the runtime can consume it uniformly.
Invalid / stale frames are ignored rather than scored.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field

FEATURES = ("neck_angle", "shoulder_tilt", "head_forward", "distance_proxy", "movement")


@dataclass
class WebcamSource:
    """Keeps the latest browser-posted features with a freshness stamp."""

    stale_after_s: float = 5.0
    _latest: dict | None = field(default=None, init=False, repr=False)
    _ts: float = field(default=0.0, init=False, repr=False)

    def update(self, features: dict) -> None:
        clean = {k: float(features[k]) for k in FEATURES if features.get(k) is not None}
        if not clean:
            return
        self._latest = clean
        self._ts = time.monotonic()

    def read(self) -> tuple[dict | None, str]:
        """Return ``({features}, status)`` where status is ``ok`` or ``off``."""
        if self._latest is None:
            return None, "off"
        if time.monotonic() - self._ts > self.stale_after_s:
            return None, "off"
        return dict(self._latest), "ok"
