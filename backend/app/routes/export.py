from __future__ import annotations

import tempfile
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from ..audio import concatenate_audio, create_zip_archive, export_audio
from ..errors import ApiError
from ..models import ExportBatchRequest

router = APIRouter(prefix="/export", tags=["export"])


@router.post("/batch")
async def export_batch(request: Request, payload: ExportBatchRequest) -> FileResponse:
    services = request.app.state.services
    generations = []
    for generation_id in payload.generation_ids:
        generation = await services.db.get_generation(generation_id)
        if not generation:
            raise ApiError(
                "generation_not_found", f"Generation {generation_id} was not found.", 404
            )
        generations.append(generation)

    if payload.mode == "zip":
        temp_path = Path(tempfile.mkdtemp()) / (payload.filename or "foundry-vox-export.zip")
        archive = create_zip_archive(
            [(Path(g.output_path), Path(g.output_path).name) for g in generations],
            temp_path,
        )
        return FileResponse(
            archive,
            media_type="application/zip",
            filename=archive.name,
            background=BackgroundTask(lambda: archive.unlink(missing_ok=True)),
        )

    combined = await concatenate_audio(
        [Path(g.output_path) for g in generations],
        pause_seconds=payload.pause_seconds,
        sample_rate=generations[0].sample_rate if generations else 24_000,
    )
    temp_dir = Path(tempfile.mkdtemp())
    temp_path = temp_dir / (payload.filename or f"foundry-vox-batch.{payload.format}")
    export_audio(combined, temp_path, payload.format, 16)
    media_type = {"wav": "audio/wav", "mp3": "audio/mpeg", "aac": "audio/aac"}[payload.format]
    return FileResponse(
        temp_path,
        media_type=media_type,
        filename=temp_path.name,
        background=BackgroundTask(lambda: temp_path.unlink(missing_ok=True)),
    )
