from __future__ import annotations

import os
import tempfile
import uuid
from collections.abc import Iterator
from pathlib import Path

import pytest

_TMP = Path(tempfile.mkdtemp(prefix="kortex-tests-"))
os.environ["KORTEX_DATABASE_URL"] = f"sqlite:///{(_TMP / 'bootstrap.db').as_posix()}"
os.environ["KORTEX_SECRET_KEY"] = "test-secret-key-for-pytest-only"
os.environ["KORTEX_VISION_API_KEY"] = "test-vision-key"
os.environ["KORTEX_SEED_STAFF_PASSWORD"] = "test-staff-pw"
os.environ["KORTEX_SWEEP_INTERVAL_SECONDS"] = "0"

from fastapi.testclient import TestClient  # noqa: E402

from app.core.config import get_settings  # noqa: E402

get_settings.cache_clear()

from app.db import session as db_session  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.db.seed import seed_core  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models import Product  # noqa: E402

VISION_HEADERS = {"X-Vision-Key": "test-vision-key"}


@pytest.fixture()
def engine():
    path = _TMP / f"test-{uuid.uuid4().hex}.db"
    eng = db_session.build_engine(f"sqlite:///{path.as_posix()}")
    db_session.configure(eng)
    Base.metadata.create_all(eng)
    with db_session.SessionLocal() as db:
        seed_core(db)
    yield eng
    eng.dispose()


@pytest.fixture()
def db(engine) -> Iterator:
    s = db_session.SessionLocal()
    try:
        yield s
    finally:
        s.close()


@pytest.fixture()
def client(engine) -> Iterator[TestClient]:
    with TestClient(create_app()) as c:
        yield c


@pytest.fixture()
def staff_headers(client) -> dict[str, str]:
    r = client.post("/api/auth/login", json={"username": "manager", "password": "test-staff-pw"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture()
def attendant_headers(client) -> dict[str, str]:
    r = client.post("/api/auth/login", json={"username": "attendant", "password": "test-staff-pw"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture()
def products(db) -> dict[str, Product]:
    from sqlalchemy import select

    return {p.sku: p for p in db.scalars(select(Product))}


class Shopper:
    """Small helper around the customer API."""

    def __init__(self, client: TestClient):
        self.client = client
        r = client.post("/api/sessions", json={})
        assert r.status_code == 201, r.text
        body = r.json()
        self.id: str = body["session"]["id"]
        self.headers = {"X-Session-Token": body["customer_token"]}

    def scan(self, code: str, **kw):
        return self.client.post(f"/api/sessions/{self.id}/scans", json={"barcode": code, **kw}, headers=self.headers)

    def state(self):
        r = self.client.get(f"/api/sessions/{self.id}/state", headers=self.headers)
        assert r.status_code == 200, r.text
        return r.json()

    def preview(self):
        return self.client.get(f"/api/sessions/{self.id}/checkout/preview", headers=self.headers)

    def checkout(self):
        return self.client.post(f"/api/sessions/{self.id}/checkout", headers=self.headers)

    def respond(self, discrepancy_id: str, option: str):
        return self.client.post(
            f"/api/discrepancies/{discrepancy_id}/customer-resolution", json={"option": option}, headers=self.headers
        )


@pytest.fixture()
def shopper(client) -> Shopper:
    return Shopper(client)


def vision_event(client: TestClient, **payload):
    payload.setdefault("event_id", uuid.uuid4().hex)
    payload.setdefault("zone_id", "SHELF-A1")
    return client.post("/api/vision/events", json=payload, headers=VISION_HEADERS)
