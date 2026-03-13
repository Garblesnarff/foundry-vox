from __future__ import annotations

import json
import tempfile
import uuid
from pathlib import Path

from fastapi import APIRouter, File, Form, Request, UploadFile
from fastapi.responses import FileResponse
from pydub import AudioSegment
from starlette.background import BackgroundTask

from ..audio import trim_trailing_silence_segment, validate_reference_audio
from ..errors import ApiError
from ..models import UpdateVoiceRequest, VoiceCloneResponse, VoiceListResponse, VoiceResponse
from ..services import utc_now

router = APIRouter(prefix="/voices", tags=["voices"])


def _ensure_voice(voice: object | None) -> object:
    if voice is None:
        raise ApiError("voice_not_found", "That voice could not be found.", 404)
    return voice


@router.get("", response_model=VoiceListResponse)
async def list_voices(request: Request, type: str | None = None) -> VoiceListResponse:
    voices = await request.app.state.services.db.list_voices(type)
    return VoiceListResponse(voices=voices)


@router.get("/{voice_id}", response_model=VoiceResponse)
async def get_voice(request: Request, voice_id: str) -> VoiceResponse:
    voice = _ensure_voice(await request.app.state.services.db.get_voice(voice_id))
    return VoiceResponse(voice=voice)


@router.post("/clone", response_model=VoiceCloneResponse)
async def clone_voice(
    request: Request,
    name: str = Form(...),
    audio: UploadFile = File(...),
    gender: str | None = Form(default=None),
    color: str | None = Form(default=None),
    tags: str | None = Form(default=None),
    transcript: str = Form(...),
) -> VoiceCloneResponse:
    services = request.app.state.services
    voice_id = str(uuid.uuid4())
    clone_path = services.paths.clones_dir / f"{voice_id}.wav"

    transcript = transcript.strip()
    if not transcript:
        raise ApiError(
            "transcript_required",
            "A transcript matching the reference audio is required to clone a voice.",
            400,
        )

    with tempfile.NamedTemporaryFile(suffix=Path(audio.filename or "reference.wav").suffix, delete=False) as temp_file:
        temp_path = Path(temp_file.name)
        temp_file.write(await audio.read())

    quality = validate_reference_audio(temp_path, clone_path)
    temp_path.unlink(missing_ok=True)

    now = utc_now().isoformat()
    voice = await services.db.create_clone_voice(
        {
            "id": voice_id,
            "name": name,
            "gender": gender,
            "color": color or "#C9965A",
            "description": f"Cloned from {quality.duration_seconds:.1f}s reference audio.",
            "tags": json.loads(tags) if tags else ["personal", "clone"],
            "reference_audio_path": services.db.to_relative_path(clone_path),
            "reference_text": transcript,
            "reference_duration_seconds": quality.duration_seconds,
            "created_at": now,
            "updated_at": now,
        }
    )
    return VoiceCloneResponse(voice=voice, quality=quality)


@router.put("/{voice_id}", response_model=VoiceResponse)
async def update_voice(request: Request, voice_id: str, payload: UpdateVoiceRequest) -> VoiceResponse:
    services = request.app.state.services
    voice = _ensure_voice(await services.db.get_voice(voice_id))
    if voice.type == "preset":
        raise ApiError("preset_immutable", "Preset voices cannot be modified.", 403)

    changes = payload.model_dump(exclude_none=True)
    changes["updated_at"] = utc_now().isoformat()
    updated = await services.db.update_voice(voice_id, changes)
    return VoiceResponse(voice=updated)


@router.delete("/{voice_id}")
async def delete_voice(request: Request, voice_id: str) -> dict[str, bool]:
    services = request.app.state.services
    voice = _ensure_voice(await services.db.get_voice(voice_id))
    if voice.type == "preset":
        raise ApiError("preset_immutable", "Preset voices cannot be deleted.", 403)

    path = services.db.resolve_relative_path(voice.reference_audio_path)
    deleted = await services.db.delete_voice(voice_id)
    if path:
        path.unlink(missing_ok=True)
    return {"deleted": deleted is not None}


@router.put("/{voice_id}/reference", response_model=VoiceCloneResponse)
async def replace_reference(
    request: Request,
    voice_id: str,
    audio: UploadFile = File(...),
    transcript: str = Form(...),
) -> VoiceCloneResponse:
    services = request.app.state.services
    voice = _ensure_voice(await services.db.get_voice(voice_id))
    if voice.type == "preset":
        raise ApiError("preset_immutable", "Preset voices cannot be modified.", 403)

    transcript = transcript.strip()
    if not transcript:
        raise ApiError(
            "transcript_required",
            "A transcript matching the reference audio is required when updating a clone reference.",
            400,
        )

    target_path = services.db.resolve_relative_path(voice.reference_audio_path)
    if target_path is None:
        raise ApiError("invalid_audio", "The existing reference audio path is invalid.", 400)

    with tempfile.NamedTemporaryFile(suffix=Path(audio.filename or "reference.wav").suffix, delete=False) as temp_file:
        temp_path = Path(temp_file.name)
        temp_file.write(await audio.read())

    quality = validate_reference_audio(temp_path, target_path)
    temp_path.unlink(missing_ok=True)

    updated = await services.db.update_voice(
        voice_id,
        {
            "reference_text": transcript,
            "reference_duration_seconds": quality.duration_seconds,
            "updated_at": utc_now().isoformat(),
        },
    )
    return VoiceCloneResponse(voice=updated, quality=quality)


@router.get("/{voice_id}/preview")
async def preview_voice(request: Request, voice_id: str) -> FileResponse:
    services = request.app.state.services
    voice = _ensure_voice(await services.db.get_voice(voice_id))
    audio_path = services.db.resolve_relative_path(voice.reference_audio_path)
    if audio_path is None or not audio_path.exists():
        raise ApiError("invalid_audio", "The reference audio for this voice is missing.", 400)

    preview_text = "The forge burns brightest at midnight. Every voice begins as raw metal."
    result = await services.engine.generate_to_wav(
        text=preview_text,
        reference_audio_path=audio_path,
        reference_text=voice.reference_text,
        system_prompt=None,
    )

    segment = trim_trailing_silence_segment(AudioSegment.from_wav(result["wav_path"]))[:5000]
    segment.export(result["wav_path"], format="wav")
    return FileResponse(
        result["wav_path"],
        media_type="audio/wav",
        filename=f"{voice.name}-preview.wav",
        background=BackgroundTask(lambda: Path(result["wav_path"]).unlink(missing_ok=True)),
    )
