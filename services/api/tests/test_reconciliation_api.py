"""End-to-end reconciliation rules through the HTTP API."""

from __future__ import annotations

from datetime import timedelta

from sqlalchemy import select

from app.core.time import utcnow
from app.models import AuditEvent, Discrepancy, ResolutionAction, ScanEvent, VisionEvent
from tests.conftest import VISION_HEADERS, vision_event


def open_discrepancies(client, staff_headers, session_id):
    r = client.get(f"/api/discrepancies?session_id={session_id}&state=OPEN", headers=staff_headers)
    assert r.status_code == 200
    return r.json()["items"]


def finalize(client, staff_headers, session_id):
    r = client.post(f"/api/sessions/{session_id}/reconcile", headers=staff_headers)
    assert r.status_code == 200
    return r.json()["finalized"]


def test_vision_endpoint_requires_key(client, shopper):
    r = client.post("/api/vision/events", json={"event_id": "abcdef12", "event_type": "PICKUP"})
    assert r.status_code == 401


def test_matching_scan_and_pickup(client, staff_headers, shopper, products):
    cola = products["BEV-COLA-500"]
    shopper.scan(cola.barcode)
    r = vision_event(client, event_type="PICKUP", product_id=cola.id, model_confidence=0.9, track_frames=10)
    assert r.status_code == 200, r.text
    assert r.json()["event"]["state"] == "MATCHED"
    assert r.json()["event"]["source"] == "CAMERA_LIVE"
    assert shopper.state()["verification"]["visually_verified_units"] == 1
    assert open_discrepancies(client, staff_headers, shopper.id) == []


def test_pickup_waits_for_late_scan_within_grace(client, staff_headers, shopper, products):
    cola = products["BEV-COLA-500"]
    r = vision_event(client, event_type="PICKUP", product_id=cola.id, model_confidence=0.9)
    assert r.json()["event"]["state"] == "OBSERVED"  # pending, not an alert yet
    shopper.scan(cola.barcode)
    assert finalize(client, staff_headers, shopper.id) == 0
    assert open_discrepancies(client, staff_headers, shopper.id) == []


def test_vision_event_idempotency_and_duplicate_suppression(client, staff_headers, shopper, products):
    choc = products["CNF-CHOC-100"]
    first = vision_event(
        client, event_id="evt-same-123", event_type="PICKUP", product_id=choc.id, model_confidence=0.9, track_id="t1"
    )
    replay = vision_event(
        client, event_id="evt-same-123", event_type="PICKUP", product_id=choc.id, model_confidence=0.9, track_id="t1"
    )
    assert replay.json()["replay"] is True
    assert replay.json()["event"]["id"] == first.json()["event"]["id"]
    dup = vision_event(client, event_type="PICKUP", product_id=choc.id, model_confidence=0.9, track_id="t1")
    assert dup.json()["event"]["state"] == "DUPLICATE"
    finalize(client, staff_headers, shopper.id)
    items = open_discrepancies(client, staff_headers, shopper.id)
    assert len(items) == 1  # one alert, not three


def test_missed_scan_candidate_after_grace_window(client, db, staff_headers, shopper, products):
    choc = products["CNF-CHOC-100"]
    past = (utcnow() - timedelta(seconds=120)).isoformat()
    vision_event(
        client, event_type="PICKUP", product_id=choc.id, model_confidence=0.88, track_frames=10, occurred_at=past
    )
    # the background sweeper calls finalize_pending() without force
    from app.services import pipeline

    assert pipeline.finalize_pending(db) == 1
    db.commit()
    items = open_discrepancies(client, staff_headers, shopper.id)
    assert [d["kind"] for d in items] == ["MISSED_SCAN"]
    d = items[0]
    assert d["state"] == "AWAITING_CUSTOMER" and d["blocking"]
    assert d["observed_product"]["id"] == choc.id
    assert "theft" not in (d["explanation"] + d["customer_message"]).lower()
    assert d["model_confidence"] == 0.88 and d["reconciliation_confidence"] != d["model_confidence"]


