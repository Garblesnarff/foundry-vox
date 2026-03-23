# Foundry Vox Privacy Policy

Last updated: March 22, 2026

Foundry Vox is a local macOS text-to-speech and voice-cloning app for Apple
Silicon.

## What the app does

Foundry Vox generates speech and creates voice clones on your Mac using bundled
local model infrastructure.

## What data stays local

Foundry Vox is designed so that core generation and cloning happen locally on
your device.

Data typically stored locally includes:
- generated audio files
- imported reference audio that you choose to use
- clone metadata you create in the app
- local settings and generation history
- bundled model/runtime files used by the app

Foundry Vox stores working data in local app storage on your Mac.

## Local helper and loopback traffic

The app uses a bundled local helper runtime for voice generation. The macOS app
shell communicates with that helper over authenticated local loopback on your
Mac. This communication stays on your device and is part of the app's local
runtime architecture.

## What data is not required for cloud generation

Foundry Vox does not require cloud inference for core speech generation or
voice cloning.

## Files you provide

When you import or upload audio for cloning, that audio is used to perform the
local clone workflow on your Mac. You are responsible for having the right to
use any audio or voice material you provide.

## Exports

When you export audio, the exported files are written to the destination you
choose.

## Contact

For privacy or support questions, use the Foundry Vox support page:

- Support: https://garblesnarff.github.io/foundry-vox/support

