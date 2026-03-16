from __future__ import annotations

import argparse
import os
import time
from pathlib import Path

import torch
import torchaudio

torch.set_float32_matmul_precision("medium")
torch.set_num_threads(os.cpu_count() or 4)

import mlx.core as mx

from app.config import get_app_paths
from app.mlx_tada.generate import GenerateConfig
from app.mlx_tada.hybrid import MLXInferenceCore
from tada.modules.encoder import Encoder


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Standalone MLX RTF benchmark for Foundry Vox.")
    parser.add_argument(
        "--weights-dir",
        type=Path,
        default=get_app_paths().models_dir / "mlx-tada-1b-weights",
        help="Path to the converted MLX weights directory.",
    )
    parser.add_argument(
        "--reference-audio",
        type=Path,
        default=get_app_paths().presets_dir / "warm-narrator.wav",
        help="Reference WAV path.",
    )
    parser.add_argument(
        "--reference-text",
        default="The forge burns brightest at midnight. Every voice begins as raw metal, waiting for its final shape.",
        help="Transcript for the reference audio.",
    )
    return parser.parse_args()


def local_snapshot_dir(models_dir: Path, repo_id: str) -> Path:
    org, name = repo_id.split("/", 1)
    repo_path = models_dir / f"models--{org}--{name}"
    ref_path = repo_path / "refs" / "main"
    snapshots_dir = repo_path / "snapshots"
    if ref_path.exists():
        snapshot_dir = snapshots_dir / ref_path.read_text(encoding="utf-8").strip()
        if snapshot_dir.exists():
            return snapshot_dir
    snapshot_dirs = sorted(path for path in snapshots_dir.iterdir() if path.is_dir())
    if not snapshot_dirs:
        raise FileNotFoundError(f"No local snapshots found for {repo_id} in {models_dir}")
    return snapshot_dirs[-1]


def build_config() -> GenerateConfig:
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


def main() -> None:
    args = parse_args()
    paths = get_app_paths()

    mx.random.seed(42)
    config = build_config()

    print(f"Using weights: {args.weights_dir}")
    print(f"Using reference audio: {args.reference_audio}")

    core = MLXInferenceCore(args.weights_dir, quantize_llm=True, use_mlx_decoder=True)

    encoder_snapshot = local_snapshot_dir(paths.models_dir, "HumeAI/tada-codec")
    encoder = Encoder.from_pretrained(str(encoder_snapshot), subfolder="encoder").to("cpu")
    encoder.eval()
    core.set_tokenizer(encoder.tokenizer)

    audio, sample_rate = torchaudio.load(str(args.reference_audio))
    if audio.shape[0] > 1:
        audio = audio.mean(dim=0, keepdim=True)
    audio = audio.to("cpu", torch.float32)

    prompt = encoder(
        audio,
        text=[args.reference_text],
        audio_length=torch.tensor([audio.shape[1]], device="cpu"),
        sample_rate=sample_rate,
    )

    print("Running 3-stage warmup...")
    core.warmup(prompt=prompt, config=config, device="cpu", dtype=torch.float32)

    texts = [
        "Hello, this is a speed test.",
        "The quick brown fox jumps over the lazy dog near the riverbank.",
        "In the beginning, there was nothing but silence. Then came the voice, clear and resonant, filling every corner of the room with warmth and presence.",
    ]

    for text in texts:
        t0 = time.perf_counter()
        wav, gen_time = core.generate(
            prompt=prompt,
            text=text,
            num_transition_steps=5,
            config=config,
            device="cpu",
            dtype=torch.float32,
        )
        wall = time.perf_counter() - t0
        duration = wav.shape[-1] / 24000
        print(
            f"RTF: {wall / duration:.2f}x | Wall: {wall:.2f}s | Core: {gen_time:.2f}s | "
            f"Audio: {duration:.2f}s | {text[:60]}"
        )


if __name__ == "__main__":
    main()
