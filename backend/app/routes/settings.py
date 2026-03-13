from __future__ import annotations

import asyncio
import os
from pathlib import Path

from fastapi import APIRouter, Request

from ..audio import ensure_writable_directory
from ..config import default_output_directory
from ..errors import ApiError
from ..models import DirectoryChoiceResponse, PatchSettingsRequest, SettingsResponse

router = APIRouter(prefix="/settings", tags=["settings"])


def _coerce_settings(settings: dict[str, str]) -> SettingsResponse:
    return SettingsResponse(
        model=settings.get("model", "tada-1b"),
        cpu_threads=int(settings.get("cpu_threads", "6")),
        output_format=settings.get("output_format", "wav"),
        sample_rate=int(settings.get("sample_rate", "24000")),
        bit_depth=int(settings.get("bit_depth", "16")),
        output_directory=settings.get("output_directory", default_output_directory()),
        warmup_on_launch=settings.get("warmup_on_launch", "true").lower() == "true",
    )


@router.get("", response_model=SettingsResponse)
async def get_settings(request: Request) -> SettingsResponse:
    settings = await request.app.state.services.db.get_settings()
    return _coerce_settings(settings)


@router.patch("", response_model=SettingsResponse)
async def patch_settings(request: Request, payload: PatchSettingsRequest) -> SettingsResponse:
    services = request.app.state.services
    current = await services.db.get_settings()
    changes = payload.model_dump(exclude_none=True)

    if "cpu_threads" in changes:
        cpu_count = os.cpu_count() or 1
        if not 1 <= changes["cpu_threads"] <= cpu_count:
            raise ApiError(
                "invalid_setting", f"cpu_threads must be between 1 and {cpu_count}.", 400
            )

    if "output_directory" in changes:
        ensure_writable_directory(Path(changes["output_directory"]).expanduser())

    new_values = {
        key: str(value).lower() if isinstance(value, bool) else str(value)
        for key, value in changes.items()
    }
    settings = await services.db.update_settings(new_values)

    requires_reload = any(key in changes for key in ("model", "cpu_threads"))
    if requires_reload:
        services.engine.configure(
            model_name=settings.get("model", current.get("model", "tada-1b")),
            num_threads=int(settings.get("cpu_threads", current.get("cpu_threads", "6"))),
        )
        services.health.status = "loading"
        services.health.error = None
        services.health.message = None
        asyncio.create_task(request.app.state.reload_engine())

    return _coerce_settings(settings)


@router.post("/choose-directory", response_model=DirectoryChoiceResponse)
async def choose_directory() -> DirectoryChoiceResponse:
    raise ApiError(
        "model_error",
        "Native directory selection is handled by the macOS app shell. This endpoint is unavailable in headless mode.",
        501,
    )
