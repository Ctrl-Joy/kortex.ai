"""Human-readable, prefixed identifiers (e.g. SES-7K3P9Q2M)."""

from __future__ import annotations

import secrets

_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"  # no 0/O/1/I/L ambiguity


def new_id(prefix: str, length: int = 10) -> str:
    body = "".join(secrets.choice(_ALPHABET) for _ in range(length))
    return f"{prefix}-{body}"


def new_token() -> str:
    return secrets.token_urlsafe(32)
