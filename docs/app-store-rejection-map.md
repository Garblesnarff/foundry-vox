# App Store Rejection Map

This guide is the reusable pre-submission checklist for Apple platform apps. It is designed to reduce first-review rejection risk, not just to meet the minimum bar.

Primary sources:
- [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [App Store Connect Help](https://developer.apple.com/help/app-store-connect/)
- [Configuring the macOS App Sandbox](https://developer.apple.com/documentation/xcode/configuring-the-macos-app-sandbox/)
- [TN3181: Debugging Invalid Privacy Manifest](https://developer.apple.com/documentation/technotes/tn3181-debugging-invalid-privacy-manifest)

## How to use this guide

Run this checklist in two passes:

1. Generic pass: confirm the app story, metadata, privacy declarations, and runtime behavior agree with each other.
2. Product pass: add product-specific review notes, assets, credentials, and evidence for the exact app being submitted.

If any item below is unclear, assume App Review will interpret it in the strictest reasonable way.

## 2.1 App Completeness

### Common rejection triggers

- Broken onboarding, crashes, blank states, or setup paths that require tribal knowledge.
- Reviewer cannot reach a core feature because a service, account, hardware dependency, or hidden configuration is missing.
- Placeholder copy, "coming soon" promises, or visible internal release notes.
- First-run behavior that looks hung, unfinished, or inconsistent.
- Export, playback, sharing, login, or purchase flows that fail on a clean machine.

### What prevents confusion

- App Review notes that explain any non-obvious setup or expected first-run delay.
- Demo credentials or a fully functional demo mode if accounts are involved.
- A short explanation for any expensive initialization step, local model warmup, or one-time migration.

### What to test before upload

- Fresh install on a clean machine or device with no dev tools or local caches.
- First launch, first-run onboarding, and every primary user path.
- Network-off and network-on behavior, if the app claims offline behavior or optional online behavior.
- Full restart cycle after initial setup.

### What to verify in metadata and App Store Connect

- Support contact information is current.
- Review notes explain any feature that is not obvious from the UI alone.
- Any required credentials, test accounts, or sample files are included in review notes.

## 2.3 Accurate Metadata

### Common rejection triggers

- Screenshots or descriptions show features that are absent, renamed, hidden, or unfinished in the shipped build.
- Claims like "offline," "private," "on-device," "secure," or "no data leaves your device" are broader than what the binary actually does.
- About/help panels inside the app still mention beta status, hardening work, TODOs, or internal release caveats.
- Wrong category, age rating, or audience positioning.

### What prevents confusion

- Screenshots captured from the exact review build.
- Metadata reviewed against the binary, not against a roadmap.
- Marketing language that is precise enough to survive a technical reading.

### What to test before upload

- Click through the About/help/settings surfaces and compare them to the App Store description.
- Verify privacy, offline, AI, and content claims against real runtime behavior.
- Confirm icons, app name, subtitle, and screenshots do not imply unsupported features.

### What to verify in metadata and App Store Connect

- Description, subtitle, keywords, screenshots, and preview video all match the live app.
- Privacy policy URL, support URL, and marketing URL are valid and public.
- Age rating reflects the app's actual content generation or user content capabilities.

## 2.5 Software and Packaging

### Common rejection triggers

- Downloading, installing, or executing new code after install.
- Wrapper apps that mostly host a website or remote experience.
- Use of helper binaries, shells, or scripting runtimes without a clear self-contained story.
- Private APIs or unsupported platform workarounds.
- Filesystem or process behavior that exceeds sandbox expectations.

### What prevents confusion

- A clear explanation of why helper processes exist and how they stay inside the app's bundle/container model.
- A fully self-contained runtime story for packaged builds.
- Minimal entitlements with a written justification for each one.

### What to test before upload

- Signed release build, not just debug/dev mode.
- Clean-machine verification that the app does not rely on Homebrew tools, developer runtimes, or outside binaries unless explicitly bundled and permitted.
- Validation that any helper process only executes the bundled runtime and does not fetch executable updates or model code post-install.

### What to verify in metadata and App Store Connect

- Review notes explain any local server, helper process, loopback communication, or embedded runtime.
- Release notes and reviewer notes do not imply that core functionality depends on post-review downloads.

## 4.x Minimum Functionality, Spam, and Thin Experiences

### Common rejection triggers

- Apps that feel like a thin wrapper around a website or a trivial utility.
- Duplicated apps with cosmetic differences.
- AI apps that offer little distinct product value beyond a generic shell.
- Desktop apps that feel unstable, unfinished, or lack obvious core workflows.

### What prevents confusion

- A strong native value proposition, clear primary workflow, and polished empty/loading/error states.
- Features that clearly exceed a simple web wrapper or one-button utility.

### What to test before upload

- Evaluate whether the app still feels substantial with network disabled, no account, and no hidden tooling.
- Confirm that the first five minutes of usage make the product value obvious.

### What to verify in metadata and App Store Connect

- Description and screenshots emphasize the complete workflow, not just the underlying technology.

## 5.1 Privacy

### Common rejection triggers

- Missing privacy policy.
- App Privacy answers that do not match actual runtime behavior.
- Permissions or entitlements that are broader than the app's stated purpose.
- Third-party SDKs or manifests that are incomplete or inconsistent.
- "Local/private/offline" claims that conflict with analytics, sync, remote fallback, or network entitlements.

### What prevents confusion

- A privacy policy written in plain language and linked both in-app and in App Store Connect.
- A line-by-line map from actual data flows to App Privacy declarations.
- Explicit explanation for loopback networking, optional cloud features, or local-only claims.

### What to test before upload

- Permission prompts on a clean machine.
- Privacy manifest validation in Xcode or App Store validation tooling.
- Offline behavior after blocking network.
- Any telemetry, logging, crash reporting, or background network activity.

### What to verify in metadata and App Store Connect

- Privacy policy URL is live.
- App Privacy answers are reviewed against the shipping build, not assumptions.
- If no data is collected, verify that claim against all bundled SDKs and services.

## 1.2 and 5.2 IP, UGC, and Rights

### Common rejection triggers

- Unlicensed bundled media, voices, music, images, or models.
- Creator/upload content without a clear rights posture.
- Apps that facilitate copying or downloading third-party media without permission.
- AI generation or cloning features that obviously invite impersonation, infringement, or abusive use without guardrails.

### What prevents confusion

- Rights-reviewed bundled assets.
- Clear user-facing language that users must own or control the source material they upload.
- Contact/support path for rights issues.
- Product copy that avoids suggesting infringing or deceptive use cases.

### What to test before upload

- Audit every bundled asset and attribution/license notice.
- Review clone/upload flows for consent and rights language.
- Verify there are no example assets or presets that cannot be legally distributed.

### What to verify in metadata and App Store Connect

- Description does not imply unsupported celebrity cloning, piracy, scraping, or trademark use.
- Review notes can explain the app's rights posture if the feature set is inherently sensitive.

## 3.x Purchases, Accounts, and External Flows

### Common rejection triggers

- Account creation required without a good reason.
- External purchase messaging that violates Apple's rules.
- Broken delete-account flow when accounts are required.
- Reviewer cannot access account-gated functionality.

### What prevents confusion

- Optional accounts where possible.
- App Review notes with credentials and clear purchase explanations.
- In-app account deletion if user accounts exist.

### What to test before upload

- Sign-up, sign-in, forgot password, restore purchase, delete account, and offline fallback behavior.

### What to verify in metadata and App Store Connect

- Subscription or purchase descriptions match in-app behavior and reviewer notes.

## macOS-specific review traps

### Common rejection triggers

- Over-broad sandbox entitlements.
- Access outside the app container without user-selected file access.
- Export/import features that rely on developer tools or unsupported codecs on a clean Mac.
- Bundled helper runtimes that are unsigned, unstaged, or unclear in behavior.
- Clean-machine failures caused by missing command-line tools or environment variables.

### What prevents confusion

- Minimal entitlements and a justification for each one.
- Native file pickers for all user file access.
- A documented helper-runtime story for bundled binaries or sidecars.
- Evidence that the signed App Store build works on a Mac without Homebrew, Python, or ffmpeg installed globally.

### What to test before upload

- Open, save, import, export, playback, and reveal-in-Finder flows inside the sandbox.
- Full signed build on a fresh Apple Silicon Mac.
- Codec/export support without fallback to undeclared external tools.

### What to verify in metadata and App Store Connect

- Review notes explain any unusual macOS-specific packaging or sandbox behavior.

## Reviewer notes template

Use this as the baseline for non-obvious apps:

1. What the app does in one sentence.
2. Whether login is required.
3. Whether the app works fully offline or which features require network.
4. Any first-run setup, warmup, indexing, or migration delay the reviewer should expect.
5. Any helper process, local server, or sidecar the reviewer may notice.
6. Exact steps to exercise the main workflow.
7. Any sample file, demo credential, or hardware dependency needed for review.

## Privacy and metadata consistency checklist

- Every privacy claim in the app is true for the shipping binary.
- Every entitlement has a product-facing justification.
- Every permission prompt maps to a visible user benefit.
- Every App Store screenshot is from the shipping UI.
- Every support, privacy, and marketing URL works publicly.
- The app name, subtitle, and description do not promise features still on the roadmap.

## Clean-machine validation checklist

- Install and launch on a fresh machine.
- Complete the primary workflow without touching Terminal.
- Verify all bundled runtimes, models, and assets are present.
- Verify no hidden post-install downloads are required for the reviewer path.
- Verify imports and exports using native file dialogs.
- Verify there are no crashes, beachballs, or long unexplained stalls.

## Rubric for sensitive claims

Only use these claims if they remain true under a strict technical reading:

- `offline`: core value path works with the network disabled.
- `private`: the app does not transmit user data off-device unless the user intentionally initiates it and the policy says so.
- `on-device`: the actual computation happens locally for the claimed workflow.
- `self-contained`: the shipped build includes everything needed for the reviewer path and does not fetch executable/runtime components after install.

If a claim is only conditionally true, rewrite it to name the condition.
