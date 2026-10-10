from __future__ import annotations

from fastapi import APIRouter, Query, Response
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError

from app.api import serializers as ser
from app.api.deps import DB, Staff, staff_actor
from app.core.errors import ConflictError, NotFoundError
from app.models import CartItem, Product, ScanEvent
from app.schemas.api import ProductCreate, ProductOut, ProductUpdate
from app.services import audit
from app.services import barcode as barcode_rules

router = APIRouter(prefix="/api/products", tags=["products"])


def _get(db, product_id: str) -> Product:
    p = db.get(Product, product_id)
    if p is None:
        raise NotFoundError(f"Product {product_id} not found")
    return p


def _check_unique(db, *, sku: str | None, code: str | None, exclude_id: str | None = None) -> None:
    if sku:
        q = select(Product).where(func.lower(Product.sku) == sku.lower())
        if exclude_id:
            q = q.where(Product.id != exclude_id)
        if db.scalar(q) is not None:
            raise ConflictError(f"SKU {sku} already exists", code="duplicate_sku", details={"field": "sku"})
    if code:
        q = select(Product).where(Product.barcode == code)
        if exclude_id:
            q = q.where(Product.id != exclude_id)
        if db.scalar(q) is not None:
            raise ConflictError(
                f"Barcode {code} is already assigned to another product",
                code="duplicate_barcode",
                details={"field": "barcode"},
            )


@router.get("", response_model=list[ProductOut])
def list_products(
    db: DB,
    q: str | None = Query(default=None, max_length=80),
    include_inactive: bool = False,
) -> list[ProductOut]:
    stmt = select(Product).order_by(Product.name)
    if not include_inactive:
        stmt = stmt.where(Product.active.is_(True))
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                Product.name.ilike(like),
                Product.sku.ilike(like),
                Product.barcode.like(like),
                Product.category.ilike(like),
            )
        )
    return [ser.product(p) for p in db.scalars(stmt.limit(200))]


@router.get("/barcode/{code}", response_model=ProductOut)
def by_barcode(code: str, db: DB) -> ProductOut:
    code = barcode_rules.normalise(code)
    p = db.scalar(select(Product).where(Product.barcode == code))
    if p is None or not p.active:
        raise NotFoundError("This barcode is not in the store catalogue", code="unknown_barcode")
    return ser.product(p)


@router.get("/{product_id}", response_model=ProductOut)
def get_product(product_id: str, db: DB) -> ProductOut:
    return ser.product(_get(db, product_id))


@router.post("", response_model=ProductOut, status_code=201)
def create_product(body: ProductCreate, db: DB, staff: Staff) -> ProductOut:
    _check_unique(db, sku=body.sku, code=body.barcode)
    p = Product(**body.model_dump())
    db.add(p)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise ConflictError("Product conflicts with an existing SKU or barcode") from exc
    audit.record(
        db,
        actor=staff_actor(staff),
        event_type="PRODUCT_CREATED",
        summary=f"Product {p.name} ({p.sku}) created.",
        entity_type="product",
        entity_id=p.id,
        details=body.model_dump(),
    )
    db.commit()
    return ser.product(p)


@router.patch("/{product_id}", response_model=ProductOut)
def update_product(product_id: str, body: ProductUpdate, db: DB, staff: Staff) -> ProductOut:
    p = _get(db, product_id)
    changes = body.model_dump(exclude_unset=True)
    for required in ("sku", "barcode", "name", "category", "price_paise"):
        if required in changes and changes[required] is None:
            raise ConflictError(f"{required} cannot be empty", code="validation_failed")
    _check_unique(db, sku=changes.get("sku"), code=changes.get("barcode"), exclude_id=p.id)
    before = {k: getattr(p, k) for k in changes}
    for k, v in changes.items():
        setattr(p, k, v)
    audit.record(
        db,
        actor=staff_actor(staff),
        event_type="PRODUCT_UPDATED",
        summary=f"Product {p.name} updated.",
        entity_type="product",
        entity_id=p.id,
        details={"before": before, "after": changes},
    )
    db.commit()
    return ser.product(p)


@router.delete("/{product_id}", status_code=204)
def delete_product(product_id: str, db: DB, staff: Staff) -> Response:
    p = _get(db, product_id)
    referenced = db.scalar(select(ScanEvent.id).where(ScanEvent.product_id == p.id).limit(1)) or db.scalar(
        select(CartItem.id).where(CartItem.product_id == p.id).limit(1)
    )
    if referenced:
        raise ConflictError(
            "This product appears in shopping history and cannot be deleted. Deactivate it instead.",
            code="product_in_use",
        )
    audit.record(
        db,
        actor=staff_actor(staff),
        event_type="PRODUCT_DELETED",
        summary=f"Product {p.name} deleted.",
        entity_type="product",
        entity_id=p.id,
    )
    db.delete(p)
    db.commit()
    return Response(status_code=204)
