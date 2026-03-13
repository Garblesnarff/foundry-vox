"""Convert PyTorch TADA-1B weights to MLX format.

Usage:
    python -m mlx_tada.convert_weights

Reads from HuggingFace cache, writes to /Volumes/T7/mlx-tada-weights/
"""

import glob
import os

import mlx.core as mx
import numpy as np


def convert_torch_to_mlx(tensor_pt, dtype=mx.bfloat16):
    """Convert a PyTorch tensor to MLX array with specified dtype."""
    # Convert bfloat16 to float32 numpy first, then to MLX
    import torch
    if tensor_pt.dtype == torch.bfloat16:
        tensor_np = tensor_pt.float().numpy()
    elif tensor_pt.dtype == torch.bool:
        tensor_np = tensor_pt.numpy()
        return mx.array(tensor_np)
    else:
        tensor_np = tensor_pt.numpy()
    return mx.array(tensor_np).astype(dtype)


def load_pytorch_weights(models_dir: str | None = None):
    """Load weights from safetensors using PyTorch framework.

    Searches both the default HuggingFace cache and an optional custom models directory.
    """
    from safetensors import safe_open

    search_patterns = [
        os.path.expanduser("~/.cache/huggingface/hub/models--HumeAI--tada-1b/snapshots/*/model.safetensors"),
    ]
    if models_dir:
        search_patterns.insert(0, os.path.join(models_dir, "models--HumeAI--tada-1b/snapshots/*/model.safetensors"))

    paths = []
    for pattern in search_patterns:
        paths = glob.glob(pattern)
        if paths:
            break
    if not paths:
        raise FileNotFoundError(f"No safetensors found in search paths: {search_patterns}")

    weights = {}
    with safe_open(paths[0], framework="pt") as f:
        for key in f.keys():
            weights[key] = f.get_tensor(key)
    return weights


def map_llama_weights(pt_weights: dict) -> dict:
    """Map PyTorch Llama weights to MLX naming convention."""
    mlx_weights = {}

    for key, val in pt_weights.items():
        if key.startswith("_decoder."):
            continue  # Skip decoder weights for now

        # Map PyTorch key to MLX key
        mlx_key = key

        # prediction_head: map Sequential-based adaLN_modulation to our naming
        # PyTorch: prediction_head.layers.N.adaLN_modulation.1.weight
        #    → MLX: prediction_head.layers.N.adaLN_linear.weight
        if "adaLN_modulation.1.weight" in key:
            mlx_key = key.replace("adaLN_modulation.1.weight", "adaLN_linear.weight")

        # prediction_head timestep embedder: mlp.0 → linear1, mlp.2 → linear2
        if "t_embedder.mlp.0.weight" in key:
            mlx_key = key.replace("t_embedder.mlp.0.weight", "t_embedder.linear1.weight")
        elif "t_embedder.mlp.2.weight" in key:
            mlx_key = key.replace("t_embedder.mlp.2.weight", "t_embedder.linear2.weight")

        # prediction_head FFN: keep same naming (gate_proj, up_proj, down_proj)
        # noisy_images_proj, cond_proj: same naming

        # acoustic_proj has bias in PyTorch
        # acoustic_mask_emb, time_start_embed, time_end_embed: same naming

        mlx_weights[mlx_key] = convert_torch_to_mlx(val)

    return mlx_weights


def verify_weights(mlx_weights: dict):
    """Print summary of converted weights."""
    total_params = 0
    prefixes = set()
    for key, val in sorted(mlx_weights.items()):
        prefix = key.split(".")[0]
        prefixes.add(prefix)
        total_params += val.size

    print(f"Total keys: {len(mlx_weights)}")
    print(f"Total parameters: {total_params / 1e6:.1f}M")
    print(f"Top-level prefixes: {sorted(prefixes)}")

    # Verify key shapes
    checks = [
        ("model.embed_tokens.weight", (128256, 2048)),
        ("model.layers.0.self_attn.q_proj.weight", (2048, 2048)),
        ("model.layers.0.self_attn.k_proj.weight", (512, 2048)),
        ("prediction_head.noisy_images_proj.weight", (2048, 528)),
        ("prediction_head.layers.0.adaLN_linear.weight", (6144, 2048)),
        ("acoustic_proj.weight", (2048, 512)),
        ("time_start_embed.weight", (256, 2048)),
    ]
    for key, expected_shape in checks:
        if key in mlx_weights:
            actual = mlx_weights[key].shape
            status = "OK" if tuple(actual) == expected_shape else f"MISMATCH (got {actual})"
            print(f"  {key}: {status}")
        else:
            print(f"  {key}: MISSING")


def main():
    output_dir = "/Volumes/T7/mlx-tada-weights"
    os.makedirs(output_dir, exist_ok=True)

    print("Loading PyTorch weights...")
    pt_weights = load_pytorch_weights()
    print(f"Loaded {len(pt_weights)} keys")

    print("Converting to MLX format...")
    mlx_weights = map_llama_weights(pt_weights)

    print("\nVerification:")
    verify_weights(mlx_weights)

    # Save as safetensors
    output_path = os.path.join(output_dir, "weights.safetensors")
    print(f"\nSaving to {output_path}...")
    mx.save_safetensors(output_path, mlx_weights)

    # Also save config
    import json
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
    config_path = os.path.join(output_dir, "config.json")
    with open(config_path, "w") as f:
        json.dump(config, f, indent=2)

    print("Done!")


if __name__ == "__main__":
    main()