def test_wrong_product_customer_confirms_correction(client, db, staff_headers, shopper, products):
    cola, choc = products["BEV-COLA-500"], products["CNF-CHOC-100"]
    shopper.scan(cola.barcode)
    vision_event(client, event_type="PICKUP", product_id=choc.id, model_confidence=0.86, track_frames=9)
    finalize(client, staff_headers, shopper.id)
    state = shopper.state()
    d = next(x for x in state["discrepancies"] if x["kind"] == "WRONG_PRODUCT")
    assert state["subtotal_paise"] == 4000  # NOT silently replaced
    assert d["scanned_product"]["id"] == cola.id and d["observed_product"]["id"] == choc.id

    r = shopper.respond(d["id"], "REPLACE_ITEM")
    assert r.status_code == 200 and r.json()["state"] == "RESOLVED"
    state = shopper.state()
    assert state["subtotal_paise"] == 6000
    assert [line["product"]["sku"] for line in state["lines"]] == [choc.sku]

    # Original scan preserved (voided, not deleted) and correction recorded.
    scans = db.scalars(select(ScanEvent).where(ScanEvent.session_id == shopper.id)).all()
    assert {s.status for s in scans} == {"VOIDED", "ACCEPTED"}
    action = db.scalar(select(ResolutionAction).where(ResolutionAction.discrepancy_id == d["id"]))
    assert action.state_before == "AWAITING_CUSTOMER" and action.state_after == "RESOLVED"
    assert {c["qty_delta"] for c in action.cart_delta} == {-1, 1}
    assert db.scalar(
        select(AuditEvent).where(AuditEvent.event_type == "CART_CORRECTED", AuditEvent.session_id == shopper.id)
    )


def test_customer_cannot_choose_unavailable_option(client, staff_headers, shopper, products):
    choc = products["CNF-CHOC-100"]
    vision_event(client, event_type="PICKUP", product_id=choc.id, model_confidence=0.9)
    finalize(client, staff_headers, shopper.id)
    d = shopper.state()["discrepancies"][0]
    assert shopper.respond(d["id"], "REPLACE_ITEM").status_code == 422
    assert shopper.respond(d["id"], "HACK").status_code == 422


def test_pickup_then_return_produces_no_open_alert(client, db, staff_headers, shopper, products):
    note = products["STN-NOTE-A5"]
    vision_event(client, event_type="PICKUP", product_id=note.id, model_confidence=0.84, track_id="n1")
    r = vision_event(client, event_type="RETURN", product_id=note.id, model_confidence=0.8, track_id="n1")
    assert r.json()["event"]["state"] == "RETURN_MATCHED"
    finalize(client, staff_headers, shopper.id)
    assert open_discrepancies(client, staff_headers, shopper.id) == []
    pickups = db.scalars(
        select(VisionEvent).where(VisionEvent.session_id == shopper.id, VisionEvent.event_type == "PICKUP")
    ).all()
    assert [p.state for p in pickups] == ["RETURNED"]
    info = db.scalar(select(Discrepancy).where(Discrepancy.session_id == shopper.id))
    assert info.kind == "PICKUP_RETURN" and info.state == "RESOLVED" and not info.blocking


def test_return_after_alert_auto_resolves_it(client, staff_headers, shopper, products):
    note = products["STN-NOTE-A5"]
    vision_event(client, event_type="PICKUP", product_id=note.id, model_confidence=0.9, track_id="n2")
    finalize(client, staff_headers, shopper.id)
    assert len(open_discrepancies(client, staff_headers, shopper.id)) == 1
    vision_event(client, event_type="RETURN", product_id=note.id, model_confidence=0.8, track_id="n2")
    assert open_discrepancies(client, staff_headers, shopper.id) == []


def test_scanned_item_returned_is_advisory_for_customer(client, staff_headers, shopper, products):
    mug = products["HOM-MUG-350"]
    shopper.scan(mug.barcode)
    vision_event(client, event_type="PICKUP", product_id=mug.id, model_confidence=0.9, track_id="m1")
    vision_event(client, event_type="RETURN", product_id=mug.id, model_confidence=0.9, track_id="m1")
    items = open_discrepancies(client, staff_headers, shopper.id)
    assert [(d["kind"], d["blocking"]) for d in items] == [("PICKUP_RETURN", False)]
    assert shopper.preview().json()["eligible"] is True  # advisory does not block
    shopper.respond(items[0]["id"], "REMOVE_RETURNED")
    assert shopper.state()["item_count"] == 0


