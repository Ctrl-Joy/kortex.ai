"""Vision-service settings (read from the repo-root .env)."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[3]
SERVICE_ROOT = Path(__file__).resolve().parents[1]


class VisionSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(REPO_ROOT / ".env"), extra="ignore", populate_by_name=True)

    api_url: str = Field(default="http://127.0.0.1:8000", validation_alias=AliasChoices("KORTEX_API_URL"))
    vision_api_key: str = Field(default="dev-vision-key", validation_alias=AliasChoices("KORTEX_VISION_API_KEY"))
    camera_index: int = Field(default=0, validation_alias=AliasChoices("VISION_CAMERA_INDEX"))
    # Optional network stream (e.g. rtsp://user:pass@cam/stream1). Overrides camera_index.
    camera_url: str | None = Field(default=None, validation_alias=AliasChoices("VISION_CAMERA_URL"))
    frame_width: int = Field(default=640, validation_alias=AliasChoices("VISION_FRAME_WIDTH"))
    frame_height: int = Field(default=480, validation_alias=AliasChoices("VISION_FRAME_HEIGHT"))
    process_fps: float = Field(default=6.0, validation_alias=AliasChoices("VISION_PROCESS_FPS"))
    model: str = Field(default="yolo11n.pt", validation_alias=AliasChoices("VISION_MODEL"))
    zone_id: str = Field(default="SHELF-A1", validation_alias=AliasChoices("VISION_ZONE_ID"))
    port: int = Field(default=8100, validation_alias=AliasChoices("VISION_PORT"))
    conf_threshold: float = Field(default=0.35, validation_alias=AliasChoices("VISION_CONF_THRESHOLD"))
    # Shelf interaction zone in normalised frame coordinates (x0, y0, x1, y1).
    shelf_zone: tuple[float, float, float, float] = Field(
        default=(0.0, 0.0, 0.42, 1.0), validation_alias=AliasChoices("VISION_SHELF_ZONE")
    )
    imgsz: int = Field(default=480, validation_alias=AliasChoices("VISION_IMGSZ"))

    @property
    def model_path(self) -> Path:
        p = Path(self.model)
        return p if p.is_absolute() else SERVICE_ROOT / "models" / p


@lru_cache
def get_settings() -> VisionSettings:
    return VisionSettings()


# Generic COCO classes that plausibly correspond to small retail items. People
# are deliberately NOT tracked: KORTEX does no person or face recognition.
RETAIL_CLASSES = {
    "bottle",
    "cup",
    "wine glass",
    "bowl",
    "banana",
    "apple",
    "orange",
    "sandwich",
    "carrot",
    "donut",
    "cake",
    "book",
    "cell phone",
    "scissors",
    "teddy bear",
    "toothbrush",
    "vase",
    "remote",
    "mouse",
}
