from __future__ import annotations

import argparse
import json
import os
import time
from pathlib import Path

import torch
import torchaudio

torch.set_float32_matmul_precision("medium")
torch.set_num_threads(os.cpu_count() or 4)

import mlx.core as mx

from app.config import get_app_paths
from app.engine import TadaEngine
from app.mlx_tada.generate import GenerateConfig
from app.mlx_tada.hybrid import MLXInferenceCore
from tada.modules.encoder import Encoder


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Standalone MLX RTF benchmark for Foundry Vox.")
    parser.add_argument(
        "--baseline-file",
        type=Path,
        default=Path(__file__).with_name("engine_baseline.json"),
        help="Path to the checked-in engine baseline JSON.",
    )
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
    parser.add_argument(
        "--skip-checks",
        action="store_true",
        help="Run the benchmark without enforcing the checked-in config and perf thresholds.",
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


def build_config(baseline: dict[str, object]) -> GenerateConfig:
    return GenerateConfig(**baseline["generate_config"])


def load_baseline(path: Path) -> dict[str, object]:
    return json.loads(path.read_text(encoding="utf-8"))


def audit_generate_config(paths: object, baseline: dict[str, object]) -> None:
    expected = baseline["generate_config"]
    engine = TadaEngine(model_name=str(baseline["model"]), num_threads=os.cpu_count() or 4, models_dir=paths.models_dir)
    actual = engine._mlx_generate_config()

    mismatches: list[str] = []
    for key, expected_value in expected.items():
        actual_value = getattr(actual, key)
        if actual_value != expected_value:
            mismatches.append(f"{key}: expected {expected_value!r}, got {actual_value!r}")

    if mismatches:
        raise SystemExit(
            "MLX generate config drifted from the checked-in baseline:\n- " + "\n- ".join(mismatches)
        )


def summarize_results(results: list[dict[str, float]]) -> dict[str, float]:
    average_rtf = sum(item["rtf"] for item in results) / max(len(results), 1)
    max_rtf = max(item["rtf"] for item in results)
    long_prompt_rtf = results[-1]["rtf"]
    return {
        "average_rtf": average_rtf,
        "max_rtf": max_rtf,
        "long_prompt_rtf": long_prompt_rtf,
    }


def check_thresholds(summary: dict[str, float], baseline: dict[str, object]) -> None:
    thresholds = baseline["thresholds"]
    failures: list[str] = []
    if summary["average_rtf"] > thresholds["max_average_rtf"]:
        failures.append(
            f"average_rtf {summary['average_rtf']:.2f}x exceeded {thresholds['max_average_rtf']:.2f}x"
        )
    if summary["max_rtf"] > thresholds["max_single_rtf"]:
        failures.append(
            f"max_rtf {summary['max_rtf']:.2f}x exceeded {thresholds['max_single_rtf']:.2f}x"
        )
    if summary["long_prompt_rtf"] > thresholds["max_long_prompt_rtf"]:
        failures.append(
            f"long_prompt_rtf {summary['long_prompt_rtf']:.2f}x exceeded {thresholds['max_long_prompt_rtf']:.2f}x"
        )

    if failures:
        raise SystemExit("MLX benchmark failed the checked-in baseline:\n- " + "\n- ".join(failures))


def main() -> None:
    args = parse_args()
    paths = get_app_paths()
    baseline = load_baseline(args.baseline_file)

    mx.random.seed(42)
    config = build_config(baseline)

    if not args.skip_checks:
        audit_generate_config(paths, baseline)

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

    texts = list(baseline["benchmark_texts"])
    results: list[dict[str, float]] = []

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
        rtf = wall / duration
        results.append({"rtf": rtf, "wall": wall, "core": gen_time, "audio": duration})
        print(
            f"RTF: {rtf:.2f}x | Wall: {wall:.2f}s | Core: {gen_time:.2f}s | "
            f"Audio: {duration:.2f}s | {text[:60]}"
        )

    summary = summarize_results(results)
    print(
        "Summary: "
        f"avg={summary['average_rtf']:.2f}x | "
        f"max={summary['max_rtf']:.2f}x | "
        f"long={summary['long_prompt_rtf']:.2f}x"
    )

    if not args.skip_checks:
        check_thresholds(summary, baseline)
        print(f"Baseline check passed against {args.baseline_file}")


if __name__ == "__main__":
    main()
