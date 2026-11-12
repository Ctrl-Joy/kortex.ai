"""Simulated shelf (hosted demo) and idle-session expiry."""

from __future__ import annotations

from datetime import timedelta

from app.core.config import get_settings
from app.core.time import utcnow
from app.models import ShoppingSession
from app.services import sessions


def _enable_shelf(monkeypatch, on: bool = True):
    monkeypatch.setattr(get_settings(), "vision_simulator", on)


def test_shelf_disabled_by_default(shopper, products):
    r = shopper.client.post(
        f"/api/sessions/{shopper.id}/shelf-events",
        json={"product_id": products["BEV-COLA-500"].id},
        headers=shopper.headers,
    )
    assert r.status_code == 403
    assert shopper.state()["simulated_shelf"] is False


def test_shelf_requires_the_session_token(client, shopper, products, monkeypatch):
    _enable_shelf(monkeypatch)
    url = f"/api/sessions/{shopper.id}/shelf-events"
    body = {"product_id": products["BEV-COLA-500"].id}
    assert client.post(url, json=body).status_code == 401
    assert client.post(url, json=body, headers={"X-Session-Token": "nope"}).status_code == 401


def test_shelf_pickup_then_scan_matches(shopper, products, monkeypatch):
    _enable_shelf(monkeypatch)
    cola = products["BEV-COLA-500"]
    r = shopper.client.post(
        f"/api/sessions/{shopper.id}/shelf-events", json={"product_id": cola.id}, headers=shopper.headers
    )
    assert r.status_code == 200, r.text
    event = r.json()["event"]
    assert event["source"] == "SIMULATED" and event["is_simulated"] is True
    assert event["state"] == "OBSERVED"

    state = shopper.state()
    assert state["simulated_shelf"] is True
    assert [p["product_id"] for p in state["pending_pickups"]] == [cola.id]
    assert state["verification"]["status"] == "VERIFYING"

    assert shopper.scan(cola.barcode).status_code == 200
    state = shopper.state()
    assert state["pending_pickups"] == []
    assert state["verification"]["visually_verified_units"] == 1
    assert state["discrepancies"] == []


def test_shelf_pickup_and_return_raises_no_blocker(shopper, products, monkeypatch):
    _enable_shelf(monkeypatch)
    url = f"/api/sessions/{shopper.id}/shelf-events"
    mug = products["HOM-MUG-350"]
    assert shopper.client.post(url, json={"product_id": mug.id}, headers=shopper.headers).status_code == 200
    r = shopper.client.post(url, json={"product_id": mug.id, "event_type": "RETURN"}, headers=shopper.headers)
    assert r.status_code == 200, r.text
    assert r.json()["event"]["state"] == "RETURN_MATCHED"
    state = shopper.state()
    assert state["pending_pickups"] == []
    assert state["verification"]["open_blocking"] == 0


def test_idle_real_session_is_closed_and_alerts_released(client, shopper, products, db, staff_headers, monkeypatch):
    _enable_shelf(monkeypatch)
    choc = products["CNF-CHOC-100"]
    shopper.client.post(
        f"/api/sessions/{shopper.id}/shelf-events", json={"product_id": choc.id}, headers=shopper.headers
    )
    assert client.post(f"/api/sessions/{shopper.id}/reconcile", headers=staff_headers).json()["finalized"] == 1
    assert shopper.state()["verification"]["open_blocking"] == 1

    assert sessions.expire_idle(db, 240) == 0  # still fresh
    row = db.get(ShoppingSession, shopper.id)
    row.last_activity_at = utcnow() - timedelta(hours=5)
    db.commit()
    assert sessions.expire_idle(db, 240) == 1
    db.commit()

    state = shopper.state()
    assert state["session"]["status"] == "CANCELLED"
    assert state["verification"]["open_blocking"] == 0
    zones = client.get("/api/zones", headers=staff_headers).json()
    assert all(z["session_id"] != shopper.id for z in zones)


def test_idle_expiry_keeps_demo_sessions_and_can_be_disabled(client, db, staff_headers):
    demo_id = client.post("/api/demo/sessions", headers=staff_headers).json()["session"]["id"]
    row = db.get(ShoppingSession, demo_id)
    row.last_activity_at = utcnow() - timedelta(days=3)
    db.commit()
    assert sessions.expire_idle(db, 240) == 0
    assert sessions.expire_idle(db, 0) == 0
    db.refresh(row)
    assert row.status == "ACTIVE"


def test_health_reports_simulated_shelf_without_faking_a_camera(client, monkeypatch):
    assert client.get("/api/health").json()["vision"] == {"online": False, "simulated_shelf": False}
    _enable_shelf(monkeypatch)
    assert client.get("/api/health").json()["vision"] == {"online": False, "simulated_shelf": True}
