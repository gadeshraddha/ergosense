"""Lighting endpoints: ambient light summary + auto/manual brightness control."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..engine.actuators.brightness import lux_to_target
from ..engine.runtime import manager
from ..models import User
from ..prefs import set_setting
from ..schemas import (
    LightingBrightnessRequest,
    LightingCurvePoint,
    LightingModeRequest,
    LightingSummary,
)
from ..security import get_current_user

router = APIRouter(prefix="/api/lighting", tags=["lighting"])


def _status(lux: float | None) -> str:
    if lux is None:
        return "unknown"
    if lux < settings.lux_comfort_min:
        return "too_dark"
    if lux > settings.lux_comfort_max:
        return "too_bright"
    return "comfortable"


@router.get("/summary", response_model=LightingSummary)
def summary(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> LightingSummary:
    rt = manager.ensure(user.id)
    snap = rt.snapshot()
    lux = snap["lux"]
    target = lux_to_target(
        lux,
        comfort_min=settings.lux_comfort_min,
        comfort_max=settings.lux_comfort_max,
        min_pct=settings.brightness_min_pct,
        max_pct=settings.brightness_max_pct,
        dark_factor=settings.brightness_dark_factor,
    )
    return LightingSummary(
        lux=lux,
        comfort_min=settings.lux_comfort_min,
        comfort_max=settings.lux_comfort_max,
        target_pct=target,
        current_pct=rt.brightness.current(),
        mode=rt.prefs.get("brightness_mode", "auto"),
        supported=rt.brightness.supported,
        status=_status(lux),
        device=snap["devices"].get("esp32", "off"),
        paused=rt.brightness.paused(),
    )


@router.get("/curve", response_model=list[LightingCurvePoint])
def curve(user: User = Depends(get_current_user)) -> list[LightingCurvePoint]:
    """The full lux -> brightness mapping, so the UI plots the real curve."""
    points: list[LightingCurvePoint] = []
    lux = 0
    while lux <= 2000:
        points.append(
            LightingCurvePoint(
                lux=float(lux),
                target_pct=lux_to_target(
                    float(lux),
                    comfort_min=settings.lux_comfort_min,
                    comfort_max=settings.lux_comfort_max,
                    min_pct=settings.brightness_min_pct,
                    max_pct=settings.brightness_max_pct,
                    dark_factor=settings.brightness_dark_factor,
                ),
            )
        )
        lux += 50
    return points


@router.post("/mode", response_model=LightingSummary)
def set_mode(
    body: LightingModeRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> LightingSummary:
    rt = manager.ensure(user.id)
    rt.prefs["brightness_mode"] = body.mode
    set_setting(db, user.id, "brightness_mode", body.mode)
    return summary(user=user, db=db)


@router.post("/brightness", response_model=LightingSummary)
def set_brightness(
    body: LightingBrightnessRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> LightingSummary:
    rt = manager.ensure(user.id)
    rt.prefs["brightness_mode"] = "manual"
    rt.prefs["manual_brightness"] = body.brightness
    set_setting(db, user.id, "brightness_mode", "manual")
    set_setting(db, user.id, "manual_brightness", body.brightness)
    rt.brightness.apply(body.brightness, manual=True)
    return summary(user=user, db=db)
