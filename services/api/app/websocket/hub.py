"""Real-time notification hub.

Domain services enqueue messages on the SQLAlchemy session (`enqueue`). They
are published only after the transaction commits, so clients never see an
event for state that was rolled back. Clients then re-fetch persisted state
through REST, which keeps the UI consistent after refreshes and reconnects.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from fastapi import WebSocket
from sqlalchemy import event
from sqlalchemy.orm import Session

from app.core.time import utcnow

log = logging.getLogger("kortex.ws")

PROTOCOL_VERSION = 1

# Message types a customer connection may receive for its own session.
CUSTOMER_TYPES = {
    "cart.updated",
    "scan.created",
    "discrepancy.created",
    "discrepancy.updated",
    "checkout.updated",
    "session.updated",
}


def make_message(msg_type: str, *, session_id: str | None = None, data: dict[str, Any] | None = None) -> dict:
    return {
        "v": PROTOCOL_VERSION,
        "type": msg_type,
        "session_id": session_id,
        "ts": utcnow().isoformat(),
        "data": data or {},
    }


def enqueue(db: Session, msg_type: str, *, session_id: str | None = None, data: dict[str, Any] | None = None) -> None:
    if not db.in_transaction():
        db.begin()  # tie the message to a transaction so rollback() discards it
    db.info.setdefault("outbox", []).append(make_message(msg_type, session_id=session_id, data=data))


@dataclass(eq=False)
class _Client:
    ws: WebSocket
    role: str  # "staff" | "customer"
    session_id: str | None


class Hub:
    def __init__(self) -> None:
        self._clients: set[_Client] = set()
        self._loop: asyncio.AbstractEventLoop | None = None
        self._listeners: list[Callable[[dict], None]] = []

    # -- lifecycle --------------------------------------------------------
    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def add_listener(self, fn: Callable[[dict], None]) -> None:
        self._listeners.append(fn)

    def remove_listener(self, fn: Callable[[dict], None]) -> None:
        with contextlib.suppress(ValueError):
            self._listeners.remove(fn)

    @property
    def client_count(self) -> int:
        return len(self._clients)

    async def connect(self, ws: WebSocket, role: str, session_id: str | None) -> _Client:
        await ws.accept()
        client = _Client(ws=ws, role=role, session_id=session_id)
        self._clients.add(client)
        return client

    def disconnect(self, client: _Client) -> None:
        self._clients.discard(client)

    # -- publishing -------------------------------------------------------
    def publish(self, message: dict) -> None:
        """Thread-safe publish (called from sync request handlers)."""
        for fn in list(self._listeners):
            try:
                fn(message)
            except Exception:  # pragma: no cover - listener errors must not break requests
                log.exception("listener failed")
        loop = self._loop
        if loop is None or loop.is_closed():
            return
        try:
            running = asyncio.get_running_loop()
        except RuntimeError:
            running = None
        if running is loop:
            loop.create_task(self._broadcast(message))
        else:
            loop.call_soon_threadsafe(lambda: loop.create_task(self._broadcast(message)))

    async def _broadcast(self, message: dict) -> None:
        dead: list[_Client] = []
        for client in list(self._clients):
            if client.role == "customer" and (
                message.get("session_id") != client.session_id or message["type"] not in CUSTOMER_TYPES
            ):
                continue
            try:
                await client.ws.send_json(message)
            except Exception:
                dead.append(client)
        for client in dead:
            self.disconnect(client)


hub = Hub()


@event.listens_for(Session, "after_commit")
def _flush_outbox(session: Session) -> None:
    messages = session.info.pop("outbox", [])
    for message in messages:
        hub.publish(message)


@event.listens_for(Session, "after_soft_rollback")
def _drop_outbox(session: Session, _previous_transaction) -> None:
    # Fires on every rollback() call, even when no SQL had been emitted yet.
    session.info.pop("outbox", None)
