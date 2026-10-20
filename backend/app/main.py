"""ErgoSense API entry point.

Run from the `backend` folder:
    uvicorn app.main:app --reload --port 8000
Interactive API docs: http://localhost:8000/docs
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .database import init_db
from .engine.runtime import manager
from .routers import (
    alerts,
    auth,
    calibration,
    history,
    lighting,
    monitor,
    posture,
    sessions,
    settings as settings_router,
    ws,
)
from .schemas import HealthResponse


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield
    manager.stop_all()


def create_app() -> FastAPI:
    app = FastAPI(title=f"{settings.app_name} API", version="0.1.0", lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/api/health", response_model=HealthResponse, tags=["system"])
    def health() -> HealthResponse:
        return HealthResponse(status="ok", mock=settings.mock, app=settings.app_name)

    app.include_router(auth.router)
    app.include_router(calibration.router)
    app.include_router(monitor.router)
    app.include_router(lighting.router)
    app.include_router(alerts.router)
    app.include_router(settings_router.router)
    app.include_router(sessions.router)
    app.include_router(posture.router)
    app.include_router(history.router)
    app.include_router(ws.router)
    return app


app = create_app()
