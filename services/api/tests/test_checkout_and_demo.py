from __future__ import annotations

import pytest
from sqlalchemy import select

from app.db.session import SessionLocal
from app.models import AuditEvent, CheckoutRecord
from app.services import demo
from tests.conftest import vision_event


def test_checkout_denied_with_unresolved_discrepancy(client, db, staff_headers, shopper, products):
    shopper.scan(products["CNF-CHOC-100"].barcode)
    vision_event(client, event_type="PICKUP", product_id=products["CNF-CHOC-100"].id, model_confidence=0.9)
    vision_event(
        client, event_type="PICKUP", product_id=products["BEV-COLA-500"].id, model_confidence=0.9, track_frames=10
    )
    r = shopper.checkout()
    assert r.status_code == 409
    err = r.json()["error"]
    assert err["code"] == "checkout_blocked"
    assert any(b["code"] == "UNRESOLVED_DISCREPANCY" for b in err["details"]["blockers"])
    assert db.scalar(
        select(AuditEvent).where(AuditEvent.event_type == "CHECKOUT_DENIED", AuditEvent.session_id == shopper.id)
    )
    assert shopper.state()["session"]["status"] == "ACTIVE"


def test_empty_cart_cannot_check_out(shopper):
    r = shopper.checkout()
    assert r.status_code == 409
    assert r.json()["error"]["details"]["blockers"][0]["code"] == "EMPTY_CART"


def test_checkout_authorized_after_resolution_with_catalogue_prices(client, staff_headers, shopper, products):
    cola, choc = products["BEV-COLA-500"], products["CNF-CHOC-100"]
    shopper.scan(cola.barcode)
    vision_event(client, event_type="PICKUP", product_id=choc.id, model_confidence=0.87, track_frames=10)
    preview = shopper.preview().json()
    assert preview["eligible"] is False
    d = shopper.state()["discrepancies"][0]
    shopper.respond(d["id"], "REPLACE_ITEM")
    preview = shopper.preview().json()
    assert preview["eligible"] is True and preview["total_paise"] == 6000

    # A price change before checkout is honoured: totals always come from the catalogue.
    client.patch(f"/api/products/{choc.id}", json={"price_paise": 6500}, headers=staff_headers)
    r = shopper.checkout()
    assert r.status_code == 201, r.text
    rec = r.json()
    assert rec["total_paise"] == 6500 and rec["payment_mode"] == "SIMULATED"
    assert rec["lines"] == [
        {
            "product_id": choc.id,
            "sku": choc.sku,
            "barcode": choc.barcode,
            "name": choc.name,
            "quantity": 1,
            "unit_price_paise": 6500,
            "line_total_paise": 6500,
        }
    ]
    # cart is locked after authorization
    assert shopper.scan(cola.barcode).status_code == 409


def test_repeated_checkout_is_idempotent(client, db, shopper, products):
    shopper.scan(products["BEV-COLA-500"].barcode)
    first = shopper.checkout()
    second = shopper.checkout()
    assert first.status_code == 201 and second.status_code == 200
    assert first.json()["id"] == second.json()["id"]
    assert len(db.scalars(select(CheckoutRecord).where(CheckoutRecord.session_id == shopper.id)).all()) == 1


def test_exit_confirmation_is_simulated_and_idempotent(client, shopper, products):
    shopper.scan(products["BEV-COLA-500"].barcode)
    assert client.post(f"/api/sessions/{shopper.id}/exit", headers=shopper.headers).status_code == 409
    shopper.checkout()
    r1 = client.post(f"/api/sessions/{shopper.id}/exit", headers=shopper.headers)
    r2 = client.post(f"/api/sessions/{shopper.id}/exit", headers=shopper.headers)
    assert r1.status_code == r2.status_code == 200
    assert r1.json()["status"] == "EXITED"
    assert shopper.state()["session"]["status"] == "EXITED"


