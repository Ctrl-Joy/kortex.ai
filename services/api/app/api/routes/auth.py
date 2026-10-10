from __future__ import annotations

from fastapi import APIRouter
from sqlalchemy import select

from app.api.deps import DB, Staff
from app.core.config import get_settings
from app.core.errors import AuthError
from app.core.security import create_token, verify_password
from app.models import StaffUser
from app.models.enums import ActorType
from app.schemas.api import LoginRequest, LoginResponse, StaffOut
from app.services import audit
from app.services.audit import Actor

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=LoginResponse)
def login(body: LoginRequest, db: DB) -> LoginResponse:
    staff = db.scalar(select(StaffUser).where(StaffUser.username == body.username.strip().lower()))
    if staff is None or not staff.active or not verify_password(body.password, staff.password_hash):
        raise AuthError("Invalid username or password")
    settings = get_settings()
    ttl = settings.token_ttl_minutes * 60
    token = create_token({"sub": staff.id, "role": staff.role}, settings.secret_key, ttl)
    audit.record(
        db,
        actor=Actor(ActorType.STAFF, staff.username),
        event_type="STAFF_SIGNED_IN",
        summary=f"{staff.display_name} signed in.",
        entity_type="staff",
        entity_id=staff.id,
    )
    db.commit()
    return LoginResponse(token=token, expires_in=ttl, staff=StaffOut.model_validate(staff))


@router.get("/me", response_model=StaffOut)
def me(staff: Staff) -> StaffOut:
    return StaffOut.model_validate(staff)
