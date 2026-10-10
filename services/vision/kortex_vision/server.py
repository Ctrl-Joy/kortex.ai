"""HTTP interface of the vision service: MJPEG preview, status, camera control."""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field

from kortex_vision.camera import enumerate_cameras
from kortex_vision.config import get_settings
from kortex_vision.service import VisionService

log = logging.getLogger("kortex.vision.server")


class CameraSwitch(BaseModel):
    index: int = Field(ge=0, le=10)


def create_app(service: VisionService | None = None) -> FastAPI:
    holder: dict[str, VisionService] = {}

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        svc = service or VisionService(get_settings())
        holder["svc"] = svc
        svc.start()
        yield
        svc.stop()

    app = FastAPI(title="KORTEX Vision Service", version="1.0.0", lifespan=lifespan)

    @app.get("/status")
    def status() -> dict:
        svc = holder["svc"]
        return {
            **svc.status(),
            "events_emitted": svc.events_emitted,
            "events_sent": svc.publisher.sent,
            "events_failed": svc.publisher.failed,
            "last_error": svc.publisher.last_error,
            "recent_events": svc.publisher.recent[:10],
            "privacy": "Frames are processed in memory and never written to disk. No person or face recognition.",
        }

    @app.get("/cameras")
    def cameras() -> list[dict]:
        return enumerate_cameras()

    @app.post("/camera")
    def switch(body: CameraSwitch) -> dict:
        holder["svc"].camera.switch(body.index)
        return {"ok": True, "index": body.index}

    @app.post("/camera/pause")
    def pause() -> dict:
        """Release the webcam so another app (e.g. the browser barcode scanner) can use it."""
        holder["svc"].camera.pause()
        return {"ok": True, "camera_status": holder["svc"].camera.status}

    @app.post("/camera/resume")
    def resume() -> dict:
        holder["svc"].camera.resume()
        return {"ok": True, "camera_status": holder["svc"].camera.status}

    @app.get("/snapshot.jpg")
    def snapshot() -> Response:
        jpg = holder["svc"].latest_jpeg(wait=1.0)
        if jpg is None:
            raise HTTPException(503, "No frame yet")
        return Response(jpg, media_type="image/jpeg", headers={"Cache-Control": "no-store"})

    @app.get("/stream.mjpg")
    async def stream() -> StreamingResponse:
        svc = holder["svc"]

        async def frames():
            while True:
                jpg = await asyncio.to_thread(svc.latest_jpeg, 1.0)
                if jpg:
                    yield b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: " + str(len(jpg)).encode() + b"\r\n\r\n" + jpg + b"\r\n"
                await asyncio.sleep(0.05)

        return StreamingResponse(
            frames(), media_type="multipart/x-mixed-replace; boundary=frame", headers={"Cache-Control": "no-store"}
        )

    return app


def main() -> None:  # pragma: no cover
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    s = get_settings()
    log.info("Starting KORTEX vision on :%s (camera %s, model %s, API %s)", s.port, s.camera_index, s.model_path.name, s.api_url)
    uvicorn.run(create_app(), host="127.0.0.1", port=s.port, log_level="warning")


if __name__ == "__main__":  # pragma: no cover
    main()