def test_session_detail_shows_original_and_corrected_cart(client, staff_headers, shopper, products):
    cola, choc = products["BEV-COLA-500"], products["CNF-CHOC-100"]
    shopper.scan(cola.barcode)
    vision_event(client, event_type="PICKUP", product_id=choc.id, model_confidence=0.87)
    client.post(f"/api/sessions/{shopper.id}/reconcile", headers=staff_headers)
    shopper.respond(shopper.state()["discrepancies"][0]["id"], "REPLACE_ITEM")
    r = client.get(f"/api/sessions/{shopper.id}", headers=staff_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["scanned_cart"]["subtotal_paise"] == 4000
    assert body["subtotal_paise"] == 6000
    assert len(body["corrections"]) == 1
    assert body["eligibility"]["eligible"] is True


def test_session_list_and_overview_stats(client, staff_headers, shopper, products):
    shopper.scan(products["BEV-COLA-500"].barcode)
    r = client.get("/api/sessions?limit=5", headers=staff_headers)
    assert r.status_code == 200 and r.json()["total"] >= 1
    row = r.json()["items"][0]
    assert row["subtotal_paise"] == 4000 and row["checkout_status"] == "ELIGIBLE"
    stats = client.get("/api/stats/overview", headers=staff_headers).json()
    assert stats["kpis"]["active_sessions"] >= 1
    assert len(stats["activity"]) == 7


def test_audit_listing_is_paginated(client, staff_headers, shopper, products):
    shopper.scan(products["BEV-COLA-500"].barcode)
    r = client.get(f"/api/audit?session_id={shopper.id}&limit=2", headers=staff_headers)
    assert r.status_code == 200
    body = r.json()
    assert len(body["items"]) == 2 and body["total"] >= 3


@pytest.mark.parametrize(
    "code,expected",
    [
        ("A", {"open": [], "checked_out": True}),
        ("B", {"open": [], "checked_out": False}),
        ("C", {"open": [], "checked_out": False}),
        ("D", {"open": [], "checked_out": False}),
        ("E", {"open": [], "checked_out": False}),
        ("F", {"open": [], "checked_out": False}),
        ("G", {"open": [], "checked_out": True}),
        ("H", {"open": [], "checked_out": True}),
    ],
)
def test_demo_scenarios_run_end_to_end(client, db, code, expected):
    run = demo.start_run(
        code, session_factory=SessionLocal, fast=True, auto_complete=True, step_delay_s=0, background=False
    )
    assert run.status == "COMPLETED", run.steps
    assert all(s["status"] == "DONE" for s in run.steps)
    from app.services import discrepancies

    assert [d.kind for d in discrepancies.open_for_session(db, run.session_id)] == expected["open"]
    has_record = db.scalar(select(CheckoutRecord).where(CheckoutRecord.session_id == run.session_id)) is not None
    assert has_record is expected["checked_out"]


def test_scenario_specific_outcomes(client, db):
    from app.models import Discrepancy

    def kinds(code):
        run = demo.start_run(
            code, session_factory=SessionLocal, fast=True, auto_complete=False, step_delay_s=0, background=False
        )
        assert run.status in ("COMPLETED", "WAITING_FOR_PRESENTER"), run.steps
        return run, sorted(
            d.kind for d in db.scalars(select(Discrepancy).where(Discrepancy.session_id == run.session_id))
        )

    assert kinds("A")[1] == []
    assert kinds("B")[1] == ["MISSED_SCAN"]
    assert kinds("C")[1] == ["WRONG_PRODUCT"]
    assert kinds("D")[1] == ["PICKUP_RETURN"]
    assert kinds("E")[1] == ["CONFLICTING_EVIDENCE", "UNCERTAIN_OBSERVATION"]
    run_g, g = kinds("G")
    assert g == ["MISSED_SCAN"]
    assert "BLOCKED" in run_g.steps[6]["detail"]
    run_h, h = kinds("H")
    assert run_h.status == "COMPLETED" and h == ["WRONG_PRODUCT"]


def test_demo_endpoints_require_staff(client):
    assert client.post("/api/demo/scenarios", json={"scenario": "A"}).status_code == 401
    assert client.post("/api/demo/vision-events", json={"event_type": "PICKUP"}).status_code == 401


def test_simulated_events_are_labelled(client, staff_headers, shopper, products):
    r = client.post(
        "/api/demo/vision-events",
        json={"event_type": "PICKUP", "product_id": products["BEV-COLA-500"].id, "model_confidence": 0.9},
        headers=staff_headers,
    )
    assert r.status_code == 200
    ev = r.json()["event"]
    assert ev["source"] == "SIMULATED" and ev["is_simulated"] is True



def test_sensor_reading_of_another_session_is_not_evidence(client, staff_headers, products):
    """Regression: a weight reading attributed to session X must not affect session Y."""
    from tests.conftest import Shopper

    x = Shopper(client)
    y = Shopper(client)  # creating y re-binds the zone to y
    r = client.post(
        "/api/demo/sensor-events",
        json={"zone_id": "SHELF-A1", "delta_grams": 2, "session_id": x.id},
        headers=staff_headers,
    )
    assert r.status_code == 200
    y.scan(products["FRT-BANANA-6"].barcode)
    vision_event(client, event_type="PICKUP", product_id=products["BEV-COLA-500"].id, model_confidence=0.78, track_frames=6)
    client.post(f"/api/sessions/{y.id}/reconcile", headers=staff_headers)
    kinds = [d["kind"] for d in y.state()["discrepancies"]]
    assert kinds == ["WRONG_PRODUCT"]  # not CONFLICTING_EVIDENCE caused by x's reading
