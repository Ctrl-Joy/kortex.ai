"""KORTEX AI — FastAPI application entry point."""

from __future__ import annotations

import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.routes import audit, auth, checkout, demo, discrepancies, products, sessions, system, vision
from app.core.config import get_settings
from app.core.errors import DomainError
from app.db import session as db_session
from app.db.init_db import init_db
from app.db.seed import seed_core
from app.services import pipeline
from app.websocket import routes as ws_routes
from app.websocket.hub import hub

log = logging.getLogger("kortex")


async def _sweeper(interval: float) -> None:
    """Finalise pickups whose scan grace window has expired."""

    def tick() -> int:
        with db_session.SessionLocal() as db:
            n = pipeline.finalize_pending(db)
            db.commit()
            return n

    while True:
        try:
            n = await asyncio.to_thread(tick)
            if n:
                log.info("sweeper finalised %d observation(s)", n)
        except Exception:  # pragma: no cover - keep the loop alive
            log.exception("sweeper tick failed")
        await asyncio.sleep(interval)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    init_db()
    with db_session.SessionLocal() as db:
        seed_core(db)
    hub.bind_loop(asyncio.get_running_loop())
    task = None
    if settings.sweep_interval_seconds > 0:
        task = asyncio.create_task(_sweeper(settings.sweep_interval_seconds))
    if settings.uses_insecure_defaults:
        log.warning("KORTEX is running with a development secret key. Set KORTEX_SECRET_KEY in .env.")
    if settings.vision_simulator:
        from vision_simulator import start as start_vision_sim
        start_vision_sim(db_session.SessionLocal)
        log.info("Vision simulator enabled (KORTEX_VISION_SIMULATOR=true)")
    yield
    if task:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
    if settings.vision_simulator:
        from vision_simulator import stop as stop_vision_sim
        stop_vision_sim()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="KORTEX AI API",
        version="1.0.0",
        description=(
            "Scan It. Pick It. Verify It. — Uncertainty-aware scan-and-go reconciliation API "
            "(hackathon prototype; not production-certified)."
        ),
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_origin_regex=settings.cors_origin_regex or None,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type", "X-Session-Token"],
    )

    @app.exception_handler(DomainError)
    async def domain_error(_req: Request, exc: DomainError):
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": {"code": exc.code, "message": exc.message, "details": exc.details}},
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error(_req: Request, exc: RequestValidationError):
        fields = [
            {"field": ".".join(str(p) for p in e["loc"] if p != "body"), "message": e["msg"]} for e in exc.errors()
        ]
        message = fields[0]["message"] if fields else "Invalid request"
        return JSONResponse(
            status_code=422,
            content={"error": {"code": "validation_failed", "message": message, "details": {"fields": fields}}},
        )

    @app.exception_handler(StarletteHTTPException)
    async def http_error(_req: Request, exc: StarletteHTTPException):
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": {"code": f"http_{exc.status_code}", "message": str(exc.detail), "details": {}}},
        )

    for r in (auth, products, sessions, checkout, discrepancies, vision, demo, audit, system):
        app.include_router(r.router)
    app.include_router(ws_routes.router)
    return app


app = create_app()
