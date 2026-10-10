from __future__ import annotations

from app.services import barcode


def test_barcode_check_digits():
    assert barcode.classify("4006381333931") == "EAN-13"
    assert barcode.classify("96385074") == "EAN-8"
    assert barcode.classify("036000291452") == "UPC-A"
    assert barcode.classify("04252614") == "UPC-E"
    assert barcode.classify("4006381333932") is None
    assert barcode.classify("abc") is None
    assert barcode.with_check_digit("400638133393") == "4006381333931"


def test_seeded_catalogue_has_five_valid_products(client):
    r = client.get("/api/products")
    assert r.status_code == 200
    items = r.json()
    assert len(items) == 5
    assert all(barcode.is_valid(p["barcode"]) for p in items)
    assert all(isinstance(p["price_paise"], int) and p["price_paise"] > 0 for p in items)


def test_product_crud_requires_staff(client):
    r = client.post("/api/products", json={})
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "unauthorized"


def _new_product(**overrides):
    body = {
        "sku": "TST-WATER-1L",
        "barcode": barcode.with_check_digit("890100100099"),
        "name": "Mineral Water 1 L",
        "category": "Beverages",
        "price_paise": 2000,
    }
    body.update(overrides)
    return body


def test_product_create_update_delete(client, staff_headers):
    r = client.post("/api/products", json=_new_product(), headers=staff_headers)
    assert r.status_code == 201, r.text
    pid = r.json()["id"]
    r = client.patch(f"/api/products/{pid}", json={"price_paise": 2500, "active": False}, headers=staff_headers)
    assert r.status_code == 200 and r.json()["price_paise"] == 2500 and r.json()["active"] is False
    assert all(p["id"] != pid for p in client.get("/api/products").json())  # inactive hidden from customers
    assert client.delete(f"/api/products/{pid}", headers=staff_headers).status_code == 204


def test_duplicate_barcode_and_sku_rejected(client, staff_headers, products):
    cola = products["BEV-COLA-500"]
    r = client.post("/api/products", json=_new_product(barcode=cola.barcode), headers=staff_headers)
    assert r.status_code == 409 and r.json()["error"]["code"] == "duplicate_barcode"
    r = client.post("/api/products", json=_new_product(sku="bev-cola-500"), headers=staff_headers)
    assert r.status_code == 409 and r.json()["error"]["code"] == "duplicate_sku"


def test_invalid_price_and_barcode_and_missing_fields(client, staff_headers):
    assert client.post("/api/products", json=_new_product(price_paise=0), headers=staff_headers).status_code == 422
    assert client.post("/api/products", json=_new_product(price_paise=-5), headers=staff_headers).status_code == 422
    assert (
        client.post("/api/products", json=_new_product(barcode="1234567890123"), headers=staff_headers).status_code
        == 422
    )
    body = _new_product()
    del body["name"]
    r = client.post("/api/products", json=body, headers=staff_headers)
    assert r.status_code == 422
    assert r.json()["error"]["details"]["fields"][0]["field"] == "name"


def test_product_in_use_cannot_be_deleted(client, staff_headers, shopper, products):
    cola = products["BEV-COLA-500"]
    shopper.scan(cola.barcode)
    r = client.delete(f"/api/products/{cola.id}", headers=staff_headers)
    assert r.status_code == 409 and r.json()["error"]["code"] == "product_in_use"


def test_attendant_cannot_change_policy(client, attendant_headers):
    r = client.put("/api/settings/policy", json={"values": {"scan_grace_s": 30}}, headers=attendant_headers)
    assert r.status_code == 403


def test_policy_update_validates_bounds(client, staff_headers):
    r = client.put("/api/settings/policy", json={"values": {"noise_floor": 0.9}}, headers=staff_headers)
    assert r.status_code == 422
    r = client.put("/api/settings/policy", json={"values": {"scan_grace_s": 30}}, headers=staff_headers)
    assert r.status_code == 200 and r.json()["values"]["scan_grace_s"] == 30
