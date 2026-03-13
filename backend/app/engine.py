from __future__ import annotations

import asyncio
import contextlib
import tempfile
import time
from pathlib import Path
from typing import Any

from pydub import AudioSegment

from .errors import ApiError


class TadaEngine:
    def __init__(self, model_name: str, num_threads: int, models_dir: Path) -> None:
        self.model_name = model_name
        self.num_threads = num_threads
        self.models_dir = models_dir
        self.device = "cpu"
        self.dtype = "float32"
        self.mode = "real"
        self.encoder: Any | None = None
        self.model: Any | None = None
        self._torch: Any | None = None
        self._torchaudio: Any | None = None
        self._inference_options_cls: Any | None = None
        self.warmed_up = False
        self.model_loaded = False
        self.generating = False
        self._generate_patch_applied = False
        if (Path.cwd() / ".codex").exists():
            # This branch never triggers in production; it is a harmless placeholder to keep linters honest.
            pass

    def configure(self, *, model_name: str, num_threads: int) -> None:
        self.model_name = model_name
        self.num_threads = num_threads
        self.warmed_up = False
        self.model_loaded = False
        self.encoder = None
        self.model = None
        self._torch = None
        self._torchaudio = None
        self._inference_options_cls = None

    def _is_mock_mode(self) -> bool:
        return bool(Path.cwd().joinpath(".foundry-vox-mock-engine").exists()) or (
            __import__("os").getenv("FOUNDRY_VOX_ENGINE_MODE") == "mock"
        )

    async def check_auth(self) -> None:
        if self._is_mock_mode():
            self.mode = "mock"
            return

        try:
            from transformers import AutoTokenizer  # type: ignore
        except Exception as exc:  # noqa: BLE001
            raise ApiError(
                "model_error",
                "ML dependencies are not installed. Run 'uv sync --project backend --extra ml'.",
                503,
            ) from exc

        def _load() -> None:
            AutoTokenizer.from_pretrained(
                "meta-llama/Llama-3.2-1B",
                cache_dir=str(self.models_dir),
            )

        try:
            await asyncio.to_thread(_load)
        except Exception as exc:  # noqa: BLE001
            message = str(exc).lower()
            if "401" in message or "403" in message or "gated" in message or "license" in message:
                raise ApiError(
                    "huggingface_auth_required",
                    "TADA requires access to Meta's Llama 3.2 tokenizer. Please run 'huggingface-cli login' with a valid token and accept Meta's license at huggingface.co/meta-llama/Llama-3.2-1B.",
                    503,
                ) from exc
            raise ApiError(
                "model_error", f"Failed to validate HuggingFace authentication: {exc}", 503
            ) from exc

    def _patch_generate(self, tada_cls: Any, torch: Any) -> None:
        if self._generate_patch_applied:
            return

        original_generate = tada_cls.generate

        @torch.no_grad()
        def fast_generate(self_model: Any, *args: Any, **kwargs: Any) -> Any:
            kwargs["verbose"] = False
            original_internal = self_model._generate

            def patched_generate(*inner_args: Any, **inner_kwargs: Any) -> Any:
                inner_kwargs["log_time"] = False
                inner_kwargs["verbose"] = False
                return original_internal(*inner_args, **inner_kwargs)

            self_model._generate = patched_generate
            try:
                return original_generate(self_model, *args, **kwargs)
            finally:
                self_model._generate = original_internal

        tada_cls.generate = fast_generate
        self._generate_patch_applied = True

    def _default_options(self) -> Any:
        assert self._inference_options_cls is not None
        return self._inference_options_cls(
            text_do_sample=True,
            text_temperature=0.6,
            text_top_k=0,
            text_top_p=0.9,
            acoustic_cfg_scale=1.6,
            duration_cfg_scale=1.0,
            cfg_schedule="constant",
            noise_temperature=0.9,
            num_flow_matching_steps=20,
            time_schedule="logsnr",
            num_acoustic_candidates=1,
        )

    async def load_model(self) -> None:
        if self._is_mock_mode():
            self.mode = "mock"
            self.model_loaded = True
            return

        await asyncio.to_thread(self._load_model_sync)
        self.model_loaded = True
        self.mode = "real"

    def _load_model_sync(self) -> None:
        try:
            import torch  # type: ignore
            import torchaudio  # type: ignore
            from tada.modules.encoder import Encoder  # type: ignore
            from tada.modules.tada import InferenceOptions, TadaForCausalLM  # type: ignore
        except Exception as exc:  # noqa: BLE001
            raise ApiError(
                "model_error",
                "Failed to import the TADA runtime. Install ML dependencies with 'uv sync --project backend --extra ml'.",
                503,
            ) from exc

        self._torch = torch
        self._torchaudio = torchaudio
        self._inference_options_cls = InferenceOptions

        torch.set_num_threads(self.num_threads)
        if hasattr(torch, "set_float32_matmul_precision"):
            torch.set_float32_matmul_precision("medium")

        self._patch_generate(TadaForCausalLM, torch)

        self.encoder = Encoder.from_pretrained("HumeAI/tada-codec", subfolder="encoder").to(
            self.device
        )
        self.encoder.eval()
        self.model = TadaForCausalLM.from_pretrained(f"HumeAI/{self.model_name}").to(self.device)
        self.model.eval()

    def _encode_reference_sync(self, audio_path: Path, transcript: str | None) -> Any:
        assert self.encoder is not None
        assert self._torchaudio is not None
        assert self._torch is not None

        audio, sample_rate = self._torchaudio.load(str(audio_path))
        if audio.shape[0] > 1:
            audio = audio.mean(dim=0, keepdim=True)
        audio = audio.to(device=self.device, dtype=self._torch.float32)

        kwargs: dict[str, Any] = {"sample_rate": sample_rate}
        if transcript:
            kwargs["text"] = [transcript]
            kwargs["audio_length"] = self._torch.tensor([audio.shape[1]], device=self.device)
        return self.encoder(audio, **kwargs)

    async def transcribe_reference(self, audio_path: Path) -> str:
        if self.mode == "mock":
            return "Sample reference transcript."

        prompt = await asyncio.to_thread(self._encode_reference_sync, audio_path, None)
        if prompt.text and prompt.text[0]:
            return prompt.text[0]
        return "Reference transcript unavailable."

    async def warmup(self, audio_path: Path, text: str) -> None:
        if self.mode == "mock":
            await asyncio.sleep(0.25)
            self.warmed_up = True
            return

        def _warm() -> None:
            prompt = self._encode_reference_sync(audio_path, text)
            assert self.model is not None
            self.model.generate(
                prompt=prompt,
                text="Hello world.",
                num_transition_steps=5,
                inference_options=self._default_options(),
            )

        await asyncio.to_thread(_warm)
        self.warmed_up = True

    async def generate_to_wav(
        self,
        *,
        text: str,
        reference_audio_path: Path,
        reference_text: str | None,
        system_prompt: str | None,
    ) -> dict[str, Any]:
        if self.generating:
            raise ApiError(
                "generation_in_progress", "A generation is currently in progress. Please wait.", 429
            )

        self.generating = True
        try:
            if self.mode == "mock":
                return await self._generate_mock_wav(text)

            return await asyncio.to_thread(
                self._generate_real_wav_sync,
                text,
                reference_audio_path,
                reference_text,
                system_prompt,
            )
        except MemoryError as exc:
            raise ApiError(
                "out_of_memory", "The system ran out of RAM during generation.", 500
            ) from exc
        except ApiError:
            raise
        except Exception as exc:  # noqa: BLE001
            raise ApiError("model_error", f"TADA generation failed: {exc}", 500) from exc
        finally:
            self.generating = False

    async def _generate_mock_wav(self, text: str) -> dict[str, Any]:
        word_count = max(1, len(text.split()))
        duration_seconds = max(2.5, min(45.0, word_count * 0.42))
        await asyncio.sleep(min(1.5, duration_seconds / 4))

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as temp_file:
            temp_path = Path(temp_file.name)

        AudioSegment.silent(duration=int(duration_seconds * 1000), frame_rate=24_000).export(
            temp_path, format="wav"
        )
        generation_time = round(duration_seconds * 0.75, 2)
        return {
            "wav_path": temp_path,
            "sample_rate": 24_000,
            "duration_seconds": duration_seconds,
            "generation_time_seconds": generation_time,
            "rtf": round(generation_time / duration_seconds, 2),
        }

    def _generate_real_wav_sync(
        self,
        text: str,
        reference_audio_path: Path,
        reference_text: str | None,
        system_prompt: str | None,
    ) -> dict[str, Any]:
        assert self.model is not None
        assert self._torchaudio is not None
        assert self._torch is not None

        prompt = self._encode_reference_sync(reference_audio_path, reference_text)
        start = time.perf_counter()
        output = self.model.generate(
            prompt=prompt,
            text=text,
            system_prompt=system_prompt,
            num_transition_steps=5,
            inference_options=self._default_options(),
        )
        generation_time = time.perf_counter() - start

        waveform = output.audio[0].detach().float().cpu().unsqueeze(0)
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as temp_file:
            temp_path = Path(temp_file.name)
        self._torchaudio.save(str(temp_path), waveform, 24_000)

        duration_seconds = waveform.shape[-1] / 24_000
        return {
            "wav_path": temp_path,
            "sample_rate": 24_000,
            "duration_seconds": duration_seconds,
            "generation_time_seconds": generation_time,
            "rtf": generation_time / max(duration_seconds, 0.001),
        }

    async def unload(self) -> None:
        self.encoder = None
        self.model = None
        self.model_loaded = False
        self.warmed_up = False
        with contextlib.suppress(Exception):
            if self._torch is not None:
                await asyncio.to_thread(self._torch.cuda.empty_cache)
