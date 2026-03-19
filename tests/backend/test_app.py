from __future__ import annotations

import os
import time
from pathlib import Path

from fastapi.testclient import TestClient


def _wait_for_ready(client: TestClient) -> None:
    deadline = time.time() + 5
    while time.time() < deadline:
      response = client.get("/api/v1/health")
      if response.status_code == 200 and response.json()["status"] in {"ready", "error"}:
        return
      time.sleep(0.1)
    raise AssertionError("backend did not leave loading state in time")


def test_seeded_voices_and_generation(tmp_path: Path) -> None:
    os.environ["FOUNDRY_VOX_ENGINE_MODE"] = "mock"
    os.environ["FOUNDRY_VOX_HOME"] = str(tmp_path / "FoundryVox")

    from app.main import app

    with TestClient(app) as client:
        _wait_for_ready(client)

        health = client.get("/api/v1/health")
        assert health.status_code == 200
        assert health.json()["status"] == "ready"

        voices = client.get("/api/v1/voices").json()["voices"]
        assert len(voices) >= 6

        generation = client.post(
            "/api/v1/generate",
            json={
                "text": "The forge burns brightest at midnight.",
                "voice_id": voices[0]["id"],
                "format": "wav",
                "sample_rate": 24000,
            },
        )
        assert generation.status_code == 200
        payload = generation.json()["generation"]
        assert payload["voice_id"] == voices[0]["id"]
        assert payload["quality"] == "balanced"
        assert Path(payload["output_path"]).exists()

        draft_generation = client.post(
            "/api/v1/generate",
            json={
                "text": "Draft quality test.",
                "voice_id": voices[0]["id"],
                "quality": "draft",
            },
        )
        assert draft_generation.status_code == 200
        assert draft_generation.json()["generation"]["quality"] == "draft"

        studio_generation = client.post(
            "/api/v1/generate",
            json={
                "text": "Studio quality test.",
                "voice_id": voices[0]["id"],
                "quality": "studio",
            },
        )
        assert studio_generation.status_code == 200
        assert studio_generation.json()["generation"]["quality"] == "studio"
