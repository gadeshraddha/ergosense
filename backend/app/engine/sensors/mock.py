"""Synthetic sensor generator for mock mode (no hardware, no webcam).

Produces the same feature shape the webcam engine would emit, plus a mock lux
value. A "simulate drift" switch slowly worsens the neck angle so demos are
reproducible. This is the only place fake-but-labelled sensor data is created;
it is clearly surfaced as ``mode: "mock"`` in the live snapshot.
"""
from __future__ import annotations

import math
import random
import time
from dataclasses import dataclass, field


@dataclass
class MockSensors:
    lux: float = 420.0
    simulate_drift: bool = False
    drift_rate: float = 0.02  # neck_angle units per minute
    seed: int | None = None

    _rng: random.Random = field(init=False, repr=False)
    _start: float = field(init=False, repr=False)

    def __post_init__(self) -> None:
        self._rng = random.Random(self.seed)
        self._start = time.monotonic()

    def set_lux(self, lux: float) -> None:
        self.lux = float(lux)

    def set_drift(self, on: bool) -> None:
        self.simulate_drift = bool(on)
        if not on:
            self._start = time.monotonic()

    def elapsed_minutes(self) -> float:
        return (time.monotonic() - self._start) / 60.0

    def read(self) -> tuple[dict, float]:
        """Return ``({features}, lux)``.

        Features mimic a person sitting mostly upright with small natural noise.
        Under drift simulation the neck angle grows smoothly over time so the
        drift detector can be demonstrated on demand.
        """
        t = self.elapsed_minutes()
        noise = lambda s: self._rng.gauss(0.0, s)  # noqa: E731

        drift = self.drift_rate * t if self.simulate_drift else 0.0
        neck = 0.10 + drift + noise(0.01)
        tilt = abs(0.02 + noise(0.01))
        head = 0.12 + drift * 0.5 + noise(0.01)
        # 0.25 is the mock "good" distance; a little sine gives gentle life.
        dist = 0.25 + 0.03 * math.sin(t / 3.0) + noise(0.01)
        # Occasional small fidget, otherwise "too still" is not triggered.
        movement = max(0.0, 0.05 + noise(0.02))

        features = {
            "neck_angle": round(neck, 4),
            "shoulder_tilt": round(tilt, 4),
            "head_forward": round(head, 4),
            "distance_proxy": round(dist, 4),
            "movement": round(movement, 4),
        }
        return features, self.lux
