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

    # Minimum noise (std-dev) assumed for each posture feature when turning a
    # live reading into a z-score. A calm calibration can make the raw std tiny,
    # which would make *any* small movement look like a red "poor" deviation.
    # These floors keep z-scores meaningful (all webcam-feature units).
    baseline_std_floor_neck_angle: float = 0.012
    baseline_std_floor_head_forward: float = 0.012
    baseline_std_floor_shoulder_tilt: float = 0.008
    baseline_std_floor_distance_proxy: float = 0.020
    baseline_std_floor_movement: float = 0.004

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

    # --- runtime / websocket (M2) ---
    runtime_tick_seconds: float = 1.0  # decision loop cadence
    ws_tick_seconds: float = 1.0  # WebSocket push cadence
    baseline_persist_seconds: float = 60.0  # how often a learned baseline is saved
    baseline_learn_min_score: float = 75.0  # only learn when the user is comfortable

    # --- mock sensors (M2) ---
    mock_lux: float = 420.0
    mock_drift: bool = False  # "simulate drift" switch for demos
    mock_drift_rate: float = 0.02  # neck_angle units gained per minute under drift sim

    # --- auto-brightness (M5) ---
    brightness_min_pct: float = 20.0
    brightness_max_pct: float = 100.0
    brightness_deadband_pct: float = 3.0  # ignore target changes smaller than this
    brightness_min_interval_s: float = 5.0  # rate-limit actual changes
    brightness_auto_pause_minutes: float = 5.0  # pause auto after a manual change
    brightness_dark_factor: float = 0.55  # target brightness just below comfort_min lux

    # --- voice feedback (M5) ---
    voice_enabled: bool = True
    voice_volume: float = 0.9
    voice_rate: int = 175  # words per minute
    voice_cooldown_seconds: float = 25.0  # global minimum between prompts
    voice_repeat_seconds: float = 90.0  # the same message not more often than this
    voice_quiet_hours_start: int | None = None  # 0-23 inclusive; None disables
    voice_quiet_hours_end: int | None = None
    voice_welcome_text: str = (
        "Welcome! I am Ergo. I will be monitoring your posture and giving you "
        "friendly recommendations. You can mute me any time from my little window."
    )

    # --- alerts (M5) ---
    low_light_lux: float = 250.0  # below this we nudge about ambient light
    long_session_prompt: bool = True

    @field_validator("mock", mode="before")
    @classmethod
    def _parse_mock(cls, v):
        if isinstance(v, str):
            return v.strip().lower() in {"1", "true", "yes", "on"}
        return v

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def baseline_std_floors(self) -> dict[str, float]:
        """Per-feature minimum std-dev used when building a baseline."""
        return {
            "neck_angle": self.baseline_std_floor_neck_angle,
            "head_forward": self.baseline_std_floor_head_forward,
            "shoulder_tilt": self.baseline_std_floor_shoulder_tilt,
            "distance_proxy": self.baseline_std_floor_distance_proxy,
            "movement": self.baseline_std_floor_movement,
        }


settings = Settings()

if settings.secret_key == _INSECURE_DEFAULT_KEY:
    log.warning(
        "Using the default insecure SECRET_KEY. Fine for local development; "
        "set ERGOSENSE_SECRET_KEY in backend/.env before sharing the app."
    )
