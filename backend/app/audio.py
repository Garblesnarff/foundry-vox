from __future__ import annotations

import asyncio
import math
import shutil
import subprocess
import tempfile
import wave
from collections.abc import Iterable
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

from pydub import AudioSegment, silence

from .errors import ApiError
from .models import AudioFormat, VoiceQuality


def trim_trailing_silence_segment(audio: AudioSegment, silence_threshold_db: float = -42.0) -> AudioSegment:
    if len(audio) == 0:
        return audio

    window_ms = 100
    keep_padding_ms = 200
    end_ms = len(audio)
    while end_ms > window_ms:
        chunk = audio[max(0, end_ms - window_ms) : end_ms]
        if chunk.dBFS > silence_threshold_db:
            break
        end_ms -= window_ms

    trimmed_end = min(len(audio), end_ms + keep_padding_ms)
    return audio[:trimmed_end]


def ensure_writable_directory(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)
    test_file = path / ".write_test"
    try:
        test_file.write_text("ok", encoding="utf-8")
    except OSError as exc:
        raise ApiError("invalid_setting", "The chosen output directory is not writable.", 400) from exc
    finally:
        test_file.unlink(missing_ok=True)


def load_audio_segment(path: Path) -> AudioSegment:
    try:
        return AudioSegment.from_file(path)
    except Exception as exc:  # noqa: BLE001
        raise ApiError("invalid_audio", "The uploaded audio could not be decoded.", 400) from exc


def estimate_snr(audio: AudioSegment) -> float:
    chunk_ms = 100
    chunks = [audio[i : i + chunk_ms] for i in range(0, len(audio), chunk_ms) if len(audio[i : i + chunk_ms]) > 0]
    if not chunks:
        return 0.0

    levels = [chunk.rms for chunk in chunks]
    speech = [level for level in levels if level > max(levels) * 0.2]
    noise = [level for level in levels if level <= max(levels) * 0.2]
    speech_rms = sum(speech) / max(1, len(speech))
    noise_rms = max(1.0, (sum(noise) / max(1, len(noise))))
    return round(20 * math.log10(speech_rms / noise_rms), 1)


def quality_rating(duration_seconds: float, snr_db: float) -> str:
    if duration_seconds < 6 or snr_db < 10:
        return "poor"
    if duration_seconds < 9 or snr_db < 18:
        return "fair"
    if duration_seconds >= 15 and snr_db > 25:
        return "excellent"
    return "good"


def validate_reference_audio(source_path: Path, target_path: Path) -> VoiceQuality:
    audio = load_audio_segment(source_path)
    audio = audio.set_channels(1).set_frame_rate(24_000).set_sample_width(2)
    nonsilent_ranges = silence.detect_nonsilent(audio, min_silence_len=200, silence_thresh=-40)
    if nonsilent_ranges:
        start_ms = max(0, nonsilent_ranges[0][0] - 100)
        end_ms = min(len(audio), nonsilent_ranges[-1][1] + 100)
        audio = audio[start_ms:end_ms]
    duration_seconds = round(len(audio) / 1000.0, 2)

    warnings: list[str] = []
    if duration_seconds < 6:
        raise ApiError("audio_too_short", "Reference audio must be at least 6 seconds long.", 400)
    if duration_seconds < 9:
        warnings.append("Reference audio under 9 seconds may reduce voice matching quality.")

    snr_db = estimate_snr(audio)
    if snr_db < 10:
        warnings.append("Low signal-to-noise ratio detected. A cleaner recording will produce better cloning.")

    target_path.parent.mkdir(parents=True, exist_ok=True)
    audio.export(target_path, format="wav")

    return VoiceQuality(
        duration_seconds=duration_seconds,
        snr_estimate_db=snr_db,
        quality_rating=quality_rating(duration_seconds, snr_db),
        warnings=warnings,
    )


def export_audio(audio: AudioSegment, output_path: Path, format_name: AudioFormat, bit_depth: int) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)

    if format_name == "wav":
        audio = audio.set_sample_width(max(1, bit_depth // 8))
        audio.export(output_path, format="wav")
        return

    ffmpeg_available = shutil.which("ffmpeg") is not None
    if ffmpeg_available:
        export_format = "mp3" if format_name == "mp3" else "adts"
        audio.export(output_path, format=export_format, bitrate="192k")
        return

    if shutil.which("afconvert") is None:
        raise ApiError(
            "model_error",
            "Audio conversion requires ffmpeg or afconvert to be installed on this Mac.",
            500,
        )

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as temp_wav:
        temp_wav_path = Path(temp_wav.name)
    try:
        audio.export(temp_wav_path, format="wav")
        if format_name == "mp3":
            subprocess.run(
                ["afconvert", "-f", "MPG3", "-d", ".mp3", str(temp_wav_path), str(output_path)],
                check=True,
                capture_output=True,
            )
        else:
            subprocess.run(
                ["afconvert", "-f", "adts", "-d", "aac ", str(temp_wav_path), str(output_path)],
                check=True,
                capture_output=True,
            )
    except subprocess.CalledProcessError as exc:
        raise ApiError("model_error", "Failed to convert generated audio.", 500) from exc
    finally:
        temp_wav_path.unlink(missing_ok=True)


async def concatenate_audio(paths: Iterable[Path], pause_seconds: float, sample_rate: int) -> AudioSegment:
    def _build() -> AudioSegment:
        pause = AudioSegment.silent(duration=int(pause_seconds * 1000), frame_rate=sample_rate)
        combined = AudioSegment.empty()
        for index, path in enumerate(paths):
            segment = load_audio_segment(path).set_frame_rate(sample_rate)
            if index:
                combined += pause
            combined += segment
        return combined

    return await asyncio.to_thread(_build)


def create_zip_archive(files: list[tuple[Path, str]], output_path: Path) -> Path:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(output_path, "w", compression=ZIP_DEFLATED) as archive:
        for file_path, archive_name in files:
            archive.write(file_path, arcname=archive_name)
    return output_path


def generate_placeholder_wav(path: Path, seconds: float = 10.0) -> None:
    frame_rate = 24_000
    sample_count = int(seconds * frame_rate)
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(frame_rate)
        wav_file.writeframes(b"\x00\x00" * sample_count)
