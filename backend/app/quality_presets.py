from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

QUALITY_PRESET_KEYS = ("draft", "balanced", "quality", "studio")
DEFAULT_QUALITY_PRESET = "balanced"


@lru_cache(maxsize=1)
def load_quality_presets() -> list[dict[str, Any]]:
    presets_path = Path(__file__).resolve().parents[2] / "shared" / "quality-presets.json"
    return json.loads(presets_path.read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def quality_preset_map() -> dict[str, dict[str, Any]]:
    return {preset["key"]: preset for preset in load_quality_presets()}
