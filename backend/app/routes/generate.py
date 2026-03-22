from __future__ import annotations

import asyncio
import json
import math
import logging
import uuid
from contextlib import suppress
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, StreamingResponse
from pydub import AudioSegment

from ..audio import export_audio, trim_trailing_silence_segment
from ..errors import ApiError
from ..models import GenerationRequest, GenerationResponse, ProgressEvent
from ..services import utc_now

router = APIRouter(tags=["generation"])
logger = logging.getLogger(__name__)


async def _progress_estimator(
    services: object,
    word_count: int,
    stop_event: asyncio.Event,
) -> None:
    total_tokens = max(1, word_count)
    elapsed = 0
    while not stop_event.is_set():
        generated = min(total_tokens, max(1, int(elapsed / 1.25)))
        percent = min(89, 10 + ((generated / total_tokens) * 80))
        await services.progress.publish(
            "progress",
            ProgressEvent(
                status="generating",
                percent=percent,
                tokens_generated=generated,
                tokens_total=total_tokens,
            ),
        )
        elapsed += 1
        await asyncio.sleep(1)


@router.post("/generate", response_model=GenerationResponse)
async def generate_speech(request: Request, payload: GenerationRequest) -> GenerationResponse:
    services = request.app.state.services
    if services.health.status == "error":
        raise ApiError(services.health.error or "model_error", services.health.message or "The model is unavailable.", 503)
    if not services.engine.model_loaded:
        raise ApiError("model_not_loaded", "The model is still loading.", 503)

    voice = await services.db.get_voice(payload.voice_id)
    if not voice:
        raise ApiError("voice_not_found", "That voice could not be found.", 404)

    if services.generation_lock.locked():
        remaining = services.active_generation_estimated_seconds or 45
        raise ApiError(
            "generation_in_progress",
            "A generation is currently in progress. Please wait.",
            429,
            {"estimated_remaining_seconds": remaining},
        )

    settings = await services.db.get_settings()
    output_format = payload.format or settings.get("output_format", "wav")
    sample_rate = payload.sample_rate or int(settings.get("sample_rate", "24000"))
    bit_depth = int(settings.get("bit_depth", "16"))
    custom_output_dir = settings.get("output_directory", "").strip()
    output_dir = Path(custom_output_dir) if custom_output_dir else services.paths.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)

    voice_audio_path = services.db.resolve_relative_path(voice.reference_audio_path)
    if voice_audio_path is None or not voice_audio_path.exists():
        raise ApiError("invalid_audio", "The selected voice is missing its reference audio.", 400)

    async with services.generation_lock:
        services.health.status = "generating"
        services.active_generation_started_at = utc_now()
        services.active_generation_estimated_seconds = max(20, math.ceil(len(payload.text.split()) * 1.2))

        stop_event = asyncio.Event()
        estimator_task = asyncio.create_task(_progress_estimator(services, len(payload.text.split()), stop_event))
        await services.progress.publish("progress", ProgressEvent(status="encoding", percent=5))

        try:
            result = await services.engine.generate_to_wav(
                text=payload.text,
                reference_audio_path=voice_audio_path,
                reference_text=voice.reference_text,
                system_prompt=payload.system_prompt,
                quality=payload.quality,
            )
            services.engine.mark_voice_warmed(voice.id)
            await services.progress.publish("progress", ProgressEvent(status="decoding", percent=90))

            audio = AudioSegment.from_wav(result["wav_path"]).set_frame_rate(sample_rate)
            audio = trim_trailing_silence_segment(audio)

            generation_id = str(uuid.uuid4())
            output_path = output_dir / f"{generation_id}.{output_format}"
            export_start = asyncio.get_running_loop().time()
            export_audio(audio, output_path, output_format, bit_depth)
            export_time = asyncio.get_running_loop().time() - export_start
            logger.info(
                "App generation timing: encode=%.2fs core=%.2fs save_wav=%.2fs export=%.2fs total=%.2fs final_audio=%.2fs final_rtf=%.2fx",
                float(result.get("encode_time_seconds", 0.0)),
                float(result.get("core_generation_time_seconds", result["generation_time_seconds"])),
                float(result.get("wav_save_time_seconds", 0.0)),
                export_time,
                float(result.get("end_to_end_time_seconds", result["generation_time_seconds"])) + export_time,
                len(audio) / 1000,
                result["generation_time_seconds"] / max(len(audio) / 1000, 0.001),
            )

            generation = await services.db.insert_generation(
                {
                    "id": generation_id,
                    "text": payload.text,
                    "voice_id": voice.id,
                    "voice_name": voice.name,
                    "quality": payload.quality,
                    "system_prompt": payload.system_prompt,
                    "output_path": str(output_path.resolve()),
                    "format": output_format,
                    "sample_rate": sample_rate,
                    "duration_seconds": round(len(audio) / 1000, 2),
                    "generation_time_seconds": round(result["generation_time_seconds"], 2),
                    "rtf": round(result["generation_time_seconds"] / max(len(audio) / 1000, 0.001), 2),
                    "char_count": len(payload.text),
                    "word_count": len(payload.text.split()),
                    "created_at": utc_now().isoformat(),
                }
            )
            await services.progress.publish(
                "complete",
                ProgressEvent(status="complete", percent=100, generation_id=generation_id),
            )
            return GenerationResponse(generation=generation)
        finally:
            result_data = locals().get("result")
            if isinstance(result_data, dict):
                wav_path = result_data.get("wav_path")
                if isinstance(wav_path, Path):
                    wav_path.unlink(missing_ok=True)
            stop_event.set()
            estimator_task.cancel()
            with suppress(asyncio.CancelledError):
                await estimator_task
            services.health.status = "ready" if services.engine.model_loaded else "loading"
            services.active_generation_started_at = None
            services.active_generation_estimated_seconds = None


