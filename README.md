# Foundry Vox

Foundry Vox is a macOS desktop app for local text-to-speech generation, built from [`PRD.md`](/Users/rob/Claude/vox/PRD.md).

The current app uses a hybrid desktop architecture:
- Tauri/Rust is the native app shell and primary app-facing API boundary
- React/Vite renders the interface
- Python/FastAPI remains the internal ML engine sidecar for TADA inference

The frontend no longer behaves like a generic localhost web client. Core app state, generation, clone uploads, export, setup actions, and progress updates are routed through Tauri commands.

## Project layout

- [`frontend`](/Users/rob/Claude/vox/frontend): React + Vite desktop UI
- [`backend`](/Users/rob/Claude/vox/backend): FastAPI backend, SQLite persistence, TADA engine integration
- [`src-tauri`](/Users/rob/Claude/vox/src-tauri): native macOS shell, sidecar bundling, App Store config
- [`docs/release.md`](/Users/rob/Claude/vox/docs/release.md): release and App Store notes
- [`docs/app-store-runbook.md`](/Users/rob/Claude/vox/docs/app-store-runbook.md): canonical App Store submission runbook and pass/fail gate
- [`docs/app-store-rejection-map.md`](/Users/rob/Claude/vox/docs/app-store-rejection-map.md): reusable App Store rejection guide for future apps
- [`docs/app-store-preflight-foundry-vox.md`](/Users/rob/Claude/vox/docs/app-store-preflight-foundry-vox.md): Foundry Vox-specific App Store submission checklist

## Verified locally

- `npm run build:web`
- `uv run --project backend --python 3.12 ruff check backend/app tests/backend`
- `uv run --project backend --python 3.12 python -m pytest tests/backend`
- `npx tauri build --bundles app`
- `npx tauri build --bundles app --config src-tauri/tauri.appstore.conf.json`

## Output

- macOS bundle: [`src-tauri/target/release/bundle/macos/Foundry Vox.app`](/Users/rob/Claude/vox/src-tauri/target/release/bundle/macos/Foundry%20Vox.app)
- Sidecar binary: [`src-tauri/binaries/foundry-vox-backend-aarch64-apple-darwin`](/Users/rob/Claude/vox/src-tauri/binaries/foundry-vox-backend-aarch64-apple-darwin)

## Runtime notes

- Foundry Vox now prefers local model assets before attempting remote Hugging Face access.
- On macOS, the app stores its working data under `~/Library/Application Support/Foundry Vox`.
- The model cache directory is `~/Library/Application Support/Foundry Vox/models` in dev, and the packaged app exposes the same models folder through the in-app setup card.

## Notes

- The checked-in preset WAV files are development placeholders generated locally. Replace them with rights-reviewed production references before App Store submission.
- The backend runtime is currently pinned to Python 3.11 or 3.12 because the current `pydub` stack is not ready for Python 3.13.
- Actual App Store submission still requires your Apple signing identity, provisioning profile, and notarization credentials.
