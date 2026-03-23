# Foundry Vox App Store Submission Runbook

This is the canonical App Store preflight and submission gate for Foundry Vox.
Use it for every App Store submission. Do not rely on memory, ad hoc notes, or
dev-mode behavior.

This runbook assumes:
- the current engine baseline is locked by [`docs/engine-lockdown.md`](/Users/rob/Claude/vox/docs/engine-lockdown.md)
- Foundry Vox remains an offline-first local-inference macOS app
- validation happens on the same Mac, using a clean-state simulation, unless a
  dedicated clean Mac is available

If any gate below fails, stop the submission and fix the failure before moving
on.

## Gate 0: Submission Inputs

Owner: release engineer

Pass only if all inputs below are present and final:

| Item | Required state | Evidence |
| --- | --- | --- |
| Signing identities | Final App Store signing identities available locally | `security find-identity -v -p codesigning` output captured |
| Provisioning profile | Correct App Store provisioning profile installed | profile identifier recorded |
| Privacy policy URL | Public and final | URL loads in browser; current target tracked in [`docs/public-links.md`](/Users/rob/Claude/vox/docs/public-links.md) |
| Support URL/contact | Public and final | URL/email loads or resolves; current target tracked in [`docs/public-links.md`](/Users/rob/Claude/vox/docs/public-links.md) |
| Reviewer notes draft | Final text prepared | Filled template from [`docs/app-store-review-notes-template.md`](/Users/rob/Claude/vox/docs/app-store-review-notes-template.md) |
| Asset rights list | Complete for every bundled preset/reference asset | Filled worksheet from [`docs/preset-asset-rights.md`](/Users/rob/Claude/vox/docs/preset-asset-rights.md) |
| Metadata set | Final name, subtitle, description, screenshots, age rating, privacy answers | App Store Connect draft reviewed against current build |

Hard fail conditions:
- privacy policy/support URL not public
- any bundled preset/reference asset missing rights clearance
- reviewer notes not yet written
- App Store metadata still based on roadmap copy instead of the review build

## Gate 1: Binary Integrity

Owner: release engineer

Use the App Store build only:

1. `npm install`
2. `npm --prefix frontend install`
3. `uv sync --project backend --extra dev --extra ml --extra mlx`
4. `npm run build:sidecar`
5. `npm run tauri:build:appstore`
6. If signing/package validation is part of this pass, run:
   `APP_SIGN_IDENTITY="Apple Distribution: Your Name (TEAMID)" INSTALLER_SIGN_IDENTITY="3rd Party Mac Developer Installer: Your Name (TEAMID)" npm run package:appstore`

Reference outputs:
- app bundle: `src-tauri/target/release/bundle/macos/Foundry Vox.app`
- bundle identifier: `com.foundry.vox`

Pass only if:
- the App Store variant builds successfully
- the bundled backend/helper is present in the built app package
- the backend/helper is staged from app resources, not from a dev path
- no manual model seeding or shell commands are required for the reviewer path
- no executable/runtime code is downloaded after install

Required checks:
- Verify entitlements in [`src-tauri/entitlements.plist`](/Users/rob/Claude/vox/src-tauri/entitlements.plist) still match the runtime story:
  - `com.apple.security.app-sandbox`
  - `com.apple.security.files.user-selected.read-write`
  - `com.apple.security.network.client`
- Verify `network.client` is still justified by authenticated local loopback between the Tauri shell and bundled backend.
- Verify the built bundle contains the helper/backend expected by [`src-tauri/src/main.rs`](/Users/rob/Claude/vox/src-tauri/src/main.rs).

Recommended inspection commands:
- `codesign -d --entitlements :- "src-tauri/target/release/bundle/macos/Foundry Vox.app"`
- `find "src-tauri/target/release/bundle/macos/Foundry Vox.app" -name "foundry-vox-backend*" -print`
- `plutil -p src-tauri/tauri.conf.json | grep identifier`

Capture:
- build command outputs
- final app path
- final entitlement list with one-line rationale

Hard fail conditions:
- build only works from `tauri dev`
- build depends on Homebrew or global Python/ffmpeg for the reviewer path
- helper/runtime is missing, unsigned incorrectly, or sourced from a dev-only location
- any post-install executable download is required

## Gate 2: Same-Mac Clean Validation

Owner: release engineer or QA

Use [`docs/same-mac-clean-validation.md`](/Users/rob/Claude/vox/docs/same-mac-clean-validation.md) as the detailed checklist.

Preferred setup:
- a dedicated clean macOS user on the same Apple Silicon Mac

Fallback setup:
- same user, but with a strict clean-state simulation:
  - remove previous app data for Foundry Vox
  - install only the signed App Store build being reviewed
  - do not rely on dev env vars, dev caches, Terminal setup, or prior model placement

