# App Store Review Notes Template

Paste a completed version of this into App Store Connect for each submission.

## App summary

Foundry Vox is a local macOS text-to-speech and voice-cloning app for Apple Silicon.

## Login and access

- No account is required for review.
- All core review flows are available immediately after install.

## Runtime behavior

- Core generation and cloning run locally on-device.
- The app launches a bundled local backend helper and communicates with it over authenticated local loopback only.
- First launch may take additional time for model load and warmup.

## Reviewer path

1. Launch Foundry Vox.
2. Wait for the engine to finish loading/warmup.
3. Select a preset voice.
4. Enter text and generate audio.
5. Play the result in the latest render card.
6. Export the render as WAV, MP3, or AAC.
7. Open Clone Voice.
8. Upload a short voice sample, confirm the rights acknowledgment, and create the clone.
9. Select the new clone and generate again.

## Important notes for review

- All assets required for the reviewer path are bundled with the app.
- The app does not require Terminal setup for review.
- If the reviewer notices local loopback traffic, it is app-internal communication between the Tauri shell and the bundled helper runtime.

## Submission-specific details

Fill before submission:

- Build identifier:
- Privacy policy URL:
- Support URL/contact:
- Any temporary reviewer-specific note:

