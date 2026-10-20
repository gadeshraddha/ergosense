"""Alerts: the timeline of what the system said/did, plus voice controls."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..engine.runtime import manager
from ..models import Event, User
from ..schemas import EventOut, MuteRequest
from ..security import get_current_user

router = APIRouter(prefix="/api/alerts", tags=["alerts"])


@router.get("", response_model=list[EventOut])
def list_alerts(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[EventOut]:
    rows = (
        db.query(Event)
        .filter(Event.user_id == user.id)
        .order_by(Event.ts.desc())
        .limit(100)
        .all()
    )
    return list(rows)


@router.post("/test-voice")
def test_voice(user: User = Depends(get_current_user)) -> dict:
    rt = manager.ensure(user.id)
    rt.voice.retry()  # re-attempt TTS if a previous init hiccuped
    spoke = rt.voice.speak(
        "This is ErgoSense. Voice feedback is working.", force=True
    )
    return {
        "ok": True,
        "spoken": spoke,
        "supported": rt.voice.supported,
        "status": rt.voice.status(),
    }


@router.post("/mute")
def mute(
    body: MuteRequest,
    user: User = Depends(get_current_user),
) -> dict:
    rt = manager.ensure(user.id)
    rt.voice.mute(body.minutes)
    return {"ok": True, "muted_minutes": body.minutes, "status": rt.voice.status()}


@router.post("/unmute")
def unmute(user: User = Depends(get_current_user)) -> dict:
    rt = manager.ensure(user.id)
    rt.voice.unmute()
    return {"ok": True, "status": rt.voice.status()}
