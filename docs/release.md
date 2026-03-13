# Foundry Vox Release Notes

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

## Notes

- The backend is packaged as a bundled external binary sidecar via PyInstaller.
- `FOUNDRY_VOX_INCLUDE_ML=0 npm run build:sidecar` is available for shell-only verification builds; production App Store builds should leave ML inclusion enabled.
- The current configuration targets Apple Silicon and macOS 13+.
- The backend runtime is pinned to Python 3.11 or 3.12 because the current `pydub` stack is not ready for Python 3.13.
- The bundled preset WAVs are development placeholder references generated locally; replace them with rights-reviewed production assets before App Store submission.
- App Store submission still requires Apple-issued signing certificates, provisioning profiles, and notarization credentials on the build machine.
