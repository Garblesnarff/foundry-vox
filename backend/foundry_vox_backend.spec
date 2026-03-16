# -*- mode: python ; coding: utf-8 -*-

import os
from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_submodules

project_root = Path.cwd() / "backend"
datas = [
    (str(project_root / "app" / "presets" / "voices.json"), "app/presets"),
    (str(project_root / "app" / "presets" / "audio"), "app/presets/audio"),
    (str(project_root.parent / "docs" / "licenses"), "licenses"),
]
datas += collect_data_files("tada", include_py_files=True)
datas += collect_data_files("audiotools")
datas += collect_data_files("dac", include_py_files=True)
datas += collect_data_files("mlx", include_py_files=True)

bundled_models_dir = os.getenv("FOUNDRY_VOX_MODELS_SOURCE_DIR")
if bundled_models_dir:
    bundled_models_path = Path(bundled_models_dir).resolve()
else:
    bundled_models_path = project_root.parent / "models"

if bundled_models_path.exists():
    datas.append((str(bundled_models_path), "models"))

a = Analysis(
    [str(project_root / "run_backend.py")],
    pathex=[str(project_root)],
    binaries=[],
    datas=datas,
    hiddenimports=collect_submodules("tada") + collect_submodules("dac") + collect_submodules("mlx") + [
        "app.mlx_tada",
        "app.mlx_tada.convert_weights",
        "app.mlx_tada.decoder",
        "app.mlx_tada.diffusion",
        "app.mlx_tada.generate",
        "app.mlx_tada.hybrid",
        "app.mlx_tada.llm",
        "app.mlx_tada.utils",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="foundry-vox-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="foundry-vox-backend",
)
