"""Request/response shapes (validated by Pydantic)."""
from datetime import datetime
from typing import Literal

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


class CalibrationSampleRequest(BaseModel):
    neck_angle: float | None = None
    shoulder_tilt: float | None = None
    head_forward: float | None = None
    distance_proxy: float | None = None
    movement: float | None = None


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
    features: list[str] = []  # posture features seen in the samples so far


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


class LightingSummary(BaseModel):
    lux: float | None
    comfort_min: float
    comfort_max: float
    target_pct: float
    current_pct: float | None
    mode: str
    supported: bool
    status: str  # "too_dark" | "comfortable" | "too_bright" | "unknown"
    device: str  # esp32 status: ok | mock | disconnected
    paused: bool = False


class LightingCurvePoint(BaseModel):
    lux: float
    target_pct: float


class LightingModeRequest(BaseModel):
    mode: Literal["auto", "manual"]


class LightingBrightnessRequest(BaseModel):
    brightness: float = Field(ge=0, le=100)


class SettingsOut(BaseModel):
    voice_enabled: bool
    brightness_mode: str
    manual_brightness: float | None = None
    low_light_lux: float
    long_session_minutes: float
    voice_supported: bool
    voice_status: str
    brightness_supported: bool


class SettingsUpdate(BaseModel):
    voice_enabled: bool | None = None
    brightness_mode: Literal["auto", "manual"] | None = None
    manual_brightness: float | None = Field(default=None, ge=0, le=100)


class MuteRequest(BaseModel):
    minutes: float = Field(gt=0, le=24 * 60)


class MockRequest(BaseModel):
    lux: float | None = None
    drift: bool | None = None


class ModeRequest(BaseModel):
    mode: Literal["mock", "real"]


# --- posture (M4) ----------------------------------------------------------
class PostureFeature(BaseModel):
    key: str
    label: str
    current: float | None
    baseline: float | None
    std: float | None
    z: float | None
    status: str  # "good" | "attention" | "poor" | "unknown"
    higher_is_worse: bool


class PostureToday(BaseModel):
    good_pct: float = 0.0
    mild_pct: float = 0.0
    poor_pct: float = 0.0
    n: int = 0


class PostureSummary(BaseModel):
    calibrated: bool
    present: bool
    score: float | None = None  # null until there is a real reading to report
    source: str = "none"  # "live" | "stored" | "none"
    drift: DriftOut
    features: list[PostureFeature]
    today: PostureToday
    tip: str


class PostureTrendPoint(BaseModel):
    ts: datetime
    neck_angle: float | None = None
    distance_proxy: float | None = None
    shoulder_tilt: float | None = None
    z_neck: float | None = None
    z_distance: float | None = None
    n: int = 0


class PostureTrend(BaseModel):
    range: str
    bucket_minutes: float
    mild_z: float
    enter_z: float
    points: list[PostureTrendPoint]


# --- history (M4/M6) ------------------------------------------------------
class HistoryPoint(BaseModel):
    ts: datetime
    n: int = 0
    score: float | None = None
    posture: float | None = None
    screen: float | None = None
    lighting: float | None = None
    movement: float | None = None
    lux: float | None = None


class HistorySeries(BaseModel):
    range: str
    from_ts: datetime
    to_ts: datetime
    bucket_minutes: float
    metrics: list[str]
    points: list[HistoryPoint]


class HeatmapCell(BaseModel):
    day: str
    hour: int
    avg_score: float
    n: int


class DaySummary(BaseModel):
    day: str
    hours: float
    avg_score: float | None = None
    good_pct: float | None = None
    sessions: int = 0


class HistorySummary(BaseModel):
    range: str
    from_ts: datetime
    to_ts: datetime
    samples: int
    hours: float
    avg_score: float | None = None
    best_score: float | None = None
    worst_score: float | None = None
    good_pct: float | None = None
    drift_episodes: int = 0
    sessions: int = 0
    breaks: int = 0
    by_day: list[DaySummary] = []
    heatmap: list[HeatmapCell] = []
    insight: str = ""


class EventPage(BaseModel):
    items: list[EventOut]
    total: int
    limit: int
    offset: int


# --- sessions (M6) ---------------------------------------------------------
class SessionDay(BaseModel):
    day: str
    work_minutes: float
    breaks: int = 0
    sessions: int = 0
    avg_score: float | None = None


class SessionRow(BaseModel):
    id: int
    start: datetime
    end: datetime | None = None
    minutes: float
    avg_score: float | None = None
    break_count: int = 0


class SessionStats(BaseModel):
    today_minutes: float
    today_breaks: int
    today_sessions: int
    today_avg_score: float | None = None
    week_minutes: float
    week_breaks: int
    next_break_minutes: float | None = None
    by_day: list[SessionDay] = []
    sessions: list[SessionRow] = []

