from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import wave
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response

from .audio import generate_placeholder_wav
from .config import API_PREFIX, APP_NAME, DEFAULT_HOST, DEFAULT_PORT, get_app_paths
from .database import Database
from .engine import TadaEngine
from .errors import ApiError, error_payload
from .routes import export, generate, health, history, settings, voices
from .services import AppServices, ProgressBroker, utc_now

logger = logging.getLogger(__name__)

MODEL_CACHE_NAMES = (
    "models--meta-llama--Llama-3.2-1B",
    "models--HumeAI--tada-codec",
    "models--HumeAI--tada-1b",
    "mlx-tada-1b-weights",
)


def _seed_models_dir(paths: object) -> None:
    resource_models_dir = getattr(paths, "resource_models_dir", None)
    source_roots = []
    if resource_models_dir and resource_models_dir.exists():
        source_roots.append(resource_models_dir)

    huggingface_cache_dir = Path.home() / ".cache" / "huggingface" / "hub"
    if huggingface_cache_dir.exists():
        source_roots.append(huggingface_cache_dir)

    for source_root in source_roots:
        for name in MODEL_CACHE_NAMES:
            source_path = source_root / name
            target_path = paths.models_dir / name
            if not source_path.exists() or target_path.exists():
                continue
            logger.info("Seeding local model asset %s from %s", name, source_root)
            shutil.copytree(source_path, target_path, dirs_exist_ok=True)


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
        services.health.setup_title = "Preparing the voice engine"
        services.health.setup_detail = "Foundry Vox is checking local model access and loading the selected runtime."
        services.health.setup_actions = []
        await services.engine.check_auth()
        await services.engine.load_model()
        if settings_data.get("warmup_on_launch", "true").lower() == "true":
            preset_voices = await services.db.list_voices("preset")
            warmup_voice = preset_voices[0] if preset_voices else None
            if warmup_voice and warmup_voice.reference_audio_path:
                warmup_path = services.db.resolve_relative_path(warmup_voice.reference_audio_path)
                if warmup_path is not None:
                    services.health.status = "warming_up"
                    services.health.setup_title = "Warming up the model"
                    services.health.setup_detail = "A short internal render is running so your first real generation feels faster."
                    services.health.setup_actions = []
                    await services.engine.warmup(
                        warmup_path, warmup_voice.reference_text or "Hello world."
                    )
                    services.engine.mark_voice_warmed(warmup_voice.id)
        services.health.status = "ready"
        services.health.error = None
        services.health.message = None
        services.health.setup_title = None
        services.health.setup_detail = None
        services.health.setup_actions = []
    except ApiError as exc:
        services.health.status = "error"
        services.health.error = exc.error
        services.health.message = exc.message
        if exc.error == "huggingface_auth_required":
            services.health.setup_title = "Model access needs approval"
            services.health.setup_detail = (
                "Foundry Vox could not find the required local tokenizer assets, and remote access to "
                "Meta's Llama tokenizer is still gated."
            )
            services.health.setup_actions = [
                f"App models directory: {services.paths.models_dir}",
                "If you already have the model files on this Mac, place them in that models directory",
                "Otherwise sign in to Hugging Face on this Mac",
                "Accept the Meta Llama 3.2 license if remote download is needed",
                "Restart Foundry Vox after access is confirmed",
            ]
        elif exc.error == "model_error":
            services.health.setup_title = "The local ML runtime is unavailable"
            services.health.setup_detail = (
                "Foundry Vox could not finish loading its on-device model stack."
            )
            services.health.setup_actions = [
                f"App models directory: {services.paths.models_dir}",
                "Verify the packaged model/runtime files are present",
                "Restart the app and wait for the engine to finish loading",
            ]
        else:
            services.health.setup_title = "Foundry Vox needs attention"
            services.health.setup_detail = exc.message
            services.health.setup_actions = []
    except Exception as exc:  # noqa: BLE001
        logger.exception("Unexpected failure while bootstrapping the voice engine")
        services.health.status = "error"
        services.health.error = "model_error"
        services.health.message = f"Unexpected startup failure: {exc}"
        services.health.setup_title = "The local ML runtime is unavailable"
        services.health.setup_detail = (
            "Foundry Vox hit an unexpected error while preparing its on-device model stack."
        )
        services.health.setup_actions = [
            f"App models directory: {services.paths.models_dir}",
            "Verify the required TADA model files are present",
            "Restart the app after correcting the local model assets",
        ]


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

    _seed_models_dir(paths)

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


API_TOKEN = os.getenv("FOUNDRY_VOX_API_TOKEN")
app = FastAPI(title=APP_NAME, lifespan=lifespan)

@app.middleware("http")
async def require_runtime_token(request: Request, call_next: object) -> Response:
    if not API_TOKEN:
        return await call_next(request)

    if request.method == "OPTIONS":
        return await call_next(request)

    header_token = request.headers.get("x-foundry-vox-token")
    if header_token == API_TOKEN:
        return await call_next(request)

    return JSONResponse(
        status_code=401,
        content=error_payload(
            "runtime_auth_required",
            "This packaged build only accepts requests from the Foundry Vox app shell.",
        ),
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
