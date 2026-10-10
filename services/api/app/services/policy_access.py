"""Per-transaction cached access to the persisted policy."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.services.policy import Policy
from app.services.settings_store import load_policy


def current_policy(db: Session) -> Policy:
    cached = db.info.get("policy")
    if cached is None:
        cached = load_policy(db)
        db.info["policy"] = cached
    return cached


def invalidate(db: Session) -> None:
    db.info.pop("policy", None)
