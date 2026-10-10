"""Request dependencies: DB session and the three authentication modes.

* Staff: `Authorization: Bearer <signed token>` from /api/auth/login.
* Customer: `X-Session-Token: <token>` returned when the session was created.
* Vision service: `X-Vision-Key: <shared key>` from the environment.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Header
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import AuthError, ForbiddenError
from app.core.security import constant_time_equals, decode_token
from app.db.session import get_db
from app.models import ShoppingSession, StaffUser
from app.models.enums import ActorType, StaffRole
from app.services import sessions as session_service
from app.services.audit import Actor

DB = Annotated[Session, Depends(get_db)]


def staff_from_token(db: Session, token: str) -> StaffUser:
    payload = decode_token(token, get_settings().secret_key)
    staff = db.get(StaffUser, payload.get("sub"))
    if staff is None or not staff.active:
        raise AuthError("Staff account not found or disabled")
    return staff


def _bearer(authorization: str | None) -> str | None:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return None


def current_staff(db: DB, authorization: Annotated[str | None, Header()] = None) -> StaffUser:
    token = _bearer(authorization)
    if not token:
        raise AuthError("Staff sign-in required")
    return staff_from_token(db, token)


def current_manager(staff: Annotated[StaffUser, Depends(current_staff)]) -> StaffUser:
    if staff.role != StaffRole.MANAGER:
        raise ForbiddenError("Only a store manager can change this setting")
    return staff


Staff = Annotated[StaffUser, Depends(current_staff)]
Manager = Annotated[StaffUser, Depends(current_manager)]


def staff_actor(staff: StaffUser) -> Actor:
    return Actor(ActorType.STAFF, staff.username)


def require_vision_key(x_vision_key: Annotated[str | None, Header()] = None) -> None:
    if not constant_time_equals(x_vision_key, get_settings().vision_api_key):
        raise AuthError("Invalid or missing X-Vision-Key")


VisionKey = Annotated[None, Depends(require_vision_key)]


@dataclass
class SessionAccess:
    session: ShoppingSession
    actor: Actor
    is_staff: bool


def session_access(
    session_id: str,
    db: DB,
    authorization: Annotated[str | None, Header()] = None,
    x_session_token: Annotated[str | None, Header()] = None,
) -> SessionAccess:
    """Allow either the owning customer (session token) or signed-in staff."""
    session = session_service.get_session(db, session_id)
    token = _bearer(authorization)
    if token:
        staff = staff_from_token(db, token)
        return SessionAccess(session, staff_actor(staff), True)
    session_service.verify_customer(session, x_session_token)
    return SessionAccess(session, Actor(ActorType.CUSTOMER, session.customer_label), False)


def customer_access(session_id: str, db: DB, x_session_token: Annotated[str | None, Header()] = None) -> SessionAccess:
    session = session_service.get_session(db, session_id)
    session_service.verify_customer(session, x_session_token)
    return SessionAccess(session, Actor(ActorType.CUSTOMER, session.customer_label), False)


SessionAuth = Annotated[SessionAccess, Depends(session_access)]
CustomerAuth = Annotated[SessionAccess, Depends(customer_access)]