def test_low_confidence_is_uncertain_and_customer_can_attest(client, staff_headers, shopper, products):
    choc = products["CNF-CHOC-100"]
    shopper.scan(products["BEV-COLA-500"].barcode)
    vision_event(client, event_type="PICKUP", product_id=products["BEV-COLA-500"].id, model_confidence=0.9)
    vision_event(client, event_type="PICKUP", product_id=choc.id, model_confidence=0.41, uncertainty_reason="occluded")
    finalize(client, staff_headers, shopper.id)
    items = open_discrepancies(client, staff_headers, shopper.id)
    assert [d["kind"] for d in items] == ["UNCERTAIN_OBSERVATION"]
    assert shopper.respond(items[0]["id"], "CONFIRM_NOTHING_EXTRA").json()["state"] == "RESOLVED"
    assert shopper.state()["subtotal_paise"] == 4000  # cart untouched


def test_class_level_detection_maps_to_candidate_product(client, staff_headers, shopper, products):
    cola = products["BEV-COLA-500"]
    shopper.scan(cola.barcode)
    r = vision_event(client, event_type="PICKUP", class_label="bottle", model_confidence=0.7)
    ev = r.json()["event"]
    assert ev["recognition_level"] == "CLASS" and ev["candidate_product_ids"] == [cola.id]
    assert ev["state"] == "MATCHED"


def test_unknown_class_is_uncertain(client, staff_headers, shopper):
    vision_event(client, event_type="PICKUP", class_label="handbag", model_confidence=0.9)
    finalize(client, staff_headers, shopper.id)
    assert [d["kind"] for d in open_discrepancies(client, staff_headers, shopper.id)] == ["UNCERTAIN_OBSERVATION"]


def test_conflicting_sensor_evidence_goes_to_staff(client, staff_headers, shopper, products):
    mug = products["HOM-MUG-350"]
    r = client.post("/api/demo/sensor-events", json={"zone_id": "SHELF-A1", "delta_grams": 1}, headers=staff_headers)
    assert r.status_code == 200 and r.json()["is_simulated"] is True
    vision_event(client, event_type="PICKUP", product_id=mug.id, model_confidence=0.85, track_frames=10)
    finalize(client, staff_headers, shopper.id)
    items = open_discrepancies(client, staff_headers, shopper.id)
    assert [(d["kind"], d["state"]) for d in items] == [("CONFLICTING_EVIDENCE", "AWAITING_STAFF")]


def test_camera_disconnect_creates_incomplete_evidence_check(client, staff_headers, shopper):
    r = vision_event(client, event_type="CAMERA_OFFLINE")
    assert r.json()["discrepancy_id"]
    again = vision_event(client, event_type="CAMERA_OFFLINE")
    assert again.json()["discrepancy_id"] is None  # one gap → one check
    vision_event(client, event_type="CAMERA_ONLINE")
    items = open_discrepancies(client, staff_headers, shopper.id)
    assert len(items) == 1 and items[0]["kind"] == "CONFLICTING_EVIDENCE"
    assert "not an indication of wrongdoing" in items[0]["explanation"]


def test_unbound_zone_event_is_unassigned(client, staff_headers):
    client.put("/api/zones/SHELF-A1", json={"session_id": None}, headers=staff_headers)
    r = vision_event(client, event_type="PICKUP", class_label="bottle", model_confidence=0.9)
    assert r.json()["event"]["state"] == "UNASSIGNED"


def test_late_scan_resolves_missed_scan_prompt(client, staff_headers, shopper, products):
    choc = products["CNF-CHOC-100"]
    vision_event(client, event_type="PICKUP", product_id=choc.id, model_confidence=0.9)
    finalize(client, staff_headers, shopper.id)
    shopper.scan(choc.barcode)
    assert open_discrepancies(client, staff_headers, shopper.id) == []


