"""Personal baseline: learn what a user's *normal* posture looks like.

A baseline is a set of per-feature statistics computed from valid samples
collected during calibration. We compute both classic mean/std (used later to
turn a live reading into a z-score) and robust median/MAD (used to judge how
noisy the calibration was and to reject outliers).

This module is pure maths: no database, no FastAPI. That makes it easy to test
with synthetic data.
"""
from __future__ import annotations

import statistics
from dataclasses import dataclass, field

# The posture features the brain understands. The webcam engine sends these.
FEATURES: tuple[str, ...] = (
    "neck_angle",
    "shoulder_tilt",
    "head_forward",
    "distance_proxy",
    "movement",
)


@dataclass
class FeatureStat:
    """Summary of one feature across the calibration samples."""

    mean: float
    std: float
    median: float
    mad: float  # median absolute deviation
    n: int

    def z(self, value: float) -> float:
        """How far a live value is from the baseline, in standard deviations."""
        if self.std <= 1e-9:
            return 0.0
        return (value - self.mean) / self.std


@dataclass
class BaselineResult:
    """Outcome of trying to build a baseline from a batch of samples."""

    ok: bool
    reason: str = ""
    stats: dict[str, FeatureStat] = field(default_factory=dict)
    valid_samples: int = 0
    quality: float = 0.0  # 0..1, how clean the calibration was

    def to_json(self) -> dict:
        return {
            "stats": {
                name: {
                    "mean": round(s.mean, 5),
                    "std": round(s.std, 5),
                    "median": round(s.median, 5),
                    "mad": round(s.mad, 5),
                    "n": s.n,
                }
                for name, s in self.stats.items()
            },
            "valid_samples": self.valid_samples,
            "quality": round(self.quality, 3),
        }


def _stat(values: list[float], *, std_floor: float = 0.0) -> FeatureStat:
    mean = statistics.fmean(values)
    std = statistics.pstdev(values) if len(values) > 1 else 0.0
    # Never let a very calm calibration produce an implausibly tiny spread:
    # without a floor, a 0.01 shift would read as several sigma and turn red.
    if std_floor > 0.0:
        std = max(std, std_floor)
    median = statistics.median(values)
    mad = statistics.median([abs(v - median) for v in values]) if values else 0.0
    return FeatureStat(mean=mean, std=std, median=median, mad=mad, n=len(values))


def compute_baseline(
    samples: list[dict],
    *,
    min_samples: int,
    max_movement_std: float,
    std_floors: dict[str, float] | None = None,
) -> BaselineResult:
    """Build per-feature stats from `samples`, or explain why we cannot.

    `samples` is a list of dicts like ``{"neck_angle": 0.12, "movement": 0.03}``.
    Missing features are simply skipped. A calibration is rejected when there
    are too few usable samples or the user moved around too much.

    ``std_floors`` maps a feature name to the minimum std-dev to assume, so a
    calm calibration does not make later z-scores hyper-sensitive.
    """
    std_floors = std_floors or {}
    per_feature: dict[str, list[float]] = {name: [] for name in FEATURES}
    valid = 0

    for sample in samples:
        row_ok = False
        for name in FEATURES:
            value = sample.get(name)
            if value is None:
                continue
            per_feature[name].append(float(value))
            row_ok = True
        if row_ok:
            valid += 1

    if valid < min_samples:
        return BaselineResult(
            ok=False,
            reason=(
                f"Only {valid} valid samples collected, need at least {min_samples}. "
                "Make sure your face and shoulders stay in view."
            ),
            valid_samples=valid,
        )

    stats: dict[str, FeatureStat] = {}
    for name, values in per_feature.items():
        if len(values) >= 2:
            stats[name] = _stat(values, std_floor=std_floors.get(name, 0.0))

    required = ("neck_angle", "distance_proxy")
    missing = [name for name in required if name not in stats]
    if missing:
        return BaselineResult(
            ok=False,
            reason=(
                "Could not measure " + ", ".join(missing) + ". "
                "Please keep your head and both shoulders visible."
            ),
            valid_samples=valid,
        )

    movement_std = stats["movement"].std if "movement" in stats else 0.0
    if movement_std > max_movement_std:
        return BaselineResult(
            ok=False,
            reason=(
                "You moved around too much while calibrating. "
                "Sit still and relax your shoulders, then try again."
            ),
            stats=stats,
            valid_samples=valid,
        )

    # Quality: more samples and less movement => closer to 1.0.
    sample_quality = min(1.0, valid / (min_samples * 2))
    stillness = 1.0 - min(1.0, movement_std / max_movement_std if max_movement_std else 0.0)
    quality = round(0.5 * sample_quality + 0.5 * stillness, 3)

    return BaselineResult(ok=True, stats=stats, valid_samples=valid, quality=quality)


def stats_from_json(
    data: dict, *, std_floors: dict[str, float] | None = None
) -> dict[str, FeatureStat]:
    """Rehydrate FeatureStats that were stored in the Baseline.json_stats column.

    ``std_floors`` (if given) clamps each std up to a minimum, so baselines built
    before the floors existed are no longer hyper-sensitive.
    """
    std_floors = std_floors or {}
    stats: dict[str, FeatureStat] = {}
    for name, raw in (data.get("stats") or {}).items():
        std = float(raw["std"])
        floor = std_floors.get(name, 0.0)
        if floor > 0.0:
            std = max(std, floor)
        stats[name] = FeatureStat(
            mean=float(raw["mean"]),
            std=std,
            median=float(raw.get("median", raw["mean"])),
            mad=float(raw.get("mad", 0.0)),
            n=int(raw.get("n", 0)),
        )
    return stats


def ema_update(stat: FeatureStat, value: float, alpha: float) -> None:
    """Nudge a baseline feature towards a new value (used for gentle auto-update).

    Only called during high-score, no-alert periods so we never learn bad posture.
    """
    stat.mean = (1 - alpha) * stat.mean + alpha * value
    stat.median = stat.mean
