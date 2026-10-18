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
