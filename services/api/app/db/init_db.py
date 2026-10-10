"""Schema initialisation.

The prototype uses `create_all`, which is idempotent and preserves existing
data. A production deployment would switch to Alembic migrations.
"""

from __future__ import annotations

from app import models  # noqa: F401 - register models
from app.db import session as db_session
from app.db.base import Base


def init_db() -> None:
    Base.metadata.create_all(bind=db_session.engine)
