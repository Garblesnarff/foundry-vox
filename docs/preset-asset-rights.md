# Bundled Preset Asset Rights Worksheet

This sheet is the human-readable companion to the machine-checkable source of
truth in [`docs/preset-asset-rights.json`](/Users/rob/Claude/vox/docs/preset-asset-rights.json).

Current shipped preset inventory:

| Preset / asset | File path | Current status | Notes |
| --- | --- | --- | --- |
| Warm Narrator | `backend/app/presets/audio/warm-narrator.wav` | `pending_replacement` | placeholder until rights-cleared production asset exists |
| Bright Host | `backend/app/presets/audio/bright-host.wav` | `pending_replacement` | placeholder until rights-cleared production asset exists |
| Deep Anchor | `backend/app/presets/audio/deep-anchor.wav` | `pending_replacement` | placeholder until rights-cleared production asset exists |
| Gentle Reader | `backend/app/presets/audio/gentle-reader.wav` | `pending_replacement` | placeholder until rights-cleared production asset exists |
| Crisp Lecturer | `backend/app/presets/audio/crisp-lecturer.wav` | `pending_replacement` | placeholder until rights-cleared production asset exists |
| Velvet Evening | `backend/app/presets/audio/velvet-evening.wav` | `pending_replacement` | placeholder until rights-cleared production asset exists |
| Young Storyteller | `backend/app/presets/audio/young-storyteller.wav` | `pending_replacement` | placeholder until rights-cleared production asset exists |
| Wise Elder | `backend/app/presets/audio/wise-elder.wav` | `pending_replacement` | placeholder until rights-cleared production asset exists |
| News Anchor | `backend/app/presets/audio/news-anchor.wav` | `pending_replacement` | placeholder until rights-cleared production asset exists |
| Noir Detective | `backend/app/presets/audio/noir-detective.wav` | `pending_replacement` | placeholder until rights-cleared production asset exists |
| Cheerful Teacher | `backend/app/presets/audio/cheerful-teacher.wav` | `pending_replacement` | placeholder until rights-cleared production asset exists |
| Epic Trailer | `backend/app/presets/audio/epic-trailer.wav` | `pending_replacement` | placeholder until rights-cleared production asset exists |
| Soothing Guide | `backend/app/presets/audio/soothing-guide.wav` | `pending_replacement` | placeholder until rights-cleared production asset exists |
| Bold Commercial | `backend/app/presets/audio/bold-commercial.wav` | `pending_replacement` | placeholder until rights-cleared production asset exists |

## Verification

Use:

- `uv run --project backend python backend/verify_preset_assets.py`
- `uv run --project backend python backend/verify_preset_assets.py --strict`

`--strict` is the release gate. It fails unless every shipped preset asset is
fully approved.

## Submission rule

If any bundled preset/reference asset remains in `pending_replacement`,
`pending`, or any status other than `approved`, the App Store build is not ready
to upload.