Pass only if the signed App Store build can do all of the following without
Terminal use after install:
- first launch completes successfully
- first-run warmup is understandable and does not look hung
- preset generation works
- playback works
- WAV export works
- MP3 export works
- AAC export works
- clone flow works and includes the rights acknowledgment
- relaunch after first run still works

Required validation notes:
- whether the app needed any preexisting models/assets to succeed
- whether any export format relied on global tools
- whether any flow looked stalled or reviewer-confusing

Hard fail conditions:
- any manual model placement or shell command is needed
- any core reviewer flow fails
- any export format advertised in the app fails on the clean path
- first launch appears broken, blank, or indefinitely “warming”

## Gate 3: Metadata and Privacy Consistency

Owner: release engineer and product owner

Use [`docs/privacy-metadata-consistency.md`](/Users/rob/Claude/vox/docs/privacy-metadata-consistency.md) as the working sheet.

Pass only if all user-facing claims are consistent across:
- the signed App Store build
- About/help/settings copy
- App Store description and screenshots
- App Privacy answers
- reviewer notes

Required checks:
- every “local”, “on-device”, “private”, or “offline” claim is technically true
- help/privacy copy matches the loopback helper architecture
- screenshots are captured from the exact review build
- support/privacy URLs in metadata are public and current
- age rating/category reflect the actual app
- the live public policy/support pages match the repo-owned source copy in:
  - [`docs/privacy-policy.md`](/Users/rob/Claude/vox/docs/privacy-policy.md)
  - [`docs/support.md`](/Users/rob/Claude/vox/docs/support.md)

Special attention items for Foundry Vox:
- do not imply “nothing leaves your machine” unless it is still literally true for the shipping binary
- explain local loopback calmly; do not hide it, and do not overstate it
- ensure cloning language does not imply celebrity impersonation or infringing use cases

Hard fail conditions:
- any mismatch between in-app claims and shipping behavior
- screenshots/descriptions show features not present in the review build
- App Privacy answers are based on assumptions instead of real packaged behavior

## Gate 4: Evidence Pack

Owner: release engineer

Submission is not ready until the evidence pack exists in complete form.

Required artifacts:
- completed reviewer notes from [`docs/app-store-review-notes-template.md`](/Users/rob/Claude/vox/docs/app-store-review-notes-template.md)
- completed rights worksheet from [`docs/preset-asset-rights.md`](/Users/rob/Claude/vox/docs/preset-asset-rights.md)
- completed privacy/metadata worksheet from [`docs/privacy-metadata-consistency.md`](/Users/rob/Claude/vox/docs/privacy-metadata-consistency.md)
- completed clean-validation checklist from [`docs/same-mac-clean-validation.md`](/Users/rob/Claude/vox/docs/same-mac-clean-validation.md)
- screenshots or short recordings of:
  - first launch
  - first generation
  - playback
  - export
  - clone flow
- final checklist sign-off with:
  - owner
  - date
  - build identifier
  - pass/fail result

Hard fail conditions:
- evidence exists only in chat or memory
- no proof of clean-state validation
- no final reviewer notes text ready for paste into App Store Connect

## Foundry Vox No-Go List

Do not submit if any item below is true:

- Reviewer-facing beta/TODO/internal-status copy is still visible in the App Store build.
- Any preset/reference asset lacks rights clearance.
- The App Store build requires manual model placement, shell commands, or preexisting dev caches for the reviewer path.
- Privacy policy/support URL is missing or not yet public.
- “Local/on-device/private” wording does not match entitlements, helper behavior, loopback behavior, or App Privacy answers.
- WAV, MP3, or AAC export fails on the clean validation path.
- The clone flow lacks the rights acknowledgment in the actual review build.
- The signed App Store build has not been tested in a clean-state run on the same Mac.

## Engine Lock vs Submission Lock

Foundry Vox has two separate release guards:

1. **Engine baseline lock**
   - defined by the benchmark and baseline process in [`docs/engine-lockdown.md`](/Users/rob/Claude/vox/docs/engine-lockdown.md)
   - protects model/runtime behavior

2. **Submission preflight lock**
   - defined by this runbook
   - protects the coherence of the signed bundle, metadata, privacy story, assets, and reviewer package

When future model improvements land:
- update engine code and benchmark baseline together
- rerun this submission runbook if the changes affect:
  - bundled assets/models
  - warmup/runtime behavior
  - user-facing claims
  - reviewer instructions
  - App Privacy answers

## Final Sign-Off

Use this release block at the end of every App Store submission pass:

| Item | Value |
| --- | --- |
| Build identifier |  |
| Signed by |  |
| Validated by |  |
| Date |  |
| Gate 0 result | PASS / FAIL |
| Gate 1 result | PASS / FAIL |
| Gate 2 result | PASS / FAIL |
| Gate 3 result | PASS / FAIL |
| Gate 4 result | PASS / FAIL |
| Submission ready | YES / NO |
