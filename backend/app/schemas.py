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
