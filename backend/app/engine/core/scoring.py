"""Turn live readings + baseline into per-factor 0-100 scores.

* Posture: mainly forward lean. If the user is leaning forward relative to
  their personal baseline we knock points off (a z-score penalty, clipped).
* Screen: moving too close (large distance_proxy deviation) hurts.
* Lighting: comfort band (lux_comfort_min/max). Too dark or too bright loses
  points. If there is no lux reading (ESP32 absent, mock covers it) we use
  a neutral 100 but the UI still shows the device status.
* Movement: very little movement is tiring (micro-breaks good); we give a small
  nudge down if "too still" for a while. We don't punish fidgets.
"""
from __future__ import annotations

from .baseline import FeatureStat


def score_posture(live_neck_angle: float, stat: FeatureStat | None, penalty: float) -> float:
    if stat is None:
        return 100.0
    z = stat.z(live_neck_angle)
    lost = max(0.0, z) * penalty  # only leaning forward hurts, looking up is a bit odd
    # Also allow small symmetric nudges? M3 says "forward lean" -> penalise positive
    return max(0.0, 100.0 - lost)


def score_screen(distance_proxy: float, stat: FeatureStat | None, penalty: float) -> float:
    if stat is None:
        return 100.0
    # larger distance_proxy often means closer to screen (depends on calibration)
    z = stat.z(distance_proxy)
    lost = max(0.0, z) * penalty
    return max(0.0, 100.0 - lost)


def score_lighting(lux: float | None, comfort_min: float, comfort_max: float) -> float:
    if lux is None:
        return 100.0
    if lux < comfort_min:
        return max(0.0, 100.0 * lux / comfort_min)
    if lux > comfort_max:
        diff = lux - comfort_max
        span = max(100.0, comfort_max)
        drop = min(40.0, diff / span * 60.0)
        return 100.0 - drop
    return 100.0


def score_movement(movement: float | None, min_m: float) -> float:
    if movement is None:
        return 100.0
    if movement < min_m:
        return 80.0  # "too still" takes a small bite
    return 100.0
