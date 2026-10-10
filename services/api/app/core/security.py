"""Minimal but real authentication primitives for the local prototype.

* Staff passwords are stored as salted PBKDF2-SHA256 hashes.
* Staff sessions use HMAC-SHA256 signed, expiring bearer tokens.
* Customer shopping sessions are protected by a random per-session token.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
from typing import Any

from app.core.errors import AuthError

_PBKDF2_ITERATIONS = 240_000


def hash_password(password: str, *, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, _PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${_PBKDF2_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        algo, iterations, salt_hex, digest_hex = encoded.split("$")
    except ValueError:
        return False
    if algo != "pbkdf2_sha256":
        return False
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), int(iterations))
    return hmac.compare_digest(digest.hex(), digest_hex)


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


def create_token(payload: dict[str, Any], secret: str, ttl_seconds: int) -> str:
    body = dict(payload)
    body["exp"] = int(time.time()) + ttl_seconds
    raw = _b64(json.dumps(body, separators=(",", ":"), sort_keys=True).encode())
    sig = _b64(hmac.new(secret.encode(), raw.encode(), hashlib.sha256).digest())
    return f"{raw}.{sig}"


def decode_token(token: str, secret: str) -> dict[str, Any]:
    try:
        raw, sig = token.split(".")
    except ValueError as exc:
        raise AuthError("Malformed token") from exc
    expected = _b64(hmac.new(secret.encode(), raw.encode(), hashlib.sha256).digest())
    if not hmac.compare_digest(sig, expected):
        raise AuthError("Invalid token signature")
    payload = json.loads(_unb64(raw))
    if int(payload.get("exp", 0)) < int(time.time()):
        raise AuthError("Token expired")
    return payload


def constant_time_equals(a: str | None, b: str | None) -> bool:
    if not a or not b:
        return False
    return hmac.compare_digest(a.encode(), b.encode())