def test_missed_scan_customer_adds_item(client, staff_headers, shopper, products):
    choc = products["CNF-CHOC-100"]
    vision_event(client, event_type="PICKUP", product_id=choc.id, model_confidence=0.9)
    finalize(client, staff_headers, shopper.id)
    d = shopper.state()["discrepancies"][0]
    assert shopper.respond(d["id"], "ADD_TO_CART").json()["state"] == "RESOLVED"
    assert shopper.state()["subtotal_paise"] == 6000


def test_staff_dismisses_false_positive_without_touching_cart(client, db, staff_headers, shopper, products):
    shopper.scan(products["FRT-BANANA-6"].barcode)
    vision_event(
        client, event_type="PICKUP", product_id=products["BEV-COLA-500"].id, model_confidence=0.78, track_frames=6
    )
    finalize(client, staff_headers, shopper.id)
    d = shopper.state()["discrepancies"][0]
    assert d["kind"] == "WRONG_PRODUCT"
    assert shopper.respond(d["id"], "KEEP_SCANNED").json()["state"] == "AWAITING_STAFF"

    r = client.post(f"/api/discrepancies/{d['id']}/staff-resolution", json={"action": "DISMISS"}, headers=staff_headers)
    assert r.status_code == 422  # reason required
    r = client.post(
        f"/api/discrepancies/{d['id']}/staff-resolution",
        json={"action": "DISMISS", "reason": "Shelf count unchanged; shopper only has bananas."},
        headers=staff_headers,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["state"] == "DISMISSED" and body["resolution_code"] == "FALSE_POSITIVE"
    assert [a["action"] for a in body["actions"]] == ["CUSTOMER_DISPUTED", "STAFF_DISMISSED"]
    assert shopper.state()["subtotal_paise"] == 5500
    # Original vision evidence preserved.
    ve = db.get(VisionEvent, body["vision_event_id"])
    assert ve.model_confidence == 0.78 and ve.product_id == products["BEV-COLA-500"].id


def test_staff_actions_require_auth_and_closed_items_are_immutable(client, staff_headers, shopper, products):
    vision_event(client, event_type="PICKUP", product_id=products["CNF-CHOC-100"].id, model_confidence=0.9)
    finalize(client, staff_headers, shopper.id)
    d = shopper.state()["discrepancies"][0]
    url = f"/api/discrepancies/{d['id']}/staff-resolution"
    assert client.post(url, json={"action": "RESOLVE", "reason": "checked"}).status_code == 401
    ok = client.post(
        url,
        json={"action": "RESOLVE", "reason": "Verified at exit", "correction": "ADD_OBSERVED"},
        headers=staff_headers,
    )
    assert ok.status_code == 200 and ok.json()["state"] == "RESOLVED"
    again = client.post(url, json={"action": "DISMISS", "reason": "second try"}, headers=staff_headers)
    assert again.status_code == 409


def test_escalate_and_request_customer(client, staff_headers, shopper, products):
    vision_event(client, event_type="PICKUP", product_id=products["CNF-CHOC-100"].id, model_confidence=0.9)
    finalize(client, staff_headers, shopper.id)
    d = shopper.state()["discrepancies"][0]
    url = f"/api/discrepancies/{d['id']}/staff-resolution"
    assert (
        client.post(url, json={"action": "ESCALATE", "reason": "Needs supervisor"}, headers=staff_headers).json()[
            "state"
        ]
        == "ESCALATED"
    )
    assert (
        client.post(url, json={"action": "REQUEST_CUSTOMER"}, headers=staff_headers).json()["state"]
        == "AWAITING_CUSTOMER"
    )


def test_heartbeat_reports_vision_status(client):
    assert client.get("/api/vision/status").json()["online"] is False
    r = client.post(
        "/api/vision/heartbeat", json={"camera_status": "ONLINE", "model_loaded": True}, headers=VISION_HEADERS
    )
    assert r.status_code == 200
    assert client.get("/api/vision/status").json()["online"] is True
