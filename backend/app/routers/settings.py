"""User settings: voice, brightness mode, sensitivity-related tunables."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..engine.runtime import manager
from ..models import User
from ..prefs import set_setting
from ..schemas import SettingsOut, SettingsUpdate
from ..security import get_current_user

router = APIRouter(prefix="/api/settings", tags=["settings"])


def _build(rt) -> SettingsOut:
    return SettingsOut(
        voice_enabled=bool(rt.prefs.get("voice_enabled", True)),
        brightness_mode=rt.prefs.get("brightness_mode", "auto"),
        manual_brightness=rt.prefs.get("manual_brightness"),
        low_light_lux=settings.low_light_lux,
        long_session_minutes=settings.long_session_minutes,
        voice_supported=rt.voice.supported,
        voice_status=rt.voice.status(),
        brightness_supported=rt.brightness.supported,
    )


@router.get("", response_model=SettingsOut)
def get_settings(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SettingsOut:
    rt = manager.ensure(user.id)
    return _build(rt)


@router.put("", response_model=SettingsOut)
def update_settings(
    body: SettingsUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SettingsOut:
    rt = manager.ensure(user.id)
    if body.voice_enabled is not None:
        rt.prefs["voice_enabled"] = body.voice_enabled
        rt.voice.set_enabled(body.voice_enabled)
        set_setting(db, user.id, "voice_enabled", body.voice_enabled)
    if body.brightness_mode is not None:
        rt.prefs["brightness_mode"] = body.brightness_mode
        set_setting(db, user.id, "brightness_mode", body.brightness_mode)
    if body.manual_brightness is not None:
        rt.prefs["manual_brightness"] = body.manual_brightness
        set_setting(db, user.id, "manual_brightness", body.manual_brightness)
    return _build(rt)
