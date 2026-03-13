from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

VoiceType = Literal["preset", "clone"]
AudioFormat = Literal["wav", "mp3", "aac"]
SortMode = Literal["newest", "oldest", "longest", "shortest"]
HealthStatus = Literal["loading", "warming_up", "ready", "generating", "error"]


class VoiceSummary(BaseModel):
    id: str
    name: str
    type: VoiceType
    gender: str | None = None
    color: str | None = None
    description: str | None = None
    tags: list[str] = Field(default_factory=list)
    reference_duration_seconds: float | None = None
    created_at: datetime


class VoiceDetail(VoiceSummary):
    reference_text: str | None = None
    reference_audio_path: str | None = None
    updated_at: datetime


class VoiceListResponse(BaseModel):
    voices: list[VoiceSummary]


class VoiceResponse(BaseModel):
    voice: VoiceDetail


class VoiceQuality(BaseModel):
    duration_seconds: float
    snr_estimate_db: float
    quality_rating: Literal["poor", "fair", "good", "excellent"]
    warnings: list[str] = Field(default_factory=list)


class VoiceCloneResponse(BaseModel):
    voice: VoiceDetail
    quality: VoiceQuality


class UpdateVoiceRequest(BaseModel):
    name: str | None = None
    color: str | None = None
    description: str | None = None
    tags: list[str] | None = None


class GenerationRequest(BaseModel):
    text: str
    voice_id: str
    system_prompt: str | None = None
    format: AudioFormat | None = None
    sample_rate: int | None = None

    @field_validator("text")
    @classmethod
    def validate_text(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("text_empty")
        if len(value) > 50_000:
            raise ValueError("text_too_long")
        return value


class GenerationRecord(BaseModel):
    id: str
    text: str
    voice_id: str
    voice_name: str
    system_prompt: str | None = None
    output_path: str
    format: AudioFormat
    sample_rate: int
    duration_seconds: float
    generation_time_seconds: float
    rtf: float
    char_count: int
    word_count: int
    created_at: datetime


class GenerationResponse(BaseModel):
    generation: GenerationRecord


class HistoryResponse(BaseModel):
    generations: list[GenerationRecord]
    total: int
    limit: int
    offset: int


class HistoryStatsWindow(BaseModel):
    generations: int
    total_audio_seconds: float
    total_generation_seconds: float
    avg_rtf: float


class HistoryStatsResponse(BaseModel):
    session: HistoryStatsWindow
    lifetime: HistoryStatsWindow


class SettingsResponse(BaseModel):
    model: Literal["tada-1b", "tada-3b"]
    cpu_threads: int
    output_format: AudioFormat
    sample_rate: int
    bit_depth: Literal[16, 24, 32]
    output_directory: str
    warmup_on_launch: bool


class PatchSettingsRequest(BaseModel):
    model: Literal["tada-1b", "tada-3b"] | None = None
    cpu_threads: int | None = None
    output_format: AudioFormat | None = None
    sample_rate: Literal[16000, 22050, 24000, 44100, 48000] | None = None
    bit_depth: Literal[16, 24, 32] | None = None
    output_directory: str | None = None
    warmup_on_launch: bool | None = None

    @field_validator("cpu_threads")
    @classmethod
    def validate_threads(cls, value: int | None) -> int | None:
        if value is not None and value < 1:
            raise ValueError("cpu_threads")
        return value


class DirectoryChoiceResponse(BaseModel):
    path: str


class ExportBatchRequest(BaseModel):
    generation_ids: list[str]
    mode: Literal["zip", "concatenate"]
    format: AudioFormat = "wav"
    pause_seconds: float = 0.5
    filename: str | None = None


class HealthResponse(BaseModel):
    status: HealthStatus
    model: str
    model_loaded: bool
    warmed_up: bool
    device: str
    dtype: str
    platform: str
    error: str | None = None
    message: str | None = None
    setup_title: str | None = None
    setup_detail: str | None = None
    setup_actions: list[str] = Field(default_factory=list)


class ProgressEvent(BaseModel):
    status: str
    percent: float
    tokens_generated: int | None = None
    tokens_total: int | None = None
    generation_id: str | None = None
    message: str | None = None


class GenerationResult(BaseModel):
    waveform_path: Path
    sample_rate: int
    duration_seconds: float
    generation_time_seconds: float
    rtf: float


def voice_from_row(row: dict[str, Any]) -> VoiceDetail:
    tags = row.get("tags")
    if isinstance(tags, str):
        import json

        tags = json.loads(tags or "[]")
    return VoiceDetail(
        id=row["id"],
        name=row["name"],
        type=row["type"],
        gender=row.get("gender"),
        color=row.get("color"),
        description=row.get("description"),
        tags=tags or [],
        reference_text=row.get("reference_text"),
        reference_audio_path=row.get("reference_audio_path"),
        reference_duration_seconds=row.get("reference_duration_seconds"),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def generation_from_row(row: dict[str, Any]) -> GenerationRecord:
    return GenerationRecord(
        id=row["id"],
        text=row["text"],
        voice_id=row["voice_id"],
        voice_name=row["voice_name"],
        system_prompt=row.get("system_prompt"),
        output_path=row["output_path"],
        format=row["format"],
        sample_rate=row["sample_rate"],
        duration_seconds=row["duration_seconds"],
        generation_time_seconds=row["generation_time_seconds"],
        rtf=row["rtf"],
        char_count=row["char_count"],
        word_count=row["word_count"],
        created_at=row["created_at"],
    )
