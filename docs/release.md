# Foundry Vox Release Notes

The canonical App Store submission process now lives in
[`docs/app-store-runbook.md`](/Users/rob/Claude/vox/docs/app-store-runbook.md).
Use this file for build/reference notes, and use the runbook for the actual
submission gate.

## Local build

1. `npm install`
2. `npm --prefix frontend install`
3. `uv sync --project backend --extra dev`
4. `rustup toolchain install stable`
5. `cargo install tauri-cli` if you prefer the Rust CLI instead of the npm package
6. `npm run tauri:build`

## App Store build

1. Build the bundled sidecar: `npm run build:sidecar`
2. Generate the frontend: `npm run build:web`
3. Ensure `src-tauri/entitlements.plist` matches your signing requirements
4. Provide the correct Apple signing identity and provisioning profile in your local Xcode/Keychain setup
5. Run `npm run tauri:build:appstore`
6. Build the signed App Store installer package:
   `APP_SIGN_IDENTITY="Apple Distribution: Your Name (TEAMID)" INSTALLER_SIGN_IDENTITY="3rd Party Mac Developer Installer: Your Name (TEAMID)" npm run package:appstore`
7. Run the full submission gate in [`docs/app-store-runbook.md`](/Users/rob/Claude/vox/docs/app-store-runbook.md) before submitting the signed build.

## Runtime shape

- The packaged app uses Tauri/Rust as the shell-facing API layer.
- The Python backend still exists, but it now sits behind Tauri commands for the main product flows instead of exposing a browser-style app surface.
- The packaged backend runs on a dynamic loopback port with runtime token auth.
- Generated audio, exports, and voice preview flows now route through native shell helpers or local file URLs instead of relying on generic webview fetches.
- Use [`docs/app-store-rejection-map.md`](/Users/rob/Claude/vox/docs/app-store-rejection-map.md) for the reusable rejection guide, [`docs/app-store-preflight-foundry-vox.md`](/Users/rob/Claude/vox/docs/app-store-preflight-foundry-vox.md) for the product-specific risk audit, and [`docs/app-store-runbook.md`](/Users/rob/Claude/vox/docs/app-store-runbook.md) for the actual release gate.

## Entitlement rationale

- `com.apple.security.app-sandbox`: required for the App Store build.
- `com.apple.security.files.user-selected.read-write`: needed for user-picked imports and exports.
- `com.apple.security.network.client`: currently required because the Tauri shell talks to the bundled backend over authenticated local loopback.

If the shell-to-backend transport changes in the future, re-audit `network.client` before submission.

## Local model setup

- Foundry Vox prefers local model assets before attempting remote Hugging Face access.
- The app models directory is under the app data root as `models/`.
- On macOS dev builds, that path is typically `~/Library/Application Support/Foundry Vox/models`.
- The in-app setup card can open the models folder directly.

## Notes

- The backend is packaged as a bundled external binary sidecar via PyInstaller.
- `FOUNDRY_VOX_INCLUDE_ML=0 npm run build:sidecar` is available for shell-only verification builds; production App Store builds should leave ML inclusion enabled.
- The current configuration targets Apple Silicon and macOS 13+.
- The backend runtime is pinned to Python 3.11 or 3.12 because the current `pydub` stack is not ready for Python 3.13.
- The bundled preset WAVs are development placeholder references generated locally; replace them with rights-reviewed production assets before App Store submission.
- Verified on March 13, 2026 with:
  - `npx tauri build --bundles app`
  - `npx tauri build --bundles app --config src-tauri/tauri.appstore.conf.json`
- App Store submission still requires Apple-issued signing certificates, provisioning profiles, and notarization credentials on the build machine.
