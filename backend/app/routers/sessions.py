"""Work sessions endpoints."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import User, WorkSession
from ..schemas import SessionOut
from ..security import get_current_user

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


@router.get("/", response_model=list[SessionOut])
def list_sessions(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[SessionOut]:
    sessions = db.query(WorkSession).filter(WorkSession.user_id == user.id).order_by(WorkSession.start.desc()).limit(100).all()
    return list(sessions)


@router.get("/current")
def current(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    ws = db.query(WorkSession).filter(WorkSession.user_id == user.id, WorkSession.end.is_(None)).order_by(WorkSession.id.desc()).first()
    if not ws:
        return {"present": False}
    now = utcnow()
    return {
        "present": True,
        "start": ws.start,
        "minutes": round((now - ws.start).total_seconds() / 60.0, 1),
        "break_count": ws.break_count,
    }


@router.post("/break")
def break_taken(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    ws = db.query(WorkSession).filter(WorkSession.user_id == user.id, WorkSession.end.is_(None)).order_by(WorkSession.id.desc()).first()
    if ws:
        ws.break_count = ws.break_count + 1
        db.commit()
    return {"ok": True}
