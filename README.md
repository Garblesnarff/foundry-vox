# Foundry Vox

Foundry Vox is a macOS desktop app for local text-to-speech generation with a Tauri frontend and a FastAPI sidecar backend, built from [`PRD.md`](/Users/rob/Claude/vox/PRD.md).

## Project layout

- [`frontend`](/Users/rob/Claude/vox/frontend): React + Vite desktop UI
- [`backend`](/Users/rob/Claude/vox/backend): FastAPI backend, SQLite persistence, TADA engine integration
- [`src-tauri`](/Users/rob/Claude/vox/src-tauri): native macOS shell, sidecar bundling, App Store config
- [`docs/release.md`](/Users/rob/Claude/vox/docs/release.md): release and App Store notes

## Verified locally

- `npm run build:web`
- `uv run --project backend --python 3.12 ruff check backend/app tests/backend`
- `uv run --project backend --python 3.12 python -m pytest tests/backend`
- `npx tauri build --bundles app`
- `npx tauri build --bundles app --config src-tauri/tauri.appstore.conf.json`

## Output

- macOS bundle: [`src-tauri/target/release/bundle/macos/Foundry Vox.app`](/Users/rob/Claude/vox/src-tauri/target/release/bundle/macos/Foundry%20Vox.app)
- Sidecar binary: [`src-tauri/binaries/foundry-vox-backend-aarch64-apple-darwin`](/Users/rob/Claude/vox/src-tauri/binaries/foundry-vox-backend-aarch64-apple-darwin)

## Notes

- The checked-in preset WAV files are development placeholders generated locally. Replace them with rights-reviewed production references before App Store submission.
- The backend runtime is currently pinned to Python 3.11 or 3.12 because the current `pydub` stack is not ready for Python 3.13.
- Actual App Store submission still requires your Apple signing identity, provisioning profile, and notarization credentials.
