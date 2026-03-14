"""Hybrid MLX/PyTorch inference for TADA-1B.

Uses MLX for the autoregressive LLM loop (Metal GPU) and optionally
MLX for the decoder too. PyTorch encoder runs once (not the bottleneck).
"""

from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import Any

import mlx.core as mx
import mlx.nn as nn_mlx
import numpy as np

from .generate import GenerateConfig, generate
from .llm import TadaMLX, TadaModelConfig

logger = logging.getLogger(__name__)


def torch_to_mlx(t: Any, dtype: Any = None) -> mx.array:
    """Convert PyTorch tensor to MLX array."""
    import torch

    if t.dtype == torch.bfloat16:
        np_arr = t.float().numpy()
    elif t.dtype == torch.bool:
        np_arr = t.numpy()
    else:
        np_arr = t.detach().cpu().numpy()
    arr = mx.array(np_arr)
    if dtype is not None:
        arr = arr.astype(dtype)
    return arr


def mlx_to_torch(a: mx.array, dtype: Any = None) -> Any:
    """Convert MLX array to PyTorch tensor."""
    import torch

    if dtype is None:
        dtype = torch.float32
    return torch.from_numpy(np.array(a)).to(dtype)


class MLXInferenceCore:
    """MLX model core: loads MLX weights and runs the generation loop.

    This is separated from encoder/decoder management so that the
    existing TadaEngine can provide those via PyTorch.
    """

    def __init__(
        self,
        weights_dir: str | Path,
        quantize_llm: bool = True,
        use_mlx_decoder: bool = True,
    ) -> None:
        weights_dir = Path(weights_dir)

        t0 = time.time()
        config_path = weights_dir / "config.json"
        with open(config_path) as f:
            config_dict = json.load(f)
        self.config = TadaModelConfig(**config_dict)
        self.model = TadaMLX(self.config)

        weights_path = weights_dir / "weights.safetensors"
        weights = mx.load(str(weights_path))
        self.model.load_weights(list(weights.items()))

        if quantize_llm:
            logger.info("Quantizing LLM backbone to 4-bit...")
            for layer in self.model.model.layers:
                nn_mlx.quantize(layer, bits=4, group_size=64)

        mx.eval(self.model.parameters())
        logger.info("MLX model loaded in %.1fs", time.time() - t0)

        # Load MLX decoder if available
        self.mlx_decoder = None
        if use_mlx_decoder:
            decoder_weights_path = weights_dir / "decoder_weights.safetensors"
            if decoder_weights_path.exists():
                t0 = time.time()
                from .decoder import DecoderMLX
                self.mlx_decoder = DecoderMLX()
                dec_weights = mx.load(str(decoder_weights_path))
                self.mlx_decoder.load_weights(list(dec_weights.items()))
                mx.eval(self.mlx_decoder.parameters())
                logger.info("MLX decoder loaded in %.1fs", time.time() - t0)
            else:
                logger.info("MLX decoder weights not found, will use PyTorch decoder")

        # Cache tokenizer info (set by TadaEngine after encoder is loaded)
        self.tokenizer: Any = None
        self.tokenizer_info: dict[str, int] = {}

    def set_tokenizer(self, tokenizer: Any) -> None:
        """Set tokenizer and cache special token IDs."""
        self.tokenizer = tokenizer
        self.tokenizer_info = {
            "start_header_id": tokenizer.convert_tokens_to_ids("<|start_header_id|>"),
            "end_header_id": tokenizer.convert_tokens_to_ids("<|end_header_id|>"),
            "eot_id": tokenizer.convert_tokens_to_ids("<|eot_id|>"),
            "pad_id": tokenizer.convert_tokens_to_ids("<|finetune_right_pad_id|>"),
            "bos_id": tokenizer.bos_token_id,
            "eos_id": tokenizer.eos_token_id,
        }

    def generate(
        self,
        *,
        prompt: Any,
        text: str,
        num_transition_steps: int = 5,
        system_prompt: str | None = None,
        config: GenerateConfig | None = None,
        decoder: Any = None,
        device: str = "cpu",
        dtype: Any = None,
    ) -> tuple[Any, float]:
        """Run the hybrid MLX generation pipeline.

        Args:
            prompt: EncoderOutput from TADA encoder
            text: Text to synthesize
            num_transition_steps: Transition steps for voice blending
            system_prompt: Optional system prompt for emotion/style
            config: Generation config
            decoder: PyTorch TADA decoder for audio synthesis (fallback if no MLX decoder)
            device: PyTorch device for decoder
            dtype: PyTorch dtype for decoder

        Returns:
            (waveform_tensor, generation_time_seconds)
        """
        import torch

        if dtype is None:
            dtype = torch.float32
        if config is None:
            config = GenerateConfig()

        from tada.utils.text import normalize_text as normalize_text_fn

        text = normalize_text_fn(text)

        # Build input_ids the same way TADA does
        prompt_text = prompt.text[0]
        text_tokens = [
            self.tokenizer.encode(prompt_text, add_special_tokens=False)
            + self.tokenizer.encode(text, add_special_tokens=False)
        ]
        input_ids = torch.tensor(text_tokens, device=device)
        input_lengths = torch.tensor([len(text_tokens[0])], device=device)

        # Add BOS/EOS (same as TADA's _add_bos_eos)
        shift_acoustic = self.config.shift_acoustic
        eos_id = self.tokenizer_info["eot_id"]
        bos_id = self.tokenizer_info["bos_id"]
        input_ids = torch.nn.functional.pad(input_ids, (0, shift_acoustic), value=eos_id)
        input_ids = torch.where(input_ids == -1, eos_id, input_ids)
        input_ids = torch.nn.functional.pad(input_ids, (1, 0), value=bos_id)
        input_lengths = input_lengths + shift_acoustic + 1

        # Build time gaps (same as TADA's generate())
        token_positions = prompt.token_positions
        audio_feat_len = (prompt.audio_len / prompt.sample_rate * 50).ceil().long()

        selected_positions_with_ending = torch.where(
            torch.arange(token_positions.shape[1], device=device).expand(token_positions.shape[0], -1)
            == input_lengths.reshape(-1, 1) - shift_acoustic - 1,
            audio_feat_len.unsqueeze(-1),
            token_positions,
        )
        time_gaps = (
            selected_positions_with_ending
            - torch.nn.functional.pad(selected_positions_with_ending, [1, 0], value=1)[:, :-1]
        ).clamp(min=0, max=self.config.num_time_classes - 1)
        time_gaps = torch.nn.functional.pad(time_gaps, [1, 0], value=0)
        time_len_before = time_gaps[:, :-1]
        time_len_after = time_gaps[:, 1:]

        prompt_acoustic_features = prompt.token_values
        prompt_acoustic_masks = torch.ones(
            prompt_acoustic_features.shape[:2], device=device, dtype=torch.long
        )

        # Add system prompt prefix
        prefix_text = (
            f"<|start_header_id|>system<|end_header_id|>{system_prompt or ''}<|eot_id|>"
            + "<|start_header_id|>assistant<|end_header_id|>"
        )
        prefix_text_tokens = self.tokenizer.encode(prefix_text, add_special_tokens=False, return_tensors="pt").to(
            device
        )
        prefix_len = prefix_text_tokens.shape[1]
        input_ids = torch.cat([input_ids[:, :1], prefix_text_tokens, input_ids[:, 1:]], dim=1)
        input_lengths = input_lengths + prefix_len
        prompt_acoustic_features = torch.nn.functional.pad(prompt_acoustic_features, (0, 0, prefix_len, 0))
        prompt_acoustic_masks = torch.nn.functional.pad(prompt_acoustic_masks, (prefix_len, 0))
        time_len_before = torch.nn.functional.pad(time_len_before, (prefix_len, 0))
        time_len_after = torch.nn.functional.pad(time_len_after, (prefix_len, 0))

        if num_transition_steps > 0:
            prompt_acoustic_features = prompt_acoustic_features[:, :-num_transition_steps, :]
            prompt_acoustic_masks = prompt_acoustic_masks[:, :-num_transition_steps]
            time_len_before = time_len_before[:, :-num_transition_steps]
            time_len_after = time_len_after[:, :-num_transition_steps]

        # Shift acoustic masks: same as TADA
        prompt_acoustic_masks_shifted = torch.cat(
            [prompt_acoustic_masks[:, 1:], torch.ones_like(prompt_acoustic_masks[:, :1])], -1
        )

        num_gen_steps = input_ids.shape[-1]

        # Convert tensors to MLX
        mlx_input_ids = torch_to_mlx(input_ids, dtype=mx.int32)
        mlx_prompt_acoustic = torch_to_mlx(prompt_acoustic_features.float())
        mlx_prompt_masks = torch_to_mlx(prompt_acoustic_masks_shifted, dtype=mx.int32)
        mlx_time_before = torch_to_mlx(time_len_before, dtype=mx.int32)
        mlx_time_after = torch_to_mlx(time_len_after, dtype=mx.int32)

        # Run MLX generation loop
        logger.info("Running MLX generation (%d steps)...", num_gen_steps)
        t0 = time.time()
        output = generate(
            model=self.model,
            input_ids=mlx_input_ids,
            prompt_acoustic_features=mlx_prompt_acoustic,
            prompt_acoustic_masks=mlx_prompt_masks,
            prompt_time_len_before=mlx_time_before,
            prompt_time_len_after=mlx_time_after,
            config=config,
            tokenizer_info=self.tokenizer_info,
            num_steps=num_gen_steps,
        )
        gen_time = time.time() - t0

        num_prompt_tokens = prompt_acoustic_features.shape[1]
        start_idx = num_prompt_tokens + num_transition_steps - 1

        # Choose decode path
        if self.mlx_decoder is not None:
            wav = self._decode_mlx(output, start_idx)
        elif decoder is not None:
            wav = self._decode_pytorch(output, start_idx, decoder, device, dtype)
        else:
            wav = None

        if wav is not None:
            # Remove leading silence
            time_before_val = int(np.array(output.time_before[0, start_idx]).item())
            leading_silence_samples = int(24000 * time_before_val / 50)
            wav = wav[..., leading_silence_samples:]

        return wav, gen_time

    def _decode_mlx(self, output: Any, start_idx: int) -> Any:
        """Decode using MLX decoder (fully on Metal GPU)."""
        import torch

        t_dec = time.time()

        acoustic_features = output.acoustic_features[:, start_idx:]
        time_before = output.time_before[:, start_idx:]

        # Denormalize
        acoustic_features = acoustic_features * self.config.acoustic_std + self.config.acoustic_mean

        if acoustic_features.shape[1] == 0:
            return None

        # Expand features using time_before
        encoded = acoustic_features[0]  # (T, 512)
        tb = time_before[0]  # (T,)

        parts = []
        for pos in range(encoded.shape[0]):
            n_frames = max(0, int(tb[pos].item()) - 1)
            if n_frames > 0:
                parts.append(mx.zeros((n_frames, encoded.shape[-1])))
            parts.append(encoded[pos:pos+1])

        if tb.shape[0] > encoded.shape[0]:
            n_trailing = int(tb[-1].item())
            if n_trailing > 0:
                parts.append(mx.zeros((n_trailing, encoded.shape[-1])))

        if not parts:
            return None

        encoded_expanded = mx.concatenate(parts, axis=0)[None]
        token_masks = (mx.sqrt((encoded_expanded * encoded_expanded).sum(axis=-1)) != 0).astype(mx.int32)

        wav = self.mlx_decoder.generate(encoded_expanded, token_masks)
        mx.eval(wav)

        logger.info("MLX decode: %.1fs", time.time() - t_dec)

        # Convert to PyTorch tensor for compatibility with TadaEngine
        wav_np = np.array(wav.squeeze())
        return torch.from_numpy(wav_np)

    def _decode_pytorch(
        self, output: Any, start_idx: int,
        decoder: Any, device: str, dtype: Any,
    ) -> Any:
        """Decode using PyTorch decoder (CPU fallback)."""
        import torch

        t_dec = time.time()

        acoustic_features_pt = mlx_to_torch(output.acoustic_features, dtype=dtype)
        acoustic_features_pt = acoustic_features_pt * self.config.acoustic_std + self.config.acoustic_mean
        time_before_pt = mlx_to_torch(output.time_before, dtype=torch.long)

        encoded = acoustic_features_pt[:, start_idx:]
        time_before = time_before_pt[:, start_idx:]

        if encoded.shape[1] == 0:
            return None

        wav = self._decode_wav(decoder, encoded[0], time_before[0], device=device, dtype=dtype)
        logger.info("PyTorch decode: %.1fs", time.time() - t_dec)
        return wav

    @staticmethod
    def _decode_wav(
        decoder: Any,
        encoded: Any,
        time_before: Any,
        device: str = "cpu",
        dtype: Any = None,
    ) -> Any:
        """Decode acoustic features to audio waveform using PyTorch decoder."""
        import torch

        if dtype is None:
            dtype = torch.float32
        encoded = encoded.to(device)
        time_before = time_before.to(device)

        if time_before.shape[0] == 0:
            return None

        time_before = time_before[: encoded.shape[0] + 1]

        encoded_expanded = []
        for pos in range(encoded.shape[0]):
            n_frames = int((time_before[pos] - 1).clamp(min=0).item())
            encoded_expanded.append(torch.zeros(n_frames, encoded.shape[-1], device=device, dtype=dtype))
            encoded_expanded.append(encoded[pos].unsqueeze(0))

        n_trailing = int(time_before[-1].item()) if time_before.shape[0] > encoded.shape[0] else 0
        encoded_expanded.append(torch.zeros(n_trailing, encoded.shape[-1], device=device, dtype=dtype))

        if not encoded_expanded:
            return None

        encoded_expanded_t = torch.cat(encoded_expanded, dim=0).unsqueeze(0)
        token_masks = (torch.norm(encoded_expanded_t, dim=-1) != 0).long()

        with torch.no_grad():
            wav = decoder.generate(encoded_expanded_t, token_masks=token_masks)

        return wav.squeeze(0, 1)

    def warmup(
        self,
        prompt: Any,
        decoder: Any = None,
        config: GenerateConfig | None = None,
        device: str = "cpu",
        dtype: Any = None,
    ) -> None:
        """Run warmup generations to prime Metal kernel caches.

        A short prompt alone doesn't compile kernels for longer sequences.
        Running progressively longer prompts ensures steady-state performance
        from the first real generation.
        """
        logger.info("MLX warmup (3-stage)...")
        self.generate(
            prompt=prompt,
            text="Hi.",
            num_transition_steps=0,
            config=config,
            decoder=decoder,
            device=device,
            dtype=dtype,
        )
        self.generate(
            prompt=prompt,
            text="This is a warmup sentence to compile Metal kernels for longer sequences.",
            num_transition_steps=5,
            config=config,
            decoder=decoder,
            device=device,
            dtype=dtype,
        )
        self.generate(
            prompt=prompt,
            text="And this is a third warmup prompt that is even longer to ensure the decoder kernels are also compiled for various audio lengths and durations.",
            num_transition_steps=5,
            config=config,
            decoder=decoder,
            device=device,
            dtype=dtype,
        )
        logger.info("MLX warmup complete")
