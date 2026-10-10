"""Persisted prototype settings (reconciliation policy, zone bindings)."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.core.errors import ValidationFailed
from app.models import SystemSetting
from app.services.policy import POLICY_BOUNDS, Policy

POLICY_KEY = "reconciliation_policy"


def load_policy(db: Session) -> Policy:
    row = db.get(SystemSetting, POLICY_KEY)
    return Policy.from_overrides(row.value if row else None)


def update_policy(db: Session, changes: dict[str, Any], *, updated_by: str) -> Policy:
    current = load_policy(db).to_dict()
    defaults = Policy().to_dict()
    for key, value in changes.items():
        if key not in defaults:
            raise ValidationFailed(f"Unknown policy setting '{key}'")
        expected = type(defaults[key])
        if expected is bool:
            if not isinstance(value, bool):
                raise ValidationFailed(f"'{key}' must be true or false")
        else:
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise ValidationFailed(f"'{key}' must be a number")
            lo, hi = POLICY_BOUNDS.get(key, (float("-inf"), float("inf")))
            if not lo <= value <= hi:
                raise ValidationFailed(f"'{key}' must be between {lo} and {hi}")
            value = int(value) if expected is int else float(value)
        current[key] = value
    if not current["noise_floor"] <= current["uncertain_threshold"] <= current["mismatch_threshold"]:
        raise ValidationFailed("Thresholds must satisfy noise_floor ≤ uncertain_threshold ≤ mismatch_threshold")
    policy = Policy.from_overrides(current)
    row = db.get(SystemSetting, POLICY_KEY)
    overrides = {k: v for k, v in policy.to_dict().items() if v != defaults[k]}
    if row is None:
        db.add(SystemSetting(key=POLICY_KEY, value=overrides, updated_by=updated_by))
    else:
        row.value = overrides
        row.updated_by = updated_by
    db.flush()
    return policy


def reset_policy(db: Session, *, updated_by: str) -> Policy:
    row = db.get(SystemSetting, POLICY_KEY)
    if row is not None:
        row.value = {}
        row.updated_by = updated_by
        db.flush()
    return Policy()
