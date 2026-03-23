# Same-Mac Clean Validation Checklist

Use this checklist when you do not have a second clean Apple Silicon Mac.

Goal:
- validate the signed App Store build in a reviewer-like environment
- prove the app does not depend on your normal dev setup, caches, or Terminal
  after install

Bundle identifier:
- `com.foundry.vox`

Likely data locations to inspect/reset:
- signed App Store/containerized build: `~/Library/Containers/com.foundry.vox`
- dev/non-sandbox support path: `~/Library/Application Support/Foundry Vox`

## Preferred setup

- Create a dedicated clean macOS user for App Store validation.
- Install and launch only the signed App Store build in that user.

## Fallback setup on your normal user

Only use this if a dedicated clean user is not available.

1. Quit Foundry Vox and any related helper processes.
2. Record the build identifier being tested.
3. Remove or archive existing Foundry Vox app data before install:
   - app container data
   - app support data
   - previous generated output and cached runtime artifacts
4. Ensure no dev-only environment variables are set for the validation run.
5. Ensure the validation path does not rely on:
   - Homebrew `ffmpeg`
   - global Python
   - preseeded model placement by hand
   - any Terminal command after the app is installed

Useful prep commands before the validation run:
- `rm -rf ~/Library/Containers/com.foundry.vox`
- `rm -rf ~/Library/Application\\ Support/Foundry\\ Vox`
- `find ~/Library -maxdepth 4 \\( -path "*com.foundry.vox*" -o -path "*Foundry Vox*" \\) -print`

## Clean validation flow

Mark each step PASS or FAIL.

| Step | Expected result | Status | Notes |
| --- | --- | --- | --- |
| Install signed App Store build | App installs successfully | TODO |  |
| First launch | App opens without Terminal use | TODO |  |
| Warmup/load | Loading state is understandable and finishes | TODO |  |
| Preset generation | Generate succeeds with a bundled preset voice | TODO |  |
| Playback | Latest render plays in-app | TODO |  |
| WAV export | Export succeeds | TODO |  |
| MP3 export | Export succeeds without relying on global tooling | TODO |  |
| AAC export | Export succeeds without relying on global tooling | TODO |  |
| Clone flow | Upload, rights acknowledgment, and clone creation succeed | TODO |  |
| Clone generation | Newly cloned voice can generate audio | TODO |  |
| Relaunch | App relaunches cleanly after first run | TODO |  |

## Required observations

Record these before calling the pass complete:

- Did the app require any manual model placement?
- Did any flow require Terminal use after install?
- Did any export format silently rely on global tools?
- Did any reviewer-visible state look stalled, broken, or confusing?
- Did the app make any claim in the UI that did not match the observed runtime?

## Hard fail conditions

- Any core flow requires Terminal use after install
- Any core flow depends on preexisting dev caches or hand-seeded models
- Any advertised export format fails
- Clone flow or preset generation fails
- The app appears hung or incomplete on first launch
