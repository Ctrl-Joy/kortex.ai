from __future__ import annotations

from datetime import timedelta

from sqlalchemy import select

from app.core.time import utcnow
from app.models import AuditEvent, ScanEvent
from app.models.enums import ActorType
from app.services import pipeline, sessions
from app.services.audit import Actor


def test_session_creation_requires_token_for_access(client, shopper):
    assert client.get(f"/api/sessions/{shopper.id}/state").status_code == 401
    assert client.get(f"/api/sessions/{shopper.id}/state", headers={"X-Session-Token": "wrong"}).status_code == 401
    state = shopper.state()
    assert state["session"]["status"] == "ACTIVE"
    assert state["item_count"] == 0


def test_scan_adds_item_with_catalogue_price(shopper, products):
    cola = products["BEV-COLA-500"]
    r = shopper.scan(cola.barcode)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "ACCEPTED"
    state = shopper.state()
    assert state["item_count"] == 1
    assert state["subtotal_paise"] == 4000


def test_price_totals_are_integer_paise(client, shopper, products):
    shopper.scan(products["BEV-COLA-500"].barcode)
    shopper.scan(products["HOM-MUG-350"].barcode)
    r = client.put(
        f"/api/sessions/{shopper.id}/items/{products['BEV-COLA-500'].id}", json={"quantity": 3}, headers=shopper.headers
    )
    assert r.status_code == 200
    assert r.json()["subtotal_paise"] == 3 * 4000 + 19900
    r = client.put(
        f"/api/sessions/{shopper.id}/items/{products['BEV-COLA-500'].id}", json={"quantity": 1}, headers=shopper.headers
    )
    assert r.json()["subtotal_paise"] == 4000 + 19900


def test_unknown_and_invalid_barcodes_are_rejected_not_added(shopper):
    from app.services.barcode import with_check_digit

    r = shopper.scan(with_check_digit("890100100999"))  # valid checksum, not in catalogue
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "rejected_unknown"
    r = shopper.scan("1234567890123")  # bad checksum
    assert r.status_code == 422
    assert shopper.state()["item_count"] == 0


def test_client_scan_id_is_idempotent(shopper, products):
    code = products["BEV-COLA-500"].barcode
    a = shopper.scan(code, client_scan_id="phone-1")
    b = shopper.scan(code, client_scan_id="phone-1")
    assert a.json()["status"] == "ACCEPTED"
    assert b.json()["status"] == "IDEMPOTENT_REPLAY"
    assert shopper.state()["item_count"] == 1


def test_repeated_scanner_callback_is_debounced(shopper, products):
    code = products["BEV-COLA-500"].barcode
    shopper.scan(code)
    r = shopper.scan(code)
    assert r.json()["status"] == "DUPLICATE_IGNORED"
    assert shopper.state()["item_count"] == 1


def test_soft_duplicate_scan_asks_customer(db, client, products):
    session, token = sessions.create_session(db, actor=Actor(ActorType.CUSTOMER))
    db.commit()
    cola = products["BEV-COLA-500"]
    t0 = utcnow()
    actor = Actor(ActorType.CUSTOMER)
    pipeline.process_scan(db, session, code=cola.barcode, method="CAMERA_BARCODE", actor=actor, occurred_at=t0)
    out = pipeline.process_scan(
        db, session, code=cola.barcode, method="CAMERA_BARCODE", actor=actor, occurred_at=t0 + timedelta(seconds=4)
    )
    db.commit()
    assert out.status == "ACCEPTED" and out.discrepancy is not None
    assert out.discrepancy.kind == "DUPLICATE_SCAN"
    headers = {"X-Session-Token": token}
    r = client.post(
        f"/api/discrepancies/{out.discrepancy.id}/customer-resolution", json={"option": "REMOVE_EXTRA"}, headers=headers
    )
    assert r.status_code == 200 and r.json()["state"] == "RESOLVED"
    state = client.get(f"/api/sessions/{session.id}/state", headers=headers).json()
    assert state["item_count"] == 1
    voided = db.scalars(select(ScanEvent).where(ScanEvent.session_id == session.id, ScanEvent.status == "VOIDED")).all()
    assert len(voided) == 1  # removal preserved as evidence, not deleted


def test_scan_creates_audit_and_ws_notifications(client, shopper, products):
    from app.websocket.hub import hub

    seen: list[dict] = []
    hub.add_listener(seen.append)
    try:
        shopper.scan(products["BEV-COLA-500"].barcode)
    finally:
        hub.remove_listener(seen.append)
    types = {m["type"] for m in seen}
    assert {"scan.created", "cart.updated", "audit.created"} <= types
    assert all(m["v"] == 1 for m in seen)


def test_rolled_back_transactions_do_not_notify(db):
    from app.websocket.hub import enqueue, hub

    seen: list[dict] = []
    hub.add_listener(seen.append)
    try:
        enqueue(db, "cart.updated", session_id="X")
        db.rollback()
        db.commit()
    finally:
        hub.remove_listener(seen.append)
    assert seen == []


def test_audit_records_scan(db, shopper, products):
    shopper.scan(products["BEV-COLA-500"].barcode)
    types = set(db.scalars(select(AuditEvent.event_type).where(AuditEvent.session_id == shopper.id)))
    assert {"SESSION_CREATED", "BARCODE_SCAN"} <= types


def test_customer_websocket_receives_only_own_session(client, shopper, products):
    other = type(shopper)(client)
    path = f"/ws?session_id={shopper.id}&session_token={shopper.headers['X-Session-Token']}"
    with client.websocket_connect(path) as ws:
        assert ws.receive_json()["type"] == "hello"
        other.scan(products["HOM-MUG-350"].barcode)
        shopper.scan(products["BEV-COLA-500"].barcode)
        msg = ws.receive_json()
        assert msg["session_id"] == shopper.id


def test_websocket_rejects_bad_token(client):
    import pytest
    from starlette.websockets import WebSocketDisconnect

    with pytest.raises(WebSocketDisconnect), client.websocket_connect("/ws?token=bogus") as ws:
        ws.receive_json()
