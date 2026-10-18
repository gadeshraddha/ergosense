"""Monitor/runtime endpoints (live snapshot, events)."""
from __future__ import annotations

from collections import deque
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..engine.core import drift as dcore
from ..engine.core import explain as exp
from ..engine.core import fusion as fcore
from ..engine.core import scoring as score
from ..models import Baseline, Event, Sample, User
from ..schemas import DriftOut, EventOut, FactorScoresOut, LiveSnapshot
from ..security import get_current_user

router = APIRouter(prefix="/api/monitor", tags=["monitor"])
state: dict[int, "MonitorState"] = {}


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class MonitorState:
    def __init__(self, user_id: int) -> None:
        self.user_id = user_id
        self.monitoring = False
        self.mode = "mock"
        self.calibrated = False
        self.present = False
        self.features: dict = {}
        self.lux: float | None = None
        self.factors = FactorScoresOut(posture=100, screen=100, lighting=100, movement=100)
        self.score = 100.0
        self.drift = DriftOut(level="none", feature="", minutes=0.0)
        self.insight = "Start monitoring to see your live Ergo Score."
        self.session: dict = {"minutes": 0, "since_break_minutes": 0, "state": "active"}
        self.devices: dict = {"camera": "ok", "esp32": "mock", "brightness": "ok", "voice": "ok"}
        self.score_history: deque[float] = deque(maxlen=600)
        self.factor_recent: dict[str, deque[float]] = {
            "posture": deque(maxlen=300),
            "screen": deque(maxlen=300),
            "lighting": deque(maxlen=300),
            "movement": deque(maxlen=300),
        }
        self._last_ts: datetime = utcnow()
        self._started_at: datetime | None = None
        self._last_active: datetime = utcnow()
        self._det = dcore.DriftDetector(
            feature="neck_angle",
            window_minutes=settings.drift_demo_window_minutes
            if settings.mock
            else settings.drift_window_minutes,
            enter_threshold=settings.drift_enter_threshold,
            exit_threshold=settings.drift_exit_threshold,
            enter_minutes=settings.drift_enter_minutes,
            significant_multiplier=settings.drift_significant_multiplier,
        )
        self._last_written = utcnow() - timedelta(seconds=settings.sample_write_seconds + 1)


def _avg(d: deque[float]) -> float:
    if not d:
        return 100.0
    return sum(d) / len(d)


def _get_baseline(db: Session, user_id: int):
    base = (
        db.query(Baseline)
        .filter(Baseline.user_id == user_id, Baseline.is_active)
        .order_by(Baseline.id.desc())
        .first()
    )
    if not base:
        return None, {}
    from ..engine.core.baseline import stats_from_json

    return base, stats_from_json(base.json_stats)


