from __future__ import annotations

import asyncio
import contextlib
import logging
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

from pydub import AudioSegment

from .errors import ApiError

logger = logging.getLogger(__name__)


def _mlx_available() -> bool:
    """Check if MLX is available (Apple Silicon macOS only)."""
    try:
        import mlx.core  # noqa: F401

        return True
    except ImportError as exc:
        print(f"MLX import unavailable: {exc}", file=sys.stderr, flush=True)
        logger.warning("MLX import unavailable: %s", exc)
        return False


class TadaEngine:
    def __init__(self, model_name: str, num_threads: int, models_dir: Path) -> None:
        self.model_name = model_name
        self.num_threads = num_threads
        self.models_dir = models_dir
        self.device = "cpu"
        self._torch_device = "cpu"
        self.dtype = "float32"
        self.mode = "real"
        self.encoder: Any | None = None
        self.model: Any | None = None
        self._decoder: Any | None = None
        self._mlx_core: Any | None = None
        self._torch: Any | None = None
        self._torchaudio: Any | None = None
        self._inference_options_cls: Any | None = None
        self.warmed_up = False
        self.model_loaded = False
        self.generating = False
        self._generate_patch_applied = False
        self._use_mlx = False
        self._warmed_voice_ids: set[str] = set()
        self._reference_prompt_cache: dict[tuple[str, int, int, str | None], Any] = {}
        if (Path.cwd() / ".codex").exists():
            # This branch never triggers in production; it is a harmless placeholder to keep linters honest.
            pass

    def configure(self, *, model_name: str, num_threads: int) -> None:
        self.model_name = model_name
        self.num_threads = num_threads
        self.device = "cpu"
        self._torch_device = "cpu"
        self.dtype = "float32"
        self.warmed_up = False
        self.model_loaded = False
        self.encoder = None
        self.model = None
        self._decoder = None
        self._mlx_core = None
        self._torch = None
        self._torchaudio = None
        self._inference_options_cls = None
        self._use_mlx = False
        self._warmed_voice_ids.clear()
        self._reference_prompt_cache.clear()

    def _is_mock_mode(self) -> bool:
        return bool(Path.cwd().joinpath(".foundry-vox-mock-engine").exists()) or (
            __import__("os").getenv("FOUNDRY_VOX_ENGINE_MODE") == "mock"
        )

    def _load_pretrained_local_first(self, loader: Any, repo_id: str, **kwargs: Any) -> Any:
        local_snapshot = self._local_snapshot_dir(repo_id)
        try:
            return loader.from_pretrained(str(local_snapshot), **kwargs)
        except Exception as exc:  # noqa: BLE001
            raise ApiError(
                "model_error",
                f"Required local model asset '{repo_id}' could not be loaded from {local_snapshot}: {exc}",
                503,
            ) from exc

    def _hf_repo_path(self, repo_id: str) -> Path:
        org, name = repo_id.split("/", 1)
        return self.models_dir / f"models--{org}--{name}"

    def _local_snapshot_dir(self, repo_id: str) -> Path:
        repo_path = self._hf_repo_path(repo_id)
        snapshots_dir = repo_path / "snapshots"
        if not snapshots_dir.exists():
            raise ApiError(
                "model_error",
                f"Required local model asset '{repo_id}' is unavailable in {self.models_dir}.",
                503,
            )

        ref_path = repo_path / "refs" / "main"
        if ref_path.exists():
            snapshot_id = ref_path.read_text(encoding="utf-8").strip()
            snapshot_dir = snapshots_dir / snapshot_id
            if snapshot_dir.exists():
                return snapshot_dir

        snapshot_dirs = sorted(path for path in snapshots_dir.iterdir() if path.is_dir())
        if snapshot_dirs:
            return snapshot_dirs[-1]

        raise ApiError(
            "model_error",
            f"Required local model asset '{repo_id}' is unavailable in {self.models_dir}.",
            503,
        )

    def _has_local_repo_asset(self, repo_id: str, relative_path: str | None = None) -> bool:
        repo_path = self._hf_repo_path(repo_id)
        snapshots_dir = repo_path / "snapshots"
        if not snapshots_dir.exists():
            return False

        for snapshot_dir in snapshots_dir.iterdir():
            if not snapshot_dir.is_dir():
                continue
            if relative_path is None or (snapshot_dir / relative_path).exists():
                return True
        return False

    def _ensure_local_model_assets(self) -> None:
        missing_assets: list[str] = []
        if not self._has_local_repo_asset("HumeAI/tada-codec", "encoder"):
            missing_assets.append("HumeAI/tada-codec encoder")

        has_local_decoder = self._has_local_repo_asset("HumeAI/tada-codec", "decoder")
        has_mlx_decoder = (self._mlx_weights_dir() / "decoder_weights.safetensors").exists()
        if not has_local_decoder and not has_mlx_decoder:
            missing_assets.append("HumeAI/tada-codec decoder")

        has_local_model = self._has_local_repo_asset(f"HumeAI/{self.model_name}")
        has_mlx_model = (self._mlx_weights_dir() / "weights.safetensors").exists()
        if not has_local_model and not has_mlx_model:
            missing_assets.append(f"HumeAI/{self.model_name}")

        if missing_assets:
            missing_list = ", ".join(missing_assets)
            raise ApiError(
                "model_error",
                "Required local TADA model assets are missing. "
                f"Missing: {missing_list}. Place the bundled model files in {self.models_dir}.",
                503,
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
                str(self._local_snapshot_dir("meta-llama/Llama-3.2-1B")),
            )

        try:
            await asyncio.to_thread(_load)
        except Exception as exc:  # noqa: BLE001
            raise ApiError(
                "model_error",
                f"Required local tokenizer assets are missing from {self.models_dir}: {exc}",
                503,
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

    def _mlx_generate_config(self) -> Any:
        """Build MLX GenerateConfig with optimized settings (2 flow steps, CFG 2.0)."""
        from .mlx_tada.generate import GenerateConfig

        return GenerateConfig(
            text_do_sample=False,
            text_temperature=0.6,
            text_top_k=0,
            text_top_p=0.9,
            acoustic_cfg_scale=2.0,
            duration_cfg_scale=1.0,
            cfg_schedule="constant",
            noise_temperature=0.6,
            num_flow_matching_steps=2,
            time_schedule="logsnr",
            num_acoustic_candidates=1,
            negative_condition_source="negative_step_output",
        )

    def _mlx_weights_dir(self) -> Path:
        """Directory for converted MLX weights."""
        return self.models_dir / f"mlx-{self.model_name}-weights"

    def _convert_weights_if_needed(self) -> bool:
        """Convert PyTorch TADA weights to MLX format if not already done.

        Returns True if weights are available (converted or already exist).
        """
        if self.model_name != "tada-1b":
            logger.info("MLX conversion is currently only supported for tada-1b; using PyTorch for %s", self.model_name)
            return False

        weights_dir = self._mlx_weights_dir()
        weights_path = weights_dir / "weights.safetensors"
        decoder_weights_path = weights_dir / "decoder_weights.safetensors"
        config_path = weights_dir / "config.json"

        if weights_path.exists() and decoder_weights_path.exists() and config_path.exists():
            return True

        logger.info("Converting TADA weights to MLX format...")
        try:
            from .mlx_tada.convert_weights import (
                load_decoder_weights,
                load_pytorch_weights,
                map_decoder_weights,
                map_llama_weights,
            )

            import mlx.core as mx
            import json

            pt_weights = load_pytorch_weights(
                repo_id=f"HumeAI/{self.model_name}",
                models_dir=str(self.models_dir),
            )
            mlx_weights = map_llama_weights(pt_weights)
            decoder_pt_weights = load_decoder_weights(models_dir=str(self.models_dir))
            mlx_decoder_weights = map_decoder_weights(decoder_pt_weights)

            weights_dir.mkdir(parents=True, exist_ok=True)
            mx.save_safetensors(str(weights_path), mlx_weights)
            mx.save_safetensors(str(decoder_weights_path), mlx_decoder_weights)

            config = {
                "hidden_size": 2048,
                "num_hidden_layers": 16,
                "num_attention_heads": 32,
                "num_key_value_heads": 8,
                "intermediate_size": 8192,
                "vocab_size": 128256,
                "rms_norm_eps": 1e-5,
                "rope_theta": 500000.0,
                "head_dim": 64,
                "max_position_embeddings": 131072,
                "rope_scaling_factor": 32.0,
                "rope_scaling_high_freq_factor": 4.0,
                "rope_scaling_low_freq_factor": 1.0,
                "rope_scaling_original_max_position_embeddings": 8192,
                "acoustic_dim": 512,
                "num_time_classes": 256,
                "shift_acoustic": 5,
                "head_layers": 6,
                "head_ffn_ratio": 4.0,
                "tie_word_embeddings": True,
                "acoustic_mean": 0.0,
                "acoustic_std": 1.5,
            }
            with open(config_path, "w") as f:
                json.dump(config, f, indent=2)

            logger.info("MLX weights converted successfully to %s", weights_dir)
            return True
        except Exception:  # noqa: BLE001
            logger.warning("Failed to convert MLX weights, falling back to PyTorch", exc_info=True)
            return False

    def _try_load_mlx(self) -> bool:
        """Try to initialize MLX inference core. Returns True on success."""
        if not _mlx_available():
            logger.info("MLX not available, using PyTorch backend")
            return False

        if not self._convert_weights_if_needed():
            return False

        try:
            from .mlx_tada.hybrid import MLXInferenceCore

            self._mlx_core = MLXInferenceCore(
                weights_dir=self._mlx_weights_dir(),
                quantize_llm=True,
            )
            logger.info("MLX inference core loaded successfully")
            return True
        except Exception:  # noqa: BLE001
            logger.warning("Failed to load MLX model, falling back to PyTorch", exc_info=True)
            return False

    async def load_model(self) -> None:
        if self._is_mock_mode():
            self.mode = "mock"
            self.model_loaded = True
            return

        self._ensure_local_model_assets()
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
                f"Failed to import the TADA runtime: {exc}. Install ML dependencies with 'uv sync --project backend --extra ml'.",
                503,
            ) from exc

        self._torch = torch
        self._torchaudio = torchaudio
        self._inference_options_cls = InferenceOptions

        torch.set_num_threads(self.num_threads)
        if hasattr(torch, "set_float32_matmul_precision"):
            torch.set_float32_matmul_precision("medium")

        self._patch_generate(TadaForCausalLM, torch)

        # Always load encoder (used by both MLX and PyTorch paths)
        self.encoder = self._load_pretrained_local_first(
            Encoder, "HumeAI/tada-codec", subfolder="encoder"
        ).to(self._torch_device)
        self.encoder.eval()

        # Try MLX path first (much faster on Apple Silicon)
        self._use_mlx = self._try_load_mlx()

        if self._use_mlx:
            # MLX needs the tokenizer from PyTorch encoder
            self._mlx_core.set_tokenizer(self.encoder.tokenizer)

            # Only load PyTorch decoder if MLX decoder is not available
            if self._mlx_core.mlx_decoder is None:
                from tada.modules.decoder import Decoder  # type: ignore

                self._decoder = self._load_pretrained_local_first(
                    Decoder, "HumeAI/tada-codec", subfolder="decoder"
                ).to(self._torch_device)
                self._decoder.eval()
                logger.info("Using MLX backend with PyTorch decoder fallback")
            else:
                logger.info("Using full MLX backend (LLM + decoder on Metal GPU)")

            self.device = "apple-metal"
            self._torch_device = "cpu"
            self.dtype = "int4+fp32-hybrid"
        else:
            # Fall back to PyTorch-only path
            self.model = self._load_pretrained_local_first(
                TadaForCausalLM, f"HumeAI/{self.model_name}"
            ).to(self._torch_device)
            self.model.eval()
            self.device = "cpu"
            self._torch_device = "cpu"
            self.dtype = "float32"
            logger.info("Using PyTorch backend (CPU)")

    def _encode_reference_sync(self, audio_path: Path, transcript: str | None) -> Any:
        assert self.encoder is not None
        assert self._torchaudio is not None
        assert self._torch is not None

        stat = audio_path.stat()
        cache_key = (
            str(audio_path.resolve()),
            stat.st_mtime_ns,
            stat.st_size,
            transcript,
        )
        cached_prompt = self._reference_prompt_cache.get(cache_key)
        if cached_prompt is not None:
            return cached_prompt

        audio, sample_rate = self._torchaudio.load(str(audio_path))
        if audio.shape[0] > 1:
            audio = audio.mean(dim=0, keepdim=True)
        audio = audio.to(device=self._torch_device, dtype=self._torch.float32)

        kwargs: dict[str, Any] = {"sample_rate": sample_rate}
        if transcript:
            kwargs["text"] = [transcript]
            kwargs["audio_length"] = self._torch.tensor([audio.shape[1]], device=self._torch_device)
        prompt = self.encoder(audio, **kwargs)
        self._reference_prompt_cache[cache_key] = prompt
        return prompt

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

            if self._use_mlx:
                assert self._mlx_core is not None
                self._mlx_core.warmup(
                    prompt=prompt,
                    decoder=self._decoder,
                    config=self._mlx_generate_config(),
                    device=self._torch_device,
                    dtype=self._torch.float32,
                )
            else:
                assert self.model is not None
                self.model.generate(
                    prompt=prompt,
                    text="Hello world.",
                    num_transition_steps=5,
                    inference_options=self._default_options(),
                )

        if self._use_mlx:
            _warm()
        else:
            await asyncio.to_thread(_warm)
        self.warmed_up = True

    def mark_voice_warmed(self, voice_id: str) -> None:
        self._warmed_voice_ids.add(voice_id)

    def is_voice_warmed(self, voice_id: str) -> bool:
        return voice_id in self._warmed_voice_ids

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

            if self._use_mlx:
                return self._generate_real_wav_sync(
                    text,
                    reference_audio_path,
                    reference_text,
                    system_prompt,
                )

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
        assert self._torchaudio is not None
        assert self._torch is not None

        encode_start = time.perf_counter()
        prompt = self._encode_reference_sync(reference_audio_path, reference_text)
        encode_time = time.perf_counter() - encode_start

        if self._use_mlx:
            result = self._generate_mlx_wav_sync(prompt, text, system_prompt)
        else:
            result = self._generate_pytorch_wav_sync(prompt, text, system_prompt)

        result["encode_time_seconds"] = encode_time
        result["end_to_end_time_seconds"] = encode_time + float(result["generation_time_seconds"])
        logger.info(
            "TTS timing: encode=%.2fs generate=%.2fs total=%.2fs mode=%s",
            encode_time,
            result["generation_time_seconds"],
            result["end_to_end_time_seconds"],
            "mlx" if self._use_mlx else "pytorch",
        )
        return result

    def _generate_mlx_wav_sync(
        self,
        prompt: Any,
        text: str,
        system_prompt: str | None,
    ) -> dict[str, Any]:
        """Generate audio using MLX hybrid pipeline."""
        assert self._mlx_core is not None
        assert self._torchaudio is not None
        assert self._torch is not None

        start = time.perf_counter()
        wav, gen_time = self._mlx_core.generate(
            prompt=prompt,
            text=text,
            num_transition_steps=5,
            system_prompt=system_prompt,
            config=self._mlx_generate_config(),
            decoder=self._decoder,
            device=self._torch_device,
            dtype=self._torch.float32,
        )
        generation_time = time.perf_counter() - start

        if wav is None:
            return {
                "wav_path": None,
                "sample_rate": 24_000,
                "duration_seconds": 0.0,
                "generation_time_seconds": generation_time,
                "rtf": float("inf"),
            }

        waveform = wav.unsqueeze(0).cpu().float()
        save_start = time.perf_counter()
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as temp_file:
            temp_path = Path(temp_file.name)
        self._torchaudio.save(str(temp_path), waveform, 24_000)
        save_time = time.perf_counter() - save_start

        duration_seconds = waveform.shape[-1] / 24_000
        logger.info(
            "MLX generation timing: core=%.2fs reported_core=%.2fs wav_save=%.2fs audio=%.2fs rtf=%.2fx",
            generation_time,
            gen_time,
            save_time,
            duration_seconds,
            generation_time / max(duration_seconds, 0.001),
        )
        return {
            "wav_path": temp_path,
            "sample_rate": 24_000,
            "duration_seconds": duration_seconds,
            "generation_time_seconds": generation_time,
            "rtf": generation_time / max(duration_seconds, 0.001),
            "core_generation_time_seconds": gen_time,
            "wav_save_time_seconds": save_time,
        }

    def _generate_pytorch_wav_sync(
        self,
        prompt: Any,
        text: str,
        system_prompt: str | None,
    ) -> dict[str, Any]:
        """Generate audio using PyTorch-only pipeline (fallback)."""
        assert self.model is not None
        assert self._torchaudio is not None

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
        save_start = time.perf_counter()
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as temp_file:
            temp_path = Path(temp_file.name)
        self._torchaudio.save(str(temp_path), waveform, 24_000)
        save_time = time.perf_counter() - save_start

        duration_seconds = waveform.shape[-1] / 24_000
        logger.info(
            "PyTorch generation timing: core=%.2fs wav_save=%.2fs audio=%.2fs rtf=%.2fx",
            generation_time,
            save_time,
            duration_seconds,
            generation_time / max(duration_seconds, 0.001),
        )
        return {
            "wav_path": temp_path,
            "sample_rate": 24_000,
            "duration_seconds": duration_seconds,
            "generation_time_seconds": generation_time,
            "rtf": generation_time / max(duration_seconds, 0.001),
            "wav_save_time_seconds": save_time,
        }

    async def unload(self) -> None:
        self.encoder = None
        self.model = None
        self._decoder = None
        self._mlx_core = None
        self._use_mlx = False
        self.device = "cpu"
        self._torch_device = "cpu"
        self.dtype = "float32"
        self.model_loaded = False
        self.warmed_up = False
        self._reference_prompt_cache.clear()
        with contextlib.suppress(Exception):
            if self._torch is not None:
                await asyncio.to_thread(self._torch.cuda.empty_cache)
