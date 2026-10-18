"""Request/response shapes (validated by Pydantic)."""
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from .config import settings


def _check_password(value: str) -> str:
    if len(value) < settings.min_password_length:
        raise ValueError(f"Password must be at least {settings.min_password_length} characters")
    if len(value.encode("utf-8")) > settings.max_password_bytes:
        raise ValueError("Password is too long (max 72 bytes)")
    return value


class RegisterRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    email: EmailStr
    password: str

    @field_validator("name")
    @classmethod
    def _strip_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Name cannot be empty")
        return v

    @field_validator("password")
    @classmethod
    def _password_rules(cls, v: str) -> str:
        return _check_password(v)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=200)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    email: EmailStr
    created_at: datetime


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class HealthResponse(BaseModel):
    status: str
    mock: bool
    app: str


class BaselineStats(BaseModel):
    mean: float
    std: float
    median: float
    mad: float
    n: int


class BaselineOut(BaseModel):
    present: bool
    stats: dict[str, BaselineStats] = {}
    valid_samples: int = 0
    quality: float = 0.0
    created_at: datetime | None = None


class CalibrationStartRequest(BaseModel):
    demo: bool | None = False


class CalibrationStartResponse(BaseModel):
    ok: bool
    status_url: str
    duration_s: int


class CalibrationStatus(BaseModel):
    running: bool
    elapsed_s: float
    duration_s: int
    progress_pct: float
    valid_samples: int
    quality: float
    reason: str | None = None
    completed: bool
    baseline_ok: bool
    message: str | None = None


class CalibrationCancelResponse(BaseModel):
    ok: bool


class DriftOut(BaseModel):
    level: str
    feature: str
    minutes: float


class FactorScoresOut(BaseModel):
    posture: float
    screen: float
    lighting: float
    movement: float


class LiveSnapshot(BaseModel):
    ts: datetime
    monitoring: bool
    mode: str
    calibrated: bool
    present: bool
    features: dict
    lux: float | None
    factors: FactorScoresOut
    score: float
    drift: DriftOut
    insight: str
    session: dict
    devices: dict


class SessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    start: datetime
    end: datetime | None = None
    avg_score: float | None = None
    break_count: int


class EventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    ts: datetime
    type: str
    severity: str
    message: str