@router.get("/generate/progress")
async def generation_progress(request: Request) -> StreamingResponse:
    services = request.app.state.services
    queue = await services.progress.subscribe()

    async def event_stream() -> object:
        try:
            while True:
                event = await queue.get()
                yield f"event: {event['event']}\ndata: {json.dumps(event['data'])}\n\n"
        finally:
            await services.progress.unsubscribe(queue)

    return StreamingResponse(event_stream(), media_type="text/event-stream")


def _audio_file_response(path: Path, media_type: str, filename: str, inline: bool) -> FileResponse:
    headers = {"Accept-Ranges": "bytes"}
    headers["Content-Disposition"] = f"{'inline' if inline else 'attachment'}; filename=\"{filename}\""
    return FileResponse(path, media_type=media_type, filename=filename, headers=headers)


@router.get("/generate/{generation_id}/audio")
async def stream_generation_audio(request: Request, generation_id: str) -> FileResponse:
    generation = await request.app.state.services.db.get_generation(generation_id)
    if not generation:
        raise ApiError("generation_not_found", "That generation could not be found.", 404)
    media_type = {"wav": "audio/wav", "mp3": "audio/mpeg", "aac": "audio/aac"}[generation.format]
    return _audio_file_response(Path(generation.output_path), media_type, Path(generation.output_path).name, True)


@router.get("/generate/{generation_id}/download")
async def download_generation_audio(request: Request, generation_id: str) -> FileResponse:
    generation = await request.app.state.services.db.get_generation(generation_id)
    if not generation:
        raise ApiError("generation_not_found", "That generation could not be found.", 404)
    media_type = {"wav": "audio/wav", "mp3": "audio/mpeg", "aac": "audio/aac"}[generation.format]
    safe_voice = generation.voice_name.lower().replace(" ", "-")
    timestamp = generation.created_at.strftime("%Y%m%d-%H%M%S")
    filename = f"foundry-vox-{safe_voice}-{timestamp}.{generation.format}"
    return _audio_file_response(Path(generation.output_path), media_type, filename, False)
