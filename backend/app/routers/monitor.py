"""Monitor/runtime endpoints: live snapshot, start/stop, mock controls, events.

The actual loop lives in ``engine.runtime``; these endpoints are thin wrappers
that read the per-user runtime's snapshot or change its control state.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..engine.runtime import manager
from ..models import Event, User
from ..schemas import EventOut, LiveSnapshot, MockRequest, ModeRequest
from ..security import get_current_user

router = APIRouter(prefix="/api/monitor", tags=["monitor"])


@router.get("/live", response_model=LiveSnapshot)
def live(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> LiveSnapshot:
    rt = manager.ensure(user.id)
    return LiveSnapshot(**rt.snapshot())


@router.post("/start")
def start(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    rt = manager.ensure(user.id)
    rt.start()
    rt.welcome()
    return {"ok": True, "monitoring": True}


@router.post("/stop")
def stop(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    rt = manager.ensure(user.id)
    rt.stop()
    return {"ok": True, "monitoring": False}


@router.post("/feed")
def feed(
    payload: dict,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Ingest a posture frame from the browser (real-mode webcam source)."""
    rt = manager.ensure(user.id)
    features = {
        k: payload.get(k)
        for k in ("neck_angle", "shoulder_tilt", "head_forward", "distance_proxy", "movement")
        if payload.get(k) is not None
    }
    lux = payload.get("lux")
    try:
        lux = float(lux) if lux is not None else None
    except (TypeError, ValueError):
        lux = None
    rt.feed(features, lux)
    return {"ok": True}


@router.post("/mock")
def mock_controls(
    body: MockRequest,
    user: User = Depends(get_current_user),
) -> dict:
    rt = manager.ensure(user.id)
    rt.set_mock(lux=body.lux, drift=body.drift)
    return {"ok": True, "lux": body.lux, "drift": body.drift}


@router.post("/mode")
def set_mode(
    body: ModeRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Switch the sensor source: "mock" (simulated) or "real" (webcam + ESP32)."""
    rt = manager.ensure(user.id)
    if rt.set_mode(body.mode):
        db.add(
            Event(
                user_id=user.id,
                type="mode",
                severity="info",
                message=f"Sensor mode switched to {body.mode}",
            )
        )
        db.commit()
    return {"ok": True, "mode": rt.snapshot()["mode"]}


@router.get("/events", response_model=list[EventOut])
def events(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[EventOut]:
    ev = db.query(Event).filter(Event.user_id == user.id).order_by(Event.ts.desc()).limit(50).all()
    return list(ev)
