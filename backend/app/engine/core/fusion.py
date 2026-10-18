"""Fusion of the four factor scores, interaction rules, smoothing."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class FactorScores:
    posture: float
    screen: float
    lighting: float
    movement: float

    def weighted_sum(self, weights: dict[str, float]) -> float:
        return (
            self.posture * weights["posture"]
            + self.screen * weights["screen"]
            + self.lighting * weights["lighting"]
            + self.movement * weights["movement"]
        )


def smooth_score(current: float, target: float, tau: float) -> float:
    """Exponential smoothing towards a new target. tau in seconds."""
    if tau <= 0:
        return target
    alpha = 1 - 0.5 ** (1 / tau) if tau >= 1 else 0.9
    return current * (1 - alpha) + target * alpha


def clamp(v: float, low: float = 0.0, high: float = 100.0) -> float:
    if v < low:
        return low
    if v > high:
        return high
    return v
