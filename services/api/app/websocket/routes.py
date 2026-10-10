from __future__ import annotations

import asyncio
import contextlib

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.api.deps import staff_from_token
from app.core.errors import DomainError
from app.db.session import SessionLocal
from app.services import sessions
from app.websocket.hub import hub, make_message

router = APIRouter()


@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket) -> None:
    """Live updates.

    Staff:    /ws?token=<staff bearer token>   → all events
    Customer: /ws?session_id=<id>&session_token=<token> → own session only
    """
    token = ws.query_params.get("token")
    session_id = ws.query_params.get("session_id")
    session_token = ws.query_params.get("session_token")
    role: str | None = None
    try:
        with SessionLocal() as db:
            if token:
                staff_from_token(db, token)
                role = "staff"
            elif session_id and session_token:
                sessions.verify_customer(sessions.get_session(db, session_id), session_token)
                role = "customer"
    except DomainError:
        role = None
    if role is None:
        await ws.close(code=4401, reason="unauthorized")
        return

    client = await hub.connect(ws, role, session_id if role == "customer" else None)
    await ws.send_json(make_message("hello", session_id=client.session_id, data={"role": role}))
    try:
        while True:
            try:
                msg = await asyncio.wait_for(ws.receive_text(), timeout=25)
                if msg == "ping":
                    await ws.send_json(make_message("pong"))
            except TimeoutError:
                await ws.send_json(make_message("heartbeat"))
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        hub.disconnect(client)
        with contextlib.suppress(Exception):
            await ws.close()
