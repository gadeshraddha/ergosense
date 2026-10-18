"""Database tables.

Every table except `User` has a `user_id`, so one user can never see
another user's data.
"""
from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    baselines: Mapped[list["Baseline"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class Baseline(Base):
    """A user's personal 'normal' posture/lighting (filled in during M3)."""

    __tablename__ = "baselines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    json_stats: Mapped[dict] = mapped_column(JSON, default=dict)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    user: Mapped[User] = relationship(back_populates="baselines")


class Sample(Base):
    """One recorded reading of posture + light + score (written by the engine in M2)."""

    __tablename__ = "samples"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    neck_angle: Mapped[float | None] = mapped_column(Float, nullable=True)
    shoulder_tilt: Mapped[float | None] = mapped_column(Float, nullable=True)
    head_forward: Mapped[float | None] = mapped_column(Float, nullable=True)
    distance_proxy: Mapped[float | None] = mapped_column(Float, nullable=True)
    movement: Mapped[float | None] = mapped_column(Float, nullable=True)
    lux: Mapped[float | None] = mapped_column(Float, nullable=True)
    score: Mapped[float | None] = mapped_column(Float, nullable=True)


class Event(Base):
    """Something notable: drift started, voice prompt spoken, break taken, ..."""

    __tablename__ = "events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    type: Mapped[str] = mapped_column(String(50), index=True)
    severity: Mapped[str] = mapped_column(String(20), default="info")
    message: Mapped[str] = mapped_column(Text, default="")


class WorkSession(Base):
    """A continuous period of monitored work."""

    __tablename__ = "work_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    start: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    avg_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    break_count: Mapped[int] = mapped_column(Integer, default=0)


class UserSetting(Base):
    """Per-user key/value settings (voice, thresholds, weights ... used from M5)."""

    __tablename__ = "user_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    key: Mapped[str] = mapped_column(String(100))
    value: Mapped[dict] = mapped_column(JSON, default=dict)
