from __future__ import annotations

import asyncio
import json
import wave
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .audio import generate_placeholder_wav
from .config import API_PREFIX, APP_NAME, DEFAULT_HOST, DEFAULT_PORT, get_app_paths
from .database import Database
from .engine import TadaEngine
from .errors import ApiError, error_payload
from .routes import export, generate, health, history, settings, voices
from .services import AppServices, ProgressBroker, utc_now


def _load_presets(paths: object, db: Database) -> list[dict[str, object]]:
    manifest = json.loads(Path(paths.presets_manifest).read_text(encoding="utf-8"))
    db.install_packaged_presets(paths.packaged_preset_audio_dir, paths.presets_dir)

    preset_rows = []
    for preset in manifest:
        audio_path = paths.presets_dir / preset["reference_file"]
        if not audio_path.exists():
            generate_placeholder_wav(audio_path, seconds=10)
        with wave.open(str(audio_path), "rb") as wav_file:
            duration_seconds = wav_file.getnframes() / wav_file.getframerate()
        preset_rows.append(
            {
                **preset,
                "created_at": utc_now().isoformat(),
                "reference_audio_path": db.to_relative_path(audio_path),
                "reference_duration_seconds": round(duration_seconds, 2),
            }
        )
    return preset_rows


async def _bootstrap_model(app: FastAPI) -> None:
    services: AppServices = app.state.services
    settings_data = await services.db.get_settings()
    services.engine.configure(
        model_name=settings_data.get("model", "tada-1b"),
        num_threads=int(settings_data.get("cpu_threads", "6")),
    )

    try:
        services.health.status = "loading"
        await services.engine.check_auth()
        await services.engine.load_model()
        if settings_data.get("warmup_on_launch", "true").lower() == "true":
            preset_voices = await services.db.list_voices("preset")
            warmup_voice = preset_voices[0] if preset_voices else None
            if warmup_voice and warmup_voice.reference_audio_path:
                warmup_path = services.db.resolve_relative_path(warmup_voice.reference_audio_path)
                if warmup_path is not None:
                    services.health.status = "warming_up"
                    await services.engine.warmup(
                        warmup_path, warmup_voice.reference_text or "Hello world."
                    )
        services.health.status = "ready"
        services.health.error = None
        services.health.message = None
    except ApiError as exc:
        services.health.status = "error"
        services.health.error = exc.error
        services.health.message = exc.message


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    paths = get_app_paths()
    for path in (
        paths.app_home,
        paths.db_dir,
        paths.voices_dir,
        paths.presets_dir,
        paths.clones_dir,
        paths.output_dir,
        paths.models_dir,
    ):
        path.mkdir(parents=True, exist_ok=True)

    db = Database(paths.db_path, paths.app_home)
    await db.initialize()
    await db.seed_presets(_load_presets(paths, db))

    settings_data = await db.get_settings()
    engine = TadaEngine(
        model_name=settings_data.get("model", "tada-1b"),
        num_threads=int(settings_data.get("cpu_threads", "6")),
        models_dir=paths.models_dir,
    )
    services = AppServices(paths=paths, db=db, engine=engine, progress=ProgressBroker())
    app.state.services = services

    async def reload_engine() -> None:
        await _bootstrap_model(app)

    app.state.reload_engine = reload_engine
    bootstrap_task = asyncio.create_task(_bootstrap_model(app))
    try:
        yield
    finally:
        bootstrap_task.cancel()
        await engine.unload()


app = FastAPI(title=APP_NAME, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost",
        "http://127.0.0.1",
        "http://tauri.localhost",
        "tauri://localhost",
    ],
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(ApiError)
async def api_error_handler(_: Request, exc: ApiError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code, content=error_payload(exc.error, exc.message, exc.details)
    )


@app.exception_handler(ValueError)
async def value_error_handler(_: Request, exc: ValueError) -> JSONResponse:
    mapping = {
        "text_empty": ("text_empty", "Input text cannot be empty.", 400),
        "text_too_long": ("text_too_long", "Input text cannot exceed 50,000 characters.", 400),
    }
    error, message, status = mapping.get(str(exc), ("invalid_setting", str(exc), 400))
    return JSONResponse(status_code=status, content=error_payload(error, message))


app.include_router(health.router, prefix=API_PREFIX)
app.include_router(voices.router, prefix=API_PREFIX)
app.include_router(generate.router, prefix=API_PREFIX)
app.include_router(history.router, prefix=API_PREFIX)
app.include_router(settings.router, prefix=API_PREFIX)
app.include_router(export.router, prefix=API_PREFIX)


def run() -> None:
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=DEFAULT_HOST,
        port=DEFAULT_PORT,
        reload=False,
    )
