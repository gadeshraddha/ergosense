"""WebSocket live stream: ``WS /ws/live?token=<jwt>``.

Authenticates with the JWT from the query string, then pushes the live snapshot
(the shape documented in CLAUDE.md) every ``ws_tick_seconds`` until the client
disconnects. The heavy lifting (the loop) runs in ``engine.runtime``; this just
reads the shared snapshot, so there is no cross-thread asyncio plumbing.
"""
from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi import status as http_status

from ..config import settings
from ..database import SessionLocal
from ..engine.runtime import manager
from ..security import get_user_from_token

log = logging.getLogger("ergosense.ws")
router = APIRouter()


@router.websocket("/ws/live")
async def ws_live(websocket: WebSocket, token: str = "") -> None:
    # Authenticate before accepting, so bad tokens are rejected up front.
    if not token:
        await websocket.close(code=http_status.WS_1008_POLICY_VIOLATION)
        return
    try:
        with SessionLocal() as db:
            user = get_user_from_token(token, db)
    except Exception:
        await websocket.close(code=http_status.WS_1008_POLICY_VIOLATION)
        return

    await websocket.accept()
    rt = manager.ensure(user.id)
    tick = max(0.2, settings.ws_tick_seconds)
    try:
        while True:
            snapshot = rt.snapshot()
            await websocket.send_json(
                {
                    **snapshot,
                    "ts": snapshot["ts"].isoformat(),
                }
            )
            await asyncio.sleep(tick)
    except WebSocketDisconnect:
        pass
    except Exception:  # pragma: no cover - network edge cases
        log.exception("ws live stream failed for user %s", user.id)
        try:
            await websocket.close()
        except Exception:
            pass
