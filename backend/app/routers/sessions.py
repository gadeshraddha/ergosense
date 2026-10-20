"""Work sessions: live timer, breaks, per-day totals and past-session history."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session as DbSession

from ..config import settings
from ..database import get_db
from ..engine.runtime import manager
from ..models import Event, Sample, User, WorkSession
from ..schemas import SessionDay, SessionOut, SessionRow, SessionStats
from ..security import get_current_user

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _overlap_minutes(start: datetime, end: datetime, frm: datetime, to: datetime) -> float:
    s = max(_aware(start), frm)
    e = min(_aware(end), to)
    return max(0.0, (e - s).total_seconds() / 60.0)


def _windows(db: DbSession, user_id: int, frm: datetime, to: datetime) -> list[WorkSession]:
    return (
        db.query(WorkSession)
        .filter(
            WorkSession.user_id == user_id,
            WorkSession.start <= to,
            (WorkSession.end.is_(None)) | (WorkSession.end >= frm),
        )
        .order_by(WorkSession.start.asc())
        .all()
    )


@router.get("", response_model=list[SessionOut])
@router.get("/", response_model=list[SessionOut])
def list_sessions(
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> list[SessionOut]:
    sessions = (
        db.query(WorkSession)
        .filter(WorkSession.user_id == user.id)
        .order_by(WorkSession.start.desc())
        .limit(100)
        .all()
    )
    return list(sessions)


@router.get("/current")
def current(
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> dict:
    ws = (
        db.query(WorkSession)
        .filter(WorkSession.user_id == user.id, WorkSession.end.is_(None))
        .order_by(WorkSession.id.desc())
        .first()
    )
    if not ws:
        return {"present": False}
    now = utcnow()
    return {
        "present": True,
        "start": _aware(ws.start),
        "minutes": round((now - _aware(ws.start)).total_seconds() / 60.0, 1),
        "break_count": ws.break_count,
    }


@router.get("/stats", response_model=SessionStats)
def session_stats(
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> SessionStats:
    now = utcnow()
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week = (now - timedelta(days=7)).replace(hour=0, minute=0, second=0, microsecond=0)

    def totals(frm: datetime, to: datetime) -> tuple[float, int, int, float | None]:
        rows = _windows(db, user.id, frm, to)
        minutes = sum(_overlap_minutes(r.start, r.end or to, frm, to) for r in rows)
        breaks = sum(int(r.break_count or 0) for r in rows)
        started = [r for r in rows if _aware(r.start) >= frm]
        scores = [float(r.avg_score) for r in started if r.avg_score is not None]
        avg = round(sum(scores) / len(scores), 1) if scores else None
        return round(minutes, 1), breaks, len(started), avg

    today_minutes, today_breaks, today_sessions, today_avg = totals(today, now)
    week_minutes, week_breaks, _week_sessions, _week_avg = totals(week, now)

    # per-day work time + breaks for the last 7 days (zeros for days with no data)
    sessions = _windows(db, user.id, week, now)
    sessions_by_day: dict[str, list[WorkSession]] = {}
    for s in sessions:
        sessions_by_day.setdefault(_aware(s.start).date().isoformat(), []).append(s)

    score_by_day: dict[str, float] = dict(
        db.query(
            func.strftime("%Y-%m-%d", Sample.ts),
            func.avg(Sample.score),
        )
        .filter(Sample.user_id == user.id, Sample.ts >= week, Sample.score.isnot(None))
        .group_by(func.strftime("%Y-%m-%d", Sample.ts))
        .all()
    )
    # a day with no stored reading still has the sessions' own average score
    for day, rows in sessions_by_day.items():
        if day in score_by_day:
            continue
        scores = [float(r.avg_score) for r in rows if r.avg_score is not None]
        if scores:
            score_by_day[day] = sum(scores) / len(scores)

    by_day: list[SessionDay] = []
    for i in range(6, -1, -1):
        day = (now - timedelta(days=i)).date().isoformat()
        day_end = datetime.fromisoformat(day).replace(tzinfo=timezone.utc) + timedelta(days=1)
        rows = sessions_by_day.get(day, [])
        work = sum(_overlap_minutes(r.start, r.end or now, week, day_end) for r in rows)
        avg = score_by_day.get(day)
        by_day.append(
            SessionDay(
                day=day,
                work_minutes=round(work, 1),
                breaks=sum(int(r.break_count or 0) for r in rows),
                sessions=len(rows),
                avg_score=round(float(avg), 1) if avg is not None else None,
            )
        )

    past: list[SessionRow] = []
    for r in db.query(WorkSession).filter(WorkSession.user_id == user.id).order_by(
        WorkSession.start.desc()
    ).limit(20):
        end = r.end or now
        past.append(
            SessionRow(
                id=r.id,
                start=_aware(r.start),
                end=_aware(r.end) if r.end else None,
                minutes=round((_aware(end) - _aware(r.start)).total_seconds() / 60.0, 1),
                avg_score=round(float(r.avg_score), 1) if r.avg_score is not None else None,
                break_count=int(r.break_count or 0),
            )
        )

    # "next break in X minutes" — from the live session, only while monitoring
    next_break: float | None = None
    snap = manager.ensure(user.id).snapshot()
    if snap.get("monitoring"):
        since = float((snap.get("session") or {}).get("since_break_minutes", 0.0) or 0.0)
        next_break = round(max(0.0, settings.long_session_minutes - since), 1)

    return SessionStats(
        today_minutes=today_minutes,
        today_breaks=today_breaks,
        today_sessions=today_sessions,
        today_avg_score=today_avg,
        week_minutes=week_minutes,
        week_breaks=week_breaks,
        next_break_minutes=next_break,
        by_day=by_day,
        sessions=past,
    )


@router.post("/break")
def break_taken(
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> dict:
    rt = manager.ensure(user.id)
    now = utcnow()
    ws = (
        db.query(WorkSession)
        .filter(WorkSession.user_id == user.id, WorkSession.end.is_(None))
        .order_by(WorkSession.id.desc())
        .first()
    )
    if ws:
        ws.break_count = (ws.break_count or 0) + 1
    db.add(
        Event(
            user_id=user.id,
            ts=now,
            type="break",
            severity="info",
            message="Break taken (session break counter reset)",
        )
    )
    db.commit()
    rt.mark_break()
    return {"ok": True, "break_count": ws.break_count if ws else 0}
