"""Central configuration. Every tunable number or setting lives here.

Values can be overridden with environment variables or a `.env` file
(all prefixed with ERGOSENSE_). See `.env.example`.
"""
import logging

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

log = logging.getLogger("ergosense")

_INSECURE_DEFAULT_KEY = "dev-only-insecure-key-please-change-me-before-sharing"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="ERGOSENSE_", env_file=".env", extra="ignore"
    )

    # --- app / security ---
    app_name: str = "ErgoSense"
    secret_key: str = _INSECURE_DEFAULT_KEY
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 720  # 12 hours

    # --- database ---
    database_url: str = "sqlite:///./ergosense.db"

    # --- mock mode: fake sensors, no hardware needed ---
    mock: bool = True

    # --- CORS (frontend dev servers allowed to call the API) ---
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    # --- account rules ---
    min_password_length: int = 8
    max_password_bytes: int = 72  # hard limit of the bcrypt algorithm

    # --- calibration (M3) ---
    calibration_duration_s: int = 150  # wizard length in seconds (2.5 min)
    calibration_demo_duration_s: int = 20  # short version used in mock/demo mode
    calibration_min_samples: int = 30  # need at least this many valid samples
    calibration_max_movement_std: float = 0.08  # reject a fidgety calibration

    # --- baseline auto-update ---
    baseline_ema_alpha: float = 0.02  # gentle drift of "normal" over time

    # --- drift detection (M3) ---
    drift_window_minutes: float = 10.0
    drift_demo_window_minutes: float = 1.0
    drift_enter_threshold: float = 0.05  # normalized feature offset to start drift
    drift_exit_threshold: float = 0.02  # hysteresis: must fall below this to stop
    drift_enter_minutes: float = 2.0  # must stay beyond threshold this long
    drift_significant_multiplier: float = 2.0  # offset this many x -> "significant"

    # --- fusion weights + interaction rules (M3) ---
    weight_posture: float = 0.35
    weight_screen: float = 0.25
    weight_lighting: float = 0.20
    weight_movement: float = 0.20
    score_smoothing_seconds: float = 30.0
    interaction_penalty: float = 12.0  # forward lean + too close + long session

    # --- factor scoring ---
    posture_z_penalty: float = 25.0  # points lost per std-dev of forward lean
    screen_z_penalty: float = 25.0  # points lost per std-dev of moving closer
    lux_comfort_min: float = 300.0
    lux_comfort_max: float = 1000.0
    movement_min: float = 0.02  # below this counts as "too still"

    # --- sessions ---
    break_minutes: float = 5.0  # absence this long resets continuous work time
    long_session_minutes: float = 50.0  # after this we flag a long session
    sample_write_seconds: float = 5.0  # throttle DB Sample writes

    @field_validator("mock", mode="before")
    @classmethod
    def _parse_mock(cls, v):
        if isinstance(v, str):
            return v.strip().lower() in {"1", "true", "yes", "on"}
        return v

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()

if settings.secret_key == _INSECURE_DEFAULT_KEY:
    log.warning(
        "Using the default insecure SECRET_KEY. Fine for local development; "
        "set ERGOSENSE_SECRET_KEY in backend/.env before sharing the app."
    )
