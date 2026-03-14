# -*- mode: python ; coding: utf-8 -*-

from pathlib import Path

project_root = Path.cwd() / "backend"
datas = [
    (str(project_root / "app" / "presets" / "voices.json"), "app/presets"),
    (str(project_root / "app" / "presets" / "audio"), "app/presets/audio"),
    (str(project_root.parent / "docs" / "licenses"), "licenses"),
]

a = Analysis(
    [str(project_root / "run_backend.py")],
    pathex=[str(project_root)],
    binaries=[],
    datas=datas,
    hiddenimports=[
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
