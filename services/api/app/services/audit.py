"""Append-only audit trail."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from app.models import AuditEvent
from app.models.enums import ActorType
from app.websocket.hub import enqueue


@dataclass(frozen=True)
class Actor:
    type: ActorType
    id: str | None = None

    @property
    def label(self) -> str:
        return f"{self.type.value}:{self.id}" if self.id else self.type.value


SYSTEM = Actor(ActorType.SYSTEM, "reconciliation-engine")


def record(
    db: Session,
    *,
    actor: Actor,
    event_type: str,
    summary: str,
    session_id: str | None = None,
    entity_type: str | None = None,
    entity_id: str | None = None,
    source: str | None = None,
    is_simulated: bool = False,
    details: dict[str, Any] | None = None,
) -> AuditEvent:
    entry = AuditEvent(
        actor_type=actor.type.value,
        actor_id=actor.id,
        event_type=event_type,
        session_id=session_id,
        entity_type=entity_type,
        entity_id=entity_id,
        source=source,
        is_simulated=is_simulated,
        summary=summary,
        details=details or {},
    )
    db.add(entry)
    db.flush()
    enqueue(
        db,
        "audit.created",
        session_id=session_id,
        data={"id": entry.id, "event_type": event_type, "summary": summary},
    )
    return entry
