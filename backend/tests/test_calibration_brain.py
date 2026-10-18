"""Unit tests for M3: baseline, drift, hysteresis."""
from __future__ import annotations

from app.engine.core import baseline, drift, fusion, scoring, explain


def test_flat_samples_no_drift_trigger():
    samples = [{"neck_angle": 0.1, "shoulder_tilt": 0.0, "head_forward": 0.0, "distance_proxy": 0.25, "movement": 0.02} for _ in range(40)]
    res = baseline.compute_baseline(samples, min_samples=30, max_movement_std=0.08)
    assert res.ok
    assert "neck_angle" in res.stats


def test_drift_detection_ramp_flags():
    det = drift.DriftDetector(
        feature="neck_angle",
        window_minutes=10.0,
        enter_threshold=0.05,
        exit_threshold=0.02,
        enter_minutes=1.0,
        significant_multiplier=2.0,
    )
    base = 0.0
    for i in range(10):
        det.add(i * 0.5, base + i * 0.02, base)
    state = det.evaluate(5.0)
    assert state.level in ("mild", "significant")


def test_drift_hysteresis_exit():
    det = drift.DriftDetector(
        feature="neck_angle",
        window_minutes=5.0,
        enter_threshold=0.05,
        exit_threshold=0.02,
        enter_minutes=0.5,
        significant_multiplier=2.0,
    )
    base = 0.0
    for i in range(10):
        det.add(i * 0.3, base + i * 0.03, base)
    state = det.evaluate(3.0)
    assert state.level != "none"
    for i in range(10):
        det.add(3.0 + i * 0.3, base + (10 - i) * 0.01, base)
    state = det.evaluate(6.0)
    assert state.level == "none"


def test_fusion_weights_sum():
    f = fusion.FactorScores(posture=80, screen=90, lighting=85, movement=95)
    s = f.weighted_sum({"posture": 0.35, "screen": 0.25, "lighting": 0.20, "movement": 0.20})
    assert 80 <= s <= 95


def test_lighting_neutral():
    assert scoring.score_lighting(None, 300, 1000) == 100.0
    assert scoring.score_lighting(500, 300, 1000) == 100.0


def test_explain_does_not_crash():
    msg = explain.explain_change(
        score_now=70,
        score_prev=85,
        factors_now={"posture": 70, "screen": 90, "lighting": 95, "movement": 95},
        factors_recent_avg={"posture": 90, "screen": 90, "lighting": 95, "movement": 95},
        drift={"level": "mild", "feature": "forward lean", "minutes": 5},
        baseline_present=True,
    )
    assert isinstance(msg, str)
