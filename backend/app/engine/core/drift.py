"""Gradual posture drift detection.

The idea: a single bad frame is not drift. Drift is a *slow, sustained* move
away from the personal baseline. We look at a rolling window and flag drift
when either

* the average reading has stayed past an "enter" threshold for several minutes
  (a sustained offset), or
* a straight line through the window is clearly sloping away from baseline
  (a trend).

Hysteresis keeps it stable: once we are in a drift we only leave when the
reading comes back below a *lower* "exit" threshold, so we do not flicker.
"""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass


@dataclass
class DriftState:
    level: str  # "none" | "mild" | "significant"
    feature: str
    minutes: float

    def to_json(self) -> dict:
        return {"level": self.level, "feature": self.feature, "minutes": round(self.minutes, 1)}


_NO_DRIFT = DriftState(level="none", feature="", minutes=0.0)


def _slope(points: list[tuple[float, float]]) -> float:
    """Least-squares slope of value vs minutes (units per minute)."""
    n = len(points)
    if n < 2:
        return 0.0
    mean_x = sum(p[0] for p in points) / n
    mean_y = sum(p[1] for p in points) / n
    num = sum((x - mean_x) * (y - mean_y) for x, y in points)
    den = sum((x - mean_x) ** 2 for x, _ in points)
    if den <= 1e-12:
        return 0.0
    return num / den


class DriftDetector:
    """Stateful, per-user drift tracker for one feature."""

    def __init__(
        self,
        *,
        feature: str = "neck_angle",
        window_minutes: float,
        enter_threshold: float,
        exit_threshold: float,
        enter_minutes: float,
        significant_multiplier: float,
    ) -> None:
        self.feature = feature
        self.window_minutes = window_minutes
        self.enter_threshold = enter_threshold
        self.exit_threshold = exit_threshold
        self.enter_minutes = enter_minutes
        self.significant_multiplier = significant_multiplier

        # (minutes, baseline_delta)
        self._points: deque[tuple[float, float]] = deque()
        self._active = False
        self._since_minutes: float = 0.0

    def reset(self) -> None:
        self._points.clear()
        self._active = False
        self._since_minutes = 0.0

    def add(self, now_minutes: float, value: float, baseline_mean: float) -> None:
        self._points.append((now_minutes, value - baseline_mean))
        cutoff = now_minutes - self.window_minutes
        while self._points and self._points[0][0] < cutoff:
            self._points.popleft()

    def _sustained_span(self) -> float:
        """Minutes the delta has continuously stayed past the exit threshold.

        We walk backwards from the newest sample. The moment we hit a reading
        back inside the exit threshold (or a change of direction) we stop. The
        span is how long the recent run has lasted.
        """
        if not self._points:
            return 0.0
        recent = list(self._points)[::-1]  # newest first
        newest_ts = recent[0][0]
        span_start = recent[0][0]
        sign_reference = 0.0
        for ts, delta in recent:
            if abs(delta) <= self.exit_threshold:
                break
            if sign_reference == 0.0:
                sign_reference = 1.0 if delta > 0 else -1.0
            elif (delta > 0) != (sign_reference > 0):
                break  # changed direction -> the run ended
            span_start = ts
        return max(0.0, recent[0][0] - span_start)

    def evaluate(self, now_minutes: float) -> DriftState:
        points = list(self._points)
        if len(points) < 3:
            return _NO_DRIFT

        avg_delta = sum(y for _, y in points) / len(points)
        slope = _slope(points)
        trend = abs(slope) * self.window_minutes
        span = self._sustained_span()

        offset_trigger = abs(avg_delta) >= self.enter_threshold and span >= self.enter_minutes
        trend_trigger = trend >= self.enter_threshold

        if not self._active and (offset_trigger or trend_trigger):
            self._active = True
            self._since_minutes = now_minutes - span if offset_trigger else now_minutes - self.window_minutes

        if self._active:
            # Hysteresis: only exit when BOTH the offset and the trend have faded.
            faded = abs(avg_delta) < self.exit_threshold and trend < self.exit_threshold
            if faded:
                self._active = False
                return _NO_DRIFT
            magnitude = max(abs(avg_delta), trend)
            level = (
                "significant"
                if magnitude >= self.enter_threshold * self.significant_multiplier
                else "mild"
            )
            minutes = max(1.0, now_minutes - self._since_minutes)
            return DriftState(level=level, feature=self.feature, minutes=minutes)

        return _NO_DRIFT
