from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, TypeDecorator
from sqlalchemy.orm import DeclarativeBase

from app.core.time import ensure_utc


class UTCDateTime(TypeDecorator[datetime]):
    """Stores datetimes as UTC and always returns timezone-aware UTC values.

    SQLite has no native timezone support, so values are normalised on the way
    in and re-tagged as UTC on the way out.
    """

    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect):  # type: ignore[override]
        if value is None:
            return None
        return ensure_utc(value).replace(tzinfo=None)

    def process_result_value(self, value: datetime | None, dialect):  # type: ignore[override]
        if value is None:
            return None
        return ensure_utc(value)


class Base(DeclarativeBase):
    pass
