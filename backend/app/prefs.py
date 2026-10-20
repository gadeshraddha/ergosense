"""Tiny per-user key/value settings store (the ``UserSetting`` table).

Values are stored as ``{"v": <json>}`` so numbers, booleans and strings all fit.
Settings persist across restarts and are read by the runtime to drive behaviour.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from .models import UserSetting


def get_setting(db: Session, user_id: int, key: str, default: Any = None) -> Any:
    row = (
        db.query(UserSetting)
        .filter(UserSetting.user_id == user_id, UserSetting.key == key)
        .order_by(UserSetting.id.desc())
        .first()
    )
    if row is None:
        return default
    return (row.value or {}).get("v", default)


def set_setting(db: Session, user_id: int, key: str, value: Any) -> None:
    row = (
        db.query(UserSetting)
        .filter(UserSetting.user_id == user_id, UserSetting.key == key)
        .order_by(UserSetting.id.desc())
        .first()
    )
    if row is None:
        db.add(UserSetting(user_id=user_id, key=key, value={"v": value}))
    else:
        row.value = {"v": value}
    db.commit()


def all_settings(db: Session, user_id: int) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for row in db.query(UserSetting).filter(UserSetting.user_id == user_id).all():
        out[row.key] = (row.value or {}).get("v")
    return out
