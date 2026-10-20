"""Posture deep-dive endpoints: current features vs your baseline + trend.

The numbers come from the live runtime when monitoring is on, and fall back to
the most recent stored sample otherwise, so the page always shows real data
(with a clear "not calibrated" state when there is no baseline yet).
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session as DbSession

from ..config import settings
from ..database import get_db
from ..engine.runtime import manager
from ..models import Baseline, Sample, User
from ..schemas import (
    DriftOut,
    PostureFeature,
    PostureSummary,
    PostureToday,
    PostureTrend,
    PostureTrendPoint,
)
from ..security import get_current_user
from .history import _baseline_stats, _bucket_rows, _merge, _resolve

router = APIRouter(prefix="/api/posture", tags=["posture"])

# key, display label, is "more = worse" for this feature
_FEATURES = (
    ("neck_angle", "Forward lean", True),
    ("head_forward", "Head forward", True),
    ("shoulder_tilt", "Shoulder tilt", True),
    ("distance_proxy", "Screen distance", True),
)

_MILD_Z = 1.0
_POOR_Z = 2.0


def _z(stats: dict, key: str, value: float | None) -> float | None:
    if value is None or key not in stats:
        return None
    return round(stats[key].z(value), 2)


def _status(z: float | None, higher_is_worse: bool) -> str:
    if z is None:
        return "unknown"
    if not higher_is_worse:
        z = abs(z)
    if z >= _POOR_Z:
        return "poor"
    if z >= _MILD_Z:
        return "attention"
    return "good"


def _last_features(db: DbSession, user_id: int) -> tuple[dict, str, float | None]:
    """Live features when monitoring, otherwise the newest stored sample."""
    snap = manager.ensure(user_id).snapshot()
    features = {k: v for k, v in (snap.get("features") or {}).items() if v is not None}
    if features:
        return features, "live", snap.get("score")

    row = (
        db.query(Sample)
        .filter(Sample.user_id == user_id)
        .order_by(Sample.ts.desc())
        .first()
    )
    stored = {
        "neck_angle": getattr(row, "neck_angle", None),
        "shoulder_tilt": getattr(row, "shoulder_tilt", None),
        "head_forward": getattr(row, "head_forward", None),
        "distance_proxy": getattr(row, "distance_proxy", None),
        "movement": getattr(row, "movement", None),
    } if row else {}
    stored = {k: v for k, v in stored.items() if v is not None}
    stored_score = float(row.score) if (row is not None and row.score is not None) else None

    if snap.get("monitoring"):
        # monitoring but no usable frame yet: report the live score, no features
        return {}, "live", snap.get("score")
    if not stored:
        return {}, "none", None
    return stored, "stored", stored_score


def _today_breakdown(db: DbSession, user_id: int, stats: dict) -> PostureToday:
    start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    if "neck_angle" not in stats:
        return PostureToday()
    rows = (
        db.query(Sample.neck_angle)
        .filter(Sample.user_id == user_id, Sample.ts >= start, Sample.neck_angle.isnot(None))
        .all()
    )
    if not rows:
        return PostureToday()
    stat = stats["neck_angle"]
    good = mild = poor = 0
    for (value,) in rows:
        z = stat.z(float(value))
        if z >= _POOR_Z:
            poor += 1
        elif z >= _MILD_Z:
            mild += 1
        else:
            good += 1
    total = len(rows)
    return PostureToday(
        good_pct=round(100.0 * good / total, 1),
        mild_pct=round(100.0 * mild / total, 1),
        poor_pct=round(100.0 * poor / total, 1),
        n=total,
    )


def _tip(drift: dict, worst_key: str | None, worst_status: str, lux: float | None, session: dict) -> str:
    if drift.get("level") in ("mild", "significant"):
        feature = drift.get("feature") or "neck_angle"
        tips = {
            "neck_angle": "Your lean has built up gradually. Push your chair back, use the "
            "lumbar support and keep your ears stacked over your shoulders.",
            "head_forward": "Your head is drifting forward. Drop the top of your screen to eye "
            "level so you do not reach for it.",
            "shoulder_tilt": "One shoulder is higher than the other — square up your keyboard "
            "and relax both arms.",
        }
        return tips.get(feature, "Ease back into a neutral position and reset your posture.")

    if worst_status in ("attention", "poor") and worst_key:
        tips = {
            "neck_angle": "You are leaning forward. Sit back, and if the screen feels far away, "
            "bring it closer instead of bending toward it.",
            "head_forward": "Your head is out in front of your chest. Tuck your chin and re-read "
            "the next line from a supported, upright position.",
            "shoulder_tilt": "Your shoulders are uneven. Check that both feet are flat and your "
            "elbows rest at the same height.",
            "distance_proxy": "You are closer to the screen than usual — nudge the laptop back "
            "about an arm's length.",
        }
        return tips[worst_key]

    if lux is not None and lux < settings.low_light_lux:
        return "Ambient light is below your comfort range. Brighten the room before you keep going."

    since_break = float((session or {}).get("since_break_minutes", 0.0) or 0.0)
    if since_break >= settings.long_session_minutes:
        return "You have been working for a while without a break — stand up for a couple of minutes."

    return "Everything is inside your personal comfort band right now. Keep the same chair and screen height."


@router.get("/summary", response_model=PostureSummary)
def posture_summary(
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> PostureSummary:
    snap = manager.ensure(user.id).snapshot()
    stats = _baseline_stats(db, user.id)
    features, source, score = _last_features(db, user.id)
    calibrated = bool(stats) and bool(
        db.query(Baseline)
        .filter(Baseline.user_id == user.id, Baseline.is_active)
        .first()
    )

    out: list[PostureFeature] = []
    worst_key, worst_status = None, "good"
    rank = {"good": 0, "unknown": 0, "attention": 1, "poor": 2}
    for key, label, higher_worse in _FEATURES:
        current = features.get(key)
        stat = stats.get(key)
        z = _z(stats, key, current)
        status = _status(z, higher_worse)
        if rank[status] > rank[worst_status]:
            worst_key, worst_status = key, status
        out.append(
            PostureFeature(
                key=key,
                label=label,
                current=round(float(current), 4) if current is not None else None,
                baseline=round(stat.mean, 4) if stat else None,
                std=round(stat.std, 4) if stat else None,
                z=z,
                status=status,
                higher_is_worse=higher_worse,
            )
        )

    return PostureSummary(
        calibrated=calibrated,
        present=bool(features),
        score=round(float(score), 1) if score is not None else None,
        source=source,
        drift=DriftOut(**snap.get("drift", {"level": "none", "feature": "", "minutes": 0.0})),
        features=out,
        today=_today_breakdown(db, user.id, stats),
        tip=_tip(
            snap.get("drift"),
            worst_key,
            worst_status,
            snap.get("lux"),
            snap.get("session"),
        ),
    )


@router.get("/trend", response_model=PostureTrend)
def posture_trend(
    range: str = Query(default="1h"),
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> PostureTrend:
    rng, frm, to, fmt = _resolve(range)
    stats = _baseline_stats(db, user.id)
    neck_stat = stats.get("neck_angle")
    dist_stat = stats.get("distance_proxy")

    points: list[PostureTrendPoint] = []
    for ts, v in _merge(_bucket_rows(db, user.id, frm, to, fmt)):
        _score, neck, tilt, _head, dist, _lux, _mov, n = v
        points.append(
            PostureTrendPoint(
                ts=ts,
                neck_angle=round(neck, 4) if neck is not None else None,
                shoulder_tilt=round(tilt, 4) if tilt is not None else None,
                distance_proxy=round(dist, 4) if dist is not None else None,
                z_neck=round(neck_stat.z(neck), 3) if (neck is not None and neck_stat) else None,
                z_distance=round(dist_stat.z(dist), 3) if (dist is not None and dist_stat) else None,
                n=int(n or 0),
            )
        )

    total_minutes = max(1.0, (to - frm).total_seconds() / 60.0)
    return PostureTrend(
        range=rng,
        bucket_minutes=round(total_minutes / max(1, len(points)), 2),
        mild_z=_MILD_Z,
        enter_z=_POOR_Z,
        points=points,
    )
