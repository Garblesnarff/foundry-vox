from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from pathlib import Path

APP_NAME = "Foundry Vox"
API_PREFIX = "/api/v1"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 3456


def _default_app_home() -> Path:
    env_override = os.getenv("FOUNDRY_VOX_HOME")
    if env_override:
        return _expand_home(env_override)

    home = Path.home()
    if sys.platform == "darwin":
        return (home / "Library" / "Application Support" / APP_NAME).resolve()
    if os.name == "nt":
        appdata = os.getenv("LOCALAPPDATA")
        if appdata:
            return (Path(appdata) / APP_NAME).resolve()
        return (home / "AppData" / "Local" / APP_NAME).resolve()
    xdg_data_home = os.getenv("XDG_DATA_HOME")
    if xdg_data_home:
        return (Path(xdg_data_home) / APP_NAME).resolve()
    return (home / ".local" / "share" / APP_NAME).resolve()


def _resource_root() -> Path:
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS)
    return Path(__file__).resolve().parents[1]


def _expand_home(path: str) -> Path:
    return Path(os.path.expanduser(path)).resolve()


@dataclass(slots=True)
class AppPaths:
    app_home: Path
    db_dir: Path
    voices_dir: Path
    presets_dir: Path
    clones_dir: Path
    output_dir: Path
    models_dir: Path
    db_path: Path
    presets_manifest: Path
    packaged_preset_audio_dir: Path
    licenses_dir: Path


def get_app_paths() -> AppPaths:
    app_home = _default_app_home()
    db_dir = app_home / "db"
    voices_dir = app_home / "voices"
    presets_dir = voices_dir / "presets"
    clones_dir = voices_dir / "clones"
    output_dir = app_home / "output"
    models_dir = app_home / "models"

    resource_root = _resource_root()
    presets_root = resource_root / "app" / "presets"
    licenses_dir = resource_root / "licenses"

    return AppPaths(
        app_home=app_home,
        db_dir=db_dir,
        voices_dir=voices_dir,
        presets_dir=presets_dir,
        clones_dir=clones_dir,
        output_dir=output_dir,
        models_dir=models_dir,
        db_path=db_dir / "foundry_vox.db",
        presets_manifest=presets_root / "voices.json",
        packaged_preset_audio_dir=presets_root / "audio",
        licenses_dir=licenses_dir,
    )


def default_output_directory() -> str:
    return str((get_app_paths().app_home / "output").resolve())


DEFAULT_SETTINGS = {
    "model": "tada-1b",
    "cpu_threads": "6",
    "output_format": "wav",
    "sample_rate": "24000",
    "bit_depth": "16",
    "output_directory": default_output_directory(),
    "warmup_on_launch": "true",
}
