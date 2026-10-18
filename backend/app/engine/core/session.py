"""Work session helpers (lightweight logic for the API)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def is_on_break(last_active: datetime, now: datetime, break_minutes: float) -> bool:
    return (now - last_active) >= timedelta(minutes=break_minutes)


def session_minutes(start: datetime, now: datetime) -> float:
    return (now - start).total_seconds() / 60.0
