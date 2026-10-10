from __future__ import annotations

from fastapi import APIRouter, Response

from app.api import serializers as ser
from app.api.deps import DB, SessionAuth
from app.core.errors import NotFoundError
from app.schemas import api as s
from app.services import checkout

router = APIRouter(prefix="/api/sessions/{session_id}", tags=["checkout"])


@router.get("/checkout/preview", response_model=s.CheckoutPreviewOut)
def checkout_preview(session_id: str, db: DB, access: SessionAuth) -> s.CheckoutPreviewOut:
    """Authoritative eligibility check with totals recalculated from catalogue prices."""
    p = checkout.preview(db, access.session)
    db.commit()  # persist any observations finalised by the preview
    return ser.preview(p)


@router.post("/checkout", response_model=s.CheckoutRecordOut)
def authorize_checkout(session_id: str, db: DB, access: SessionAuth, response: Response) -> s.CheckoutRecordOut:
    """Authorize checkout (SIMULATED payment). Idempotent; 409 with blockers if not eligible."""
    record, created = checkout.authorize(db, access.session, actor=access.actor)
    db.commit()
    response.status_code = 201 if created else 200
    return s.CheckoutRecordOut.model_validate(record)


@router.post("/exit", response_model=s.CheckoutRecordOut)
def confirm_exit(session_id: str, db: DB, access: SessionAuth) -> s.CheckoutRecordOut:
    """SIMULATED exit-gate confirmation."""
    record = checkout.confirm_exit(db, access.session, actor=access.actor)
    db.commit()
    return s.CheckoutRecordOut.model_validate(record)


@router.get("/receipt", response_model=s.CheckoutRecordOut)
def receipt(session_id: str, db: DB, access: SessionAuth) -> s.CheckoutRecordOut:
    record = checkout.existing_record(db, access.session.id)
    if record is None:
        raise NotFoundError("No checkout record for this session yet")
    return s.CheckoutRecordOut.model_validate(record)