@router.get("/live", response_model=LiveSnapshot)
def live(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> LiveSnapshot:
    st = state.get(user.id)
    if not st:
        st = MonitorState(user.id)
        st.mode = "mock" if settings.mock else "real"
        base, _ = _get_baseline(db, user.id)
        st.calibrated = base is not None
        st.present = base is not None
        state[user.id] = st
    base, stats = _get_baseline(db, user.id)
    st.calibrated = base is not None
    st.present = base is not None
    now = utcnow()
    if st.monitoring and st._started_at is not None:
        st.session["minutes"] = round((now - st._started_at).total_seconds() / 60.0, 1)
        st.session["since_break_minutes"] = round((now - st._last_active).total_seconds() / 60.0, 1)
        if (now - st._last_active) >= timedelta(minutes=settings.break_minutes):
            st.session["state"] = "break"
        else:
            st.session["state"] = "active"
    return LiveSnapshot(
        ts=now,
        monitoring=st.monitoring,
        mode=st.mode,
        calibrated=st.calibrated,
        present=st.present,
        features=st.features,
        lux=st.lux,
        factors=st.factors,
        score=round(st.score, 1),
        drift=st.drift,
        insight=st.insight,
        session=st.session,
        devices=st.devices,
    )


@router.post("/start")
def start(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    st = state.get(user.id)
    if not st:
        st = MonitorState(user.id)
        state[user.id] = st
    now = utcnow()
    if not st.monitoring:
        st.monitoring = True
        st._started_at = now
        st._last_active = now
        st._det.reset()
        # ensure session record
        ws = WorkSession(user_id=user.id, start=now)
        db.add(ws)
        db.commit()
    return {"ok": True}


@router.post("/stop")
def stop(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    st = state.get(user.id)
    if not st:
        return {"ok": True}
    if st.monitoring and st._started_at is not None:
        ws = db.query(WorkSession).filter(WorkSession.user_id == user.id, WorkSession.end.is_(None)).order_by(WorkSession.id.desc()).first()
        if ws:
            ws.end = utcnow()
            db.commit()
    st.monitoring = False
    return {"ok": True}


@router.post("/feed")
def feed(
    payload: dict,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    st = state.get(user.id)
    if not st:
        st = MonitorState(user.id)
        state[user.id] = st
    now = utcnow()
    base, stats = _get_baseline(db, user.id)
    st.calibrated = base is not None
    st.present = base is not None

    neck = float(payload.get("neck_angle", 0.0)) if payload.get("neck_angle") is not None else 0.0
    shoulder = float(payload.get("shoulder_tilt", 0.0)) if payload.get("shoulder_tilt") is not None else 0.0
    head = float(payload.get("head_forward", 0.0)) if payload.get("head_forward") is not None else 0.0
    dist = float(payload.get("distance_proxy", 0.0)) if payload.get("distance_proxy") is not None else 0.0
    mov = float(payload.get("movement", 0.0)) if payload.get("movement") is not None else 0.0
    lux = payload.get("lux")
    if lux is not None:
        try:
            lux = float(lux)
        except Exception:
            lux = None

    st.features = {
        "neck_angle": neck,
        "shoulder_tilt": shoulder,
        "head_forward": head,
        "distance_proxy": dist,
        "movement": mov,
    }
    st.lux = lux
    st._last_active = now

    ps = score.score_posture(neck, stats.get("neck_angle") if stats else None, settings.posture_z_penalty)
    ss = score.score_screen(dist, stats.get("distance_proxy") if stats else None, settings.screen_z_penalty)
    ls = score.score_lighting(lux, settings.lux_comfort_min, settings.lux_comfort_max)
    ms = score.score_movement(mov, settings.movement_min)

    factors = fcore.FactorScores(posture=ps, screen=ss, lighting=ls, movement=ms)
    weights = {
        "posture": settings.weight_posture,
        "screen": settings.weight_screen,
        "lighting": settings.weight_lighting,
        "movement": settings.weight_movement,
    }
    raw = factors.weighted_sum(weights)
    # interaction penalty
    if neck > (stats.get("neck_angle").mean + 2 * stats.get("neck_angle").std if stats.get("neck_angle") else neck) and dist > (stats.get("distance_proxy").mean + 1 * stats.get("distance_proxy").std if stats.get("distance_proxy") else dist):
        if (now - (st._started_at or now)).total_seconds() / 60.0 > 10:
            raw = max(0.0, raw - settings.interaction_penalty)
    target = fcore.clamp(raw)
    st.score = fcore.smooth_score(st.score, target, settings.score_smoothing_seconds)
    st.factors = FactorScoresOut(posture=round(ps, 1), screen=round(ss, 1), lighting=round(ls, 1), movement=round(ms, 1))
    st.score_history.append(st.score)
    for k, v in [("posture", ps), ("screen", ss), ("lighting", ls), ("movement", ms)]:
        st.factor_recent[k].append(v)

    # drift
    if st._started_at is not None:
        minutes = (now - st._started_at).total_seconds() / 60.0
        if "neck_angle" in stats:
            st._det.add(minutes, neck, stats["neck_angle"].mean)
        d = st._det.evaluate(minutes)
        st.drift = DriftOut(level=d.level, feature=d.feature, minutes=d.minutes)
        if d.level != "none" and st.drift.level == "none":
            # simple: write event on start
            pass
    st.insight = exp.explain_change(
        score_now=st.score,
        score_prev=_avg(st.score_history[:-1] or deque([st.score])),
        factors_now={"posture": ps, "screen": ss, "lighting": ls, "movement": ms},
        factors_recent_avg={k: _avg(v) for k, v in st.factor_recent.items()},
        drift=st.drift.model_dump(),
        baseline_present=st.present,
    )

    if (now - st._last_written).total_seconds() >= settings.sample_write_seconds:
        db.add(
            Sample(
                user_id=user.id,
                ts=now,
                neck_angle=neck,
                shoulder_tilt=shoulder,
                head_forward=head,
                distance_proxy=dist,
                movement=mov,
                lux=lux,
                score=float(st.score),
            )
        )
        db.commit()
        st._last_written = now

    return {"ok": True}


@router.get("/events", response_model=list[EventOut])
def events(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[EventOut]:
    ev = db.query(Event).filter(Event.user_id == user.id).order_by(Event.ts.desc()).limit(50).all()
    return list(ev)
