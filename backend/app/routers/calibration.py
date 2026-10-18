"""Calibration + brain (monitor/runtime) endpoints."""
from __future__ import annotations

from collections import deque
from datetime import datetime, timedelta, timezone
from threading import Lock

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..engine.core import baseline as bcore
from ..engine.core import drift as dcore
from ..engine.core import explain as exp
from ..engine.core import fusion as fcore
from ..engine.core import scoring as score
from ..engine.core import session as sess
from ..engine.core.baseline import compute_baseline, stats_from_json
from ..models import Baseline, Event, Sample, User, WorkSession
from ..schemas import (
    BaselineOut,
    CalibrationCancelResponse,
    CalibrationStartRequest,
    CalibrationStartResponse,
    CalibrationStatus,
    DriftOut,
    EventOut,
    FactorScoresOut,
    LiveSnapshot,
)
from ..security import get_current_user

router = APIRouter(prefix="/api/calibration", tags=["calibration"])
state_lock = Lock()
cal_sessions: dict[int, "CalSession"] = {}

now = datetime.now(timezone.utc)


class CalSession:
    def __init__(self, user_id: int, demo: bool = False) -> None:
        self.user_id = user_id
        self.demo = demo
        self.duration_s = (
            settings.calibration_demo_duration_s if demo else settings.calibration_duration_s
        )
        self.started_at = datetime.now(timezone.utc)
        self.samples: list[dict] = []
        self.canceled = False
        self.result: bcore.BaselineResult | None = None
        self.completed = False

    def add(self, s: dict) -> None:
        if self.completed or self.canceled:
            return
        self.samples.append(s)

    def elapsed_s(self) -> float:
        return (datetime.now(timezone.utc) - self.started_at).total_seconds()

    def running(self) -> bool:
        if self.canceled or self.completed:
            return False
        return self.elapsed_s() < self.duration_s

    def progress_pct(self) -> float:
        e = min(self.elapsed_s(), self.duration_s)
        return round((e / self.duration_s * 100.0) if self.duration_s else 0.0, 1)


def _latest_active_baseline(db: Session, user_id: int) -> tuple[Baseline | None, dict[str, bcore.FeatureStat]]:
    base = (
        db.query(Baseline)
        .filter(Baseline.user_id == user_id, Baseline.is_active)
        .order_by(Baseline.id.desc())
        .first()
    )
    if not base:
        return None, {}
    return base, stats_from_json(base.json_stats)


@router.post("/start", response_model=CalibrationStartResponse)
def start_cal(
    body: CalibrationStartRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CalibrationStartResponse:
    with state_lock:
        if user.id in cal_sessions and cal_sessions[user.id].running():
            raise HTTPException(status.HTTP_409_CONFLICT, "Calibration already in progress")
        cs = CalSession(user.id, demo=bool(body.demo))
        cal_sessions[user.id] = cs
    return CalibrationStartResponse(
        ok=True,
        status_url=f"/api/calibration/status",
        duration_s=cs.duration_s,
    )


@router.get("/status", response_model=CalibrationStatus)
def status_cal(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CalibrationStatus:
    with state_lock:
        cs = cal_sessions.get(user.id)
    if not cs:
        return CalibrationStatus(
            running=False,
            elapsed_s=0.0,
            duration_s=settings.calibration_duration_s,
            progress_pct=0.0,
            valid_samples=0,
            quality=0.0,
            reason=None,
            completed=False,
            baseline_ok=False,
            message="No calibration in progress.",
        )
    if cs.canceled:
        return CalibrationStatus(
            running=False,
            elapsed_s=cs.elapsed_s(),
            duration_s=cs.duration_s,
            progress_pct=cs.progress_pct(),
            valid_samples=len(cs.samples),
            quality=0.0,
            reason="Calibration cancelled.",
            completed=True,
            baseline_ok=False,
        )
    if cs.running():
        return CalibrationStatus(
            running=True,
            elapsed_s=round(cs.elapsed_s(), 1),
            duration_s=cs.duration_s,
            progress_pct=cs.progress_pct(),
            valid_samples=len(cs.samples),
            quality=0.0,
            reason=None,
            completed=False,
            baseline_ok=False,
        )
    # completed
    if cs.result is None:
        res = compute_baseline(
            cs.samples,
            min_samples=settings.calibration_min_samples,
            max_movement_std=settings.calibration_max_movement_std,
        )
        cs.result = res
        if res.ok:
            # deactivate old baselines, save new active one
            for old in db.query(Baseline).filter(Baseline.user_id == user.id).all():
                old.is_active = False
            db.add(
                Baseline(
                    user_id=user.id,
                    json_stats=res.to_json(),
                    is_active=True,
                )
            )
            db.commit()
    res = cs.result
    return CalibrationStatus(
        running=False,
        elapsed_s=round(cs.elapsed_s(), 1),
        duration_s=cs.duration_s,
        progress_pct=100.0,
        valid_samples=res.valid_samples,
        quality=res.quality,
        reason=res.reason or None,
        completed=True,
        baseline_ok=res.ok,
        message="Calibration complete." if res.ok else "Calibration failed.",
    )


@router.post("/cancel", response_model=CalibrationCancelResponse)
def cancel_cal(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CalibrationCancelResponse:
    with state_lock:
        cs = cal_sessions.get(user.id)
        if cs and cs.running():
            cs.canceled = True
    return CalibrationCancelResponse(ok=True)


@router.get("/baseline", response_model=BaselineOut)
def get_baseline(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> BaselineOut:
    base, stats = _latest_active_baseline(db, user.id)
    if not base:
        return BaselineOut(present=False)
    return BaselineOut(
        present=True,
        stats={name: BaselineStats(**v.to_json()) if False else BaselineStats(**{k: float(getattr(v, k)) for k in ["mean", "std", "median", "mad", "n"]}) for name, v in stats.items()},
        valid_samples=base.json_stats.get("valid_samples", 0),
        quality=float(base.json_stats.get("quality", 0.0)),
        created_at=base.created_at,
    )


@router.delete("/baseline")
def delete_baseline(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    for old in db.query(Baseline).filter(Baseline.user_id == user.id).all():
        db.delete(old)
    db.commit()
    return {"ok": True}
