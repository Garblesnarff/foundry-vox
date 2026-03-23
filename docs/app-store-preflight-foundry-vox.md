# Foundry Vox App Store Preflight

This file is the product-specific risk audit for Foundry Vox.
For the actual submission process and pass/fail release gate, use
[`docs/app-store-runbook.md`](/Users/rob/Claude/vox/docs/app-store-runbook.md).

It applies the generic rejection map in
[`docs/app-store-rejection-map.md`](/Users/rob/Claude/vox/docs/app-store-rejection-map.md)
to the current codebase and packaging model.

Primary Apple references:
- [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Configuring the macOS App Sandbox](https://developer.apple.com/documentation/xcode/configuring-the-macos-app-sandbox/)
- [App Store Connect Help](https://developer.apple.com/help/app-store-connect/)

## Current app shape to explain to App Review

Foundry Vox is a local macOS TTS and voice-cloning app with:
- a Tauri shell
- a bundled Python backend sidecar
- local SQLite/app data storage
- Apple Silicon inference
- packaged loopback communication between the shell and the bundled backend

This is a legitimate App Store story, but it will invite more scrutiny than a simple single-process native app. The review package needs to make the runtime shape easy to understand.

## Already addressed in the app

### 1. Removed reviewer-hostile "not finished" product copy

Current state:
- The app no longer exposes the old About-panel language that said App Store packaging still needed engineering work.

Keep verifying:
- About/help/settings surfaces should stay free of beta/TODO/roadmap language in the review build.

### 2. Added a basic voice-cloning rights acknowledgment

Current state:
- The clone flow now requires users to confirm they have the right to use the uploaded recording and create a voice clone from it.

Keep verifying:
- The final shipped flow should keep this acknowledgment or a stronger equivalent.

## Must fix before upload

### 1. Reconcile offline/privacy claims with the actual binary

Confirmed repo risk:
- [`src-tauri/entitlements.plist`](/Users/rob/Claude/vox/src-tauri/entitlements.plist) includes `com.apple.security.network.client`.
- [`src-tauri/src/main.rs`](/Users/rob/Claude/vox/src-tauri/src/main.rs) uses loopback HTTP between the shell and backend.

Why it matters:
- App Review will compare the privacy story in the UI and metadata against the actual bundle behavior.

Required action:
- Keep product copy technically exact about local inference and local loopback.
- Keep the entitlement rationale documented for review notes.
- Add a privacy policy that explains local processing and any network behavior precisely.

### 2. Replace placeholder preset/reference audio with rights-cleared assets

Confirmed repo risk:
- [`README.md`](/Users/rob/Claude/vox/README.md) and [`docs/release.md`](/Users/rob/Claude/vox/docs/release.md) explicitly say the preset WAVs are development placeholders that must be replaced before App Store submission.

Why it matters:
- This is both a 2.1 completeness risk and a 5.2 intellectual property risk.

Required action:
- Replace every shipped preset/reference asset with legally reviewed production material.
- Keep a rights record for each shipped preset voice.

### 3. Ensure the App Store build is fully self-contained for review

Confirmed repo risk:
- Foundry Vox uses a bundled backend runtime staged from app resources by [`src-tauri/src/main.rs`](/Users/rob/Claude/vox/src-tauri/src/main.rs).
- [`docs/release.md`](/Users/rob/Claude/vox/docs/release.md) still references local build/setup paths that are acceptable for engineering but not for review.

Why it matters:
- Under 2.1 and 2.5.2, the review build must work without Terminal steps, manual model installation, or post-install executable downloads.

Required action:
- Validate the signed App Store build on a clean Apple Silicon Mac with no local dev setup.
- Confirm the reviewer path does not require manual model seeding or shell commands.
- Confirm no executable/runtime code is downloaded after install.

## Strongly recommended

### 4. Add and surface the privacy policy

Current likely gap:
- This audit did not find a public privacy-policy URL or obvious in-app privacy-policy entry point.

Required action:
- Add a public privacy policy URL in App Store Connect.
- Add an in-app link from About/settings/help.
- Ensure the policy matches the actual data flows in the packaged build.

### 5. Prepare reviewer notes for the helper runtime story

Confirmed repo behavior:
- The packaged app launches a bundled backend sidecar, uses loopback with runtime auth, and accepts requests only from the app shell.

Required action:
- In App Review notes, explain:
  - no account is required
  - inference is local
  - a bundled backend helper is launched locally
  - loopback traffic is app-internal only
  - first launch includes model warmup

### 6. Validate export formats on a clean machine

Confirmed repo risk:
- [`backend/app/audio.py`](/Users/rob/Claude/vox/backend/app/audio.py) can use `ffmpeg` if available and falls back to `afconvert` for MP3/AAC.

Why it matters:
- Clean-machine export is a common Mac review trap.

Required action:
- Verify WAV, MP3, and AAC export in the signed App Store build on a Mac with no Homebrew tools installed.
- If any format is not guaranteed in the sandboxed review build, adjust the feature set or implementation before submission.

### 7. Re-check all metadata and screenshots against the review build

Required action:
- Capture screenshots from the actual App Store build.
- Remove any claim that implies future work, hidden features, or broader privacy guarantees than the code supports.

## Optional hardening

### 8. Tighten entitlements and security posture

Current state:
- [`src-tauri/entitlements.plist`](/Users/rob/Claude/vox/src-tauri/entitlements.plist) currently requests app sandbox, user-selected read/write, and network client.
- [`src-tauri/tauri.conf.json`](/Users/rob/Claude/vox/src-tauri/tauri.conf.json) still uses `csp: null`.

Recommended action:
- Keep re-auditing whether `network.client` remains necessary if the transport architecture changes.
- If feasible, tighten the production webview security policy.

### 9. Reduce review surface from unused dependencies/plugins

Current state:
- The app uses `tauri-plugin-opener`; unused shell-related dependencies should not remain in the shipping build.

Recommended action:
- Audit plugins and capabilities for anything not needed in the shipping build.

## Reviewer notes to include

Use this as the baseline submission note:

1. Foundry Vox is a local macOS text-to-speech and voice-cloning app.
2. No account is required for review.
3. Core generation and cloning run locally on-device.
4. The app launches a bundled local backend helper and communicates with it over authenticated loopback only.
5. First launch may take additional time for model load and warmup.
6. To review the app:
   - launch the app
   - select a preset voice
   - enter text and generate audio
   - play the result and export it
   - open Clone Voice, upload a short sample clip, and create a new clone
7. All assets needed for the reviewer path are bundled in the app.

## Evidence to capture before submission

- Signed App Store build installed on a clean Apple Silicon Mac.
- Screen recording or screenshots of:
  - first launch
  - first generation
  - playback
  - export
  - clone flow
- Proof that the App Store build works without Terminal steps.
- Proof that bundled models/assets/licenses are present.
- Copy review of all in-app privacy/offline/help text.
- Final entitlement list with a one-line justification for each entitlement.
- Final list of bundled preset/reference assets with rights approval.
- Final privacy policy URL and App Privacy answers.

## Concrete code and product areas to inspect

### [`frontend/src/App.tsx`](/Users/rob/Claude/vox/frontend/src/App.tsx)

Inspect for:
- reviewer-visible incomplete/beta copy
- offline/privacy claims
- clone-flow rights language
- privacy policy/support links

### [`src-tauri/entitlements.plist`](/Users/rob/Claude/vox/src-tauri/entitlements.plist)

Inspect for:
- every entitlement requested by the App Store build
- justification for `network.client`
- whether file access stays within user-selected scope

### [`src-tauri/src/main.rs`](/Users/rob/Claude/vox/src-tauri/src/main.rs)

Inspect for:
- bundled backend staging and launch behavior
- loopback/runtime-token auth
- opener/file-system interactions
- any reviewer-confusing helper/runtime behavior

### Metadata, assets, and signed build

Inspect:
- App Store listing copy and screenshots
- privacy policy URL and App Privacy answers
- bundled preset/reference assets and shipped licenses
- clean-machine signed App Store build behavior
