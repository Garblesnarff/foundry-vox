# Foundry Vox — Backend PRD

## Overview

Foundry Vox is a local, offline Mac desktop app for text-to-speech generation using Hume AI's TADA 1B model. Users paste or type text, select a voice (preset or cloned from reference audio), and generate high-quality speech audio — all running locally on Apple Silicon with zero cloud dependencies.

This PRD covers the **backend only**. A React frontend mockup is provided separately as `foundry-vox-mockup.jsx`. The backend must expose an API that the frontend can consume.

---

## Architecture

```
┌─────────────────────────────────────┐
│         React Frontend (Tauri)      │
│         foundry-vox-mockup.jsx      │
└──────────────┬──────────────────────┘
               │ HTTP (localhost:3456)
┌──────────────▼──────────────────────┐
│         FastAPI Backend             │
│         Python 3.11+                │
├─────────────────────────────────────┤
│  TADA Model Engine (PyTorch)        │
│  Audio Processing (torchaudio)      │
│  File Management (local disk)       │
│  SQLite (history, voices, settings) │
└─────────────────────────────────────┘
```

### Tech Stack

- **Runtime**: Python 3.11+
- **Framework**: FastAPI with uvicorn
- **Model**: HumeAI/tada-1b (Llama 3.2 1B backbone)
- **ML**: PyTorch (CPU, float32 — this is the optimized config)
- **Audio**: torchaudio for encoding/decoding, pydub for format conversion (MP3/AAC)
- **Database**: SQLite via aiosqlite (lightweight, no server, portable)
- **File storage**: Local filesystem (`~/Library/Application Support/Foundry Vox/`)

### Key Design Decisions

- **float32 precision** — NOT float16. Counterintuitive but this was the major optimization win on Apple Silicon. The M-series AMX coprocessor is natively float32; float16 adds conversion overhead on every operation. Do not change.
- **CPU only** — No CUDA, no MPS. MPS is broken for TADA in two places (device mismatch in `_lm_head_forward`, tensor mixing in `_decode_wav`) and MPS float16 will kernel panic the Mac. The M-series CPU with AMX coprocessor is the target. Device = "cpu".
- **Warmup on startup** — Run a silent dummy generation on server boot to prime caches and memory allocators. This drops first-real-request RTF from ~7x to ~3.2x.
- **Single process** — One model instance, one generation at a time. Queue additional requests. The model is not thread-safe.

---

## Critical Optimization Notes

These were discovered through 37 autonomous experiments on M4 Mac Mini (16GB). They are non-negotiable for production quality:

### 1. Monkey-patch internal timing

TADA's `generate()` internally calls `time.time()` every step and builds debug logs. This adds measurable Python overhead per token. Wrap the model's `generate()` method to inject `log_time=False` and `verbose=False` on every internal `_generate()` call:

```python
_original_generate = TadaForCausalLM.generate

@torch.no_grad()
def _fast_generate(self, *args, **kwargs):
    kwargs['verbose'] = False
    original_internal = self._generate
    def patched_generate(*a, **kw):
        kw['log_time'] = False
        kw['verbose'] = False
        return original_internal(*a, **kw)
    self._generate = patched_generate
    try:
        result = _original_generate(self, *args, **kwargs)
    finally:
        self._generate = original_internal
    return result

TadaForCausalLM.generate = _fast_generate
```

Apply this patch once at module load, before any generation calls.

### 2. transition_steps = 5

This parameter controls the blending between reference audio and generated audio. It MUST be set to 5 (the default) on every `generate()` call. Setting it to 0 causes voice mixing artifacts — the output sounds like multiple voices mashed together. This is not optional.

```python
output = model.generate(
    prompt=prompt,
    text=text,
    num_transition_steps=5,  # DO NOT set to 0
    inference_options=inference_options,
)
```

### 3. First-word distortion (known limitation)

The first word of every generation sounds slightly distorted due to the transition blending between reference and generated audio. This is a known TADA limitation. The effect is minor but audible. Do not attempt to fix this by prepending throwaway words — it degrades voice matching quality.

### 4. InferenceOptions defaults

These are the quality-tested defaults. Do NOT reduce flow matching steps below 10 — quality collapses rapidly. Do NOT disable CFG (setting acoustic_cfg_scale to 1.0) — it degrades audio quality significantly.

```python
inference_options = InferenceOptions(
    text_do_sample=True,
    text_temperature=0.6,
    text_top_k=0,
    text_top_p=0.9,
    acoustic_cfg_scale=1.6,
    duration_cfg_scale=1.0,
    cfg_schedule="constant",
    noise_temperature=0.9,
    num_flow_matching_steps=20,
    time_schedule="logsnr",
    num_acoustic_candidates=1,
)
```

### 5. system_prompt for emotion/style steering

TADA's `generate()` method accepts an undocumented `system_prompt` parameter that injects a Llama-style chat template header. This provides mild but real emotion/style steering:

```python
output = model.generate(
    prompt=prompt,
    text=text,
    system_prompt="Speak with warmth and excitement",
    num_transition_steps=5,
    inference_options=inference_options,
)
```

The effect is subtle — it nudges the model rather than drastically changing delivery. The reference audio remains the primary voice/emotion control. Expose this as an optional "Style Direction" field in the UI.

### 6. Reference audio is the primary emotion control

TADA clones whatever voice AND emotional quality it hears in the reference clip. A calm reference produces calm output. An excited reference produces excited output. This is the strongest lever for controlling expression — much stronger than `system_prompt`.

### 7. Silence trimming

TADA often generates trailing silence (5-10 seconds of dead air after the speech ends). All output audio should be trimmed using a sliding-window RMS approach:

```python
def trim_trailing_silence(audio_tensor, sample_rate=24000):
    window = int(0.1 * sample_rate)  # 100ms window
    rms_threshold = 0.005
    for i in range(len(audio_tensor) - window, 0, -window):
        rms = (audio_tensor[i:i+window] ** 2).mean().sqrt().item()
        if rms > rms_threshold:
            end = min(i + window + int(0.2 * sample_rate), len(audio_tensor))
            return audio_tensor[:end]
    return audio_tensor
```

### 8. Reference audio must be mono

If the user uploads stereo reference audio, convert to mono before encoding:

```python
if audio.shape[0] > 1:
    audio = audio.mean(dim=0, keepdim=True)
```

---

## Dependency Pinning (Critical)

```
# These version constraints are mandatory
transformers>=4.57.1,<5    # v5.x breaks TADA: AttributeError on 'all_tied_weights_keys'
descript-audio-codec        # Required by TADA but not declared as a dependency
```

---

## Model Distribution (Bundled Weights)

Foundry Vox is a consumer Mac app. Users must NEVER interact with HuggingFace, pip, or any CLI tool. All model weights ship with the application.

### What gets bundled

TADA internally loads two model sets:
- **HumeAI/tada-1b** — the TTS model (~2GB)
- **HumeAI/tada-codec** — the audio encoder
- **meta-llama/Llama-3.2-1B tokenizer** — loaded internally by TADA (gated on HuggingFace, but redistributable under Meta's Llama 3.2 Community License)

### Licensing (verified)
- **TADA**: MIT license — free to bundle and redistribute
- **Llama 3.2 1B**: Meta Llama 3.2 Community License — permits redistribution with attribution. Requires "Built with Llama" notice in the app (see Legal Requirements section)
- **descript-audio-codec**: MIT license

### Bundle strategy

All model weights are pre-downloaded during the build process and embedded in the Tauri app bundle under `Resources/models/`. The backend reads weights from this path at startup — no network calls, no authentication, no downloads.

```
Foundry Vox.app/
└── Contents/
    └── Resources/
        └── models/
            ├── tada-1b/          # Full model weights
            ├── tada-codec/       # Encoder weights
            └── llama-tokenizer/  # Llama 3.2 1B tokenizer files
```

### Build-time weight preparation

A build script (`scripts/bundle-models.sh`) handles weight preparation:
1. Downloads weights from HuggingFace (requires developer HF token — build machine only)
2. Copies tokenizer files from `meta-llama/Llama-3.2-1B` (developer must have accepted Meta's license)
3. Packages everything into the Tauri resource directory
4. Verifies checksums

This script runs once during development/CI. End users never see HuggingFace.

### Startup model loading

The backend resolves model paths from the app bundle:
```python
import sys, os

def get_model_path(model_name: str) -> str:
    """Resolve bundled model path. Works in both dev and packaged app."""
    # Packaged app: models are in Resources/models/
    bundle_path = os.path.join(
        os.path.dirname(sys.executable), "..", "Resources", "models", model_name
    )
    if os.path.exists(bundle_path):
        return bundle_path
    # Dev mode: fall back to local cache or HF_HOME
    return model_name  # lets transformers resolve from cache
```

### App size implications

Bundling weights adds ~2-3GB to the app. This is acceptable for a desktop Mac app distributed outside the App Store (direct download). If App Store distribution is pursued later, consider a first-launch download with a polished progress screen as an alternative.

### Health endpoint when models are missing

If the bundled weights are somehow missing or corrupt:
```json
{
  "status": "error",
  "error": "models_missing",
  "message": "Voice engine files are missing or damaged. Please reinstall Foundry Vox."
}
```

---

## Data Model (SQLite)

### `voices` table

```sql
CREATE TABLE voices (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,               -- "preset" | "clone"
    gender TEXT,                      -- "M" | "F" | "O"
    color TEXT,                       -- Hex color for UI ("#E8A849")
    description TEXT,
    tags TEXT,                        -- JSON array: ["narration", "warm"]
    reference_audio_path TEXT,        -- Path to reference .wav file (relative to voices dir)
    reference_text TEXT,              -- Transcript of reference audio
    reference_duration_seconds REAL,
    created_at TEXT NOT NULL,         -- ISO 8601
    updated_at TEXT NOT NULL          -- ISO 8601
);
```

### `generations` table

```sql
CREATE TABLE generations (
    id TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    voice_id TEXT NOT NULL,
    voice_name TEXT NOT NULL,         -- Denormalized for display
    system_prompt TEXT,               -- Optional style direction used
    output_path TEXT NOT NULL,
    format TEXT NOT NULL,             -- "wav" | "mp3" | "aac"
    sample_rate INTEGER NOT NULL,     -- 24000
    duration_seconds REAL NOT NULL,
    generation_time_seconds REAL NOT NULL,
    rtf REAL NOT NULL,
    char_count INTEGER NOT NULL,
    word_count INTEGER NOT NULL,
    created_at TEXT NOT NULL          -- ISO 8601
);
```

### `settings` table

```sql
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Default rows:
-- model: "tada-1b"
-- cpu_threads: "6"
-- output_format: "wav"
-- sample_rate: "24000"
-- bit_depth: "16"
-- output_directory: "~/Library/Application Support/Foundry Vox/output"
-- warmup_on_launch: "true"
```

---

## Directory Structure

```
~/Library/Application Support/Foundry Vox/
├── db/
│   └── foundry_vox.db
├── voices/
│   ├── presets/                 -- Shipped preset reference audio (14 voices)
│   │   ├── warm-narrator.wav
│   │   ├── bright-host.wav
│   │   ├── deep-anchor.wav
│   │   ├── gentle-reader.wav
│   │   ├── crisp-lecturer.wav
│   │   ├── velvet-evening.wav
│   │   ├── young-storyteller.wav
│   │   ├── wise-elder.wav
│   │   ├── news-anchor.wav
│   │   ├── noir-detective.wav
│   │   ├── cheerful-teacher.wav
│   │   ├── epic-trailer.wav
│   │   ├── soothing-guide.wav
│   │   └── bold-commercial.wav
│   └── clones/                 -- User-created clone reference audio
│       └── {uuid}.wav
├── output/                     -- Generated audio files
│   └── {uuid}.{wav|mp3|aac}
└── models/                     -- Cached model weights (symlink or actual)
    └── tada-1b/
```

---

## API Endpoints

All endpoints are `localhost:3456/api/v1/`. All responses are JSON unless returning audio.

### Health & Status

#### `GET /health`
Returns server status and model state.

```json
{
  "status": "ready",
  "model": "tada-1b",
  "model_loaded": true,
  "warmed_up": true,
  "device": "cpu",
  "dtype": "float32",
  "platform": "darwin-arm64"
}
```

Possible `status` values: `"loading"` (model loading), `"warming_up"` (running warmup gen), `"ready"`, `"generating"` (active generation in progress), `"error"`.

When status is `"error"`, include `"error"` and `"message"` fields with actionable, non-technical details (e.g., "Voice engine files are missing. Please reinstall Foundry Vox.").

---

### Voice Management

#### `GET /voices`
List all voices.

Query params:
- `type` (optional): `"preset"` | `"clone"` — filter by type

Response:
```json
{
  "voices": [
    {
      "id": "uuid",
      "name": "Warm Narrator",
      "type": "preset",
      "gender": "M",
      "color": "#E8A849",
      "description": "Rich, warm male baritone...",
      "tags": ["narration", "audiobook", "warm"],
      "reference_duration_seconds": 12.4,
      "created_at": "2026-03-12T00:00:00Z"
    }
  ]
}
```

#### `GET /voices/{id}`
Get single voice detail.

#### `POST /voices/clone`
Create a new cloned voice from reference audio.

Request: `multipart/form-data`
- `name` (string, required): Display name
- `audio` (file, required): Reference audio file (WAV, MP3, M4A)
- `gender` (string, optional): "M" | "F" | "O"
- `color` (string, optional): Hex color, auto-assigned if omitted
- `tags` (string, optional): JSON array string
- `transcript` (string, optional): Manual transcript of reference audio. If omitted, the backend uses TADA's built-in ASR to transcribe.

Processing steps:
1. Validate audio file (format, duration >= 6 seconds, warn if < 9 seconds)
2. Convert to WAV 24kHz mono if needed
3. Compute audio quality score (SNR estimation via simple energy-based VAD)
4. Save to `voices/clones/{uuid}.wav`
5. If no transcript provided, run through TADA encoder's ASR
6. Insert into `voices` table
7. Return voice object

Response:
```json
{
  "voice": { ... },
  "quality": {
    "duration_seconds": 9.2,
    "snr_estimate_db": 24.5,
    "quality_rating": "good",
    "warnings": []
  }
}
```

Quality ratings: `"poor"` (< 10dB SNR or < 6s), `"fair"` (10-18dB or 6-9s), `"good"` (18-25dB and >= 9s), `"excellent"` (> 25dB and >= 15s).

#### `PUT /voices/{id}`
Update voice metadata (name, color, tags, description). Does not change audio.

#### `DELETE /voices/{id}`
Delete a cloned voice. Preset voices cannot be deleted (return 403). Removes reference audio file and database row.

#### `PUT /voices/{id}/reference`
Replace the reference audio for a cloned voice. Same processing as clone creation. Preset voices cannot be updated (return 403).

#### `GET /voices/{id}/preview`
Returns a short (~5 second) preview audio clip generated with this voice reading a standard test sentence: "The forge burns brightest at midnight. Every voice begins as raw metal."

Response: Audio file (WAV), streamed.

---

### Generation

#### `POST /generate`
Generate speech from text using a selected voice. This is the core endpoint.

Request:
```json
{
  "text": "The old lighthouse keeper watched the storm roll in...",
  "voice_id": "uuid-of-selected-voice",
  "system_prompt": null,
  "format": "wav",
  "sample_rate": 24000
}
```

- `system_prompt` (string, optional): Style/emotion direction. Examples: "Speak with warmth and excitement", "Speak in a dark, ominous tone", "Speak softly and gently". Pass directly to `model.generate(system_prompt=...)`. If null/omitted, no system prompt is used.

Processing steps:
1. Validate text (non-empty, max 50,000 chars)
2. Load voice reference audio and transcript from disk
3. Encode reference through TADA encoder (convert to mono if stereo)
4. Generate audio via `model.generate(prompt=prompt, text=text, system_prompt=system_prompt, num_transition_steps=5, inference_options=inference_options)`
5. Trim trailing silence from output
6. Convert to requested format if not WAV
7. Save to `output/{uuid}.{format}`
8. Compute duration, RTF, metadata
9. Insert into `generations` table
10. Return generation metadata + file path

Response:
```json
{
  "generation": {
    "id": "uuid",
    "text": "The old lighthouse keeper...",
    "voice_id": "voice-uuid",
    "voice_name": "Warm Narrator",
    "system_prompt": null,
    "output_path": "/absolute/path/to/output/uuid.wav",
    "format": "wav",
    "sample_rate": 24000,
    "duration_seconds": 24.3,
    "generation_time_seconds": 85.1,
    "rtf": 3.5,
    "char_count": 142,
    "word_count": 25,
    "created_at": "2026-03-12T23:42:00Z"
  }
}
```

**IMPORTANT**: Generation is synchronous and blocking. Only one generation runs at a time. If a generation is in progress, return `429 Too Many Requests` with:
```json
{
  "error": "generation_in_progress",
  "message": "A generation is currently in progress. Please wait.",
  "estimated_remaining_seconds": 45
}
```

#### `GET /generate/progress`
SSE (Server-Sent Events) endpoint for real-time progress during generation.

The frontend connects to this before calling `POST /generate`. Events:

```
event: progress
data: {"status": "encoding", "percent": 5}

event: progress
data: {"status": "generating", "percent": 35, "tokens_generated": 42, "tokens_total": 120}

event: progress
data: {"status": "decoding", "percent": 90}

event: complete
data: {"generation_id": "uuid"}

event: error
data: {"message": "Out of memory"}
```

Progress percent estimation: TADA generates 1 token per text token. Count input text tokens (approximate: `len(text.split())`) to estimate total. Report `tokens_generated / tokens_total * 80 + 10` as percent (reserving 0-10% for encoding, 90-100% for decoding/saving).

#### `GET /generate/{id}/audio`
Stream the generated audio file for playback.

Response: Audio file with appropriate `Content-Type` header (`audio/wav`, `audio/mpeg`, `audio/aac`).
Include `Content-Disposition: inline` for playback, not download.
Include `Accept-Ranges: bytes` for seeking support.

#### `GET /generate/{id}/download`
Same as above but with `Content-Disposition: attachment; filename="foundry-vox-{voice_name}-{timestamp}.{format}"`.

---

### History

#### `GET /history`
List generation history.

Query params:
- `voice_id` (optional): Filter by voice
- `search` (optional): Full-text search on `text` field
- `sort` (optional): `"newest"` (default) | `"oldest"` | `"longest"` | `"shortest"`
- `limit` (optional): Default 50, max 200
- `offset` (optional): For pagination

Response:
```json
{
  "generations": [ ... ],
  "total": 42,
  "limit": 50,
  "offset": 0
}
```

#### `DELETE /history/{id}`
Delete a single generation. Removes audio file and database row.

#### `DELETE /history`
Clear all history. Removes all audio files in output directory and all rows from generations table.

#### `GET /history/stats`
Aggregate session/lifetime statistics.

```json
{
  "session": {
    "generations": 3,
    "total_audio_seconds": 74.1,
    "total_generation_seconds": 263.1,
    "avg_rtf": 3.5
  },
  "lifetime": {
    "generations": 156,
    "total_audio_seconds": 3842.5,
    "total_generation_seconds": 13448.8,
    "avg_rtf": 3.5
  }
}
```

Session resets each time the server starts.

---

### Settings

#### `GET /settings`
Return all settings as key-value pairs.

```json
{
  "model": "tada-1b",
  "cpu_threads": 6,
  "output_format": "wav",
  "sample_rate": 24000,
  "bit_depth": 16,
  "output_directory": "~/Library/Application Support/Foundry Vox/output",
  "warmup_on_launch": true
}
```

#### `PATCH /settings`
Update one or more settings.

```json
{
  "cpu_threads": 8,
  "output_format": "mp3"
}
```

Validation rules:
- `cpu_threads`: 1 to `os.cpu_count()`, integer
- `output_format`: one of `"wav"`, `"mp3"`, `"aac"`
- `sample_rate`: one of `16000`, `22050`, `24000`, `44100`, `48000`
- `bit_depth`: one of `16`, `24`, `32`
- `output_directory`: must be a valid writable path
- `warmup_on_launch`: boolean
- `model`: one of `"tada-1b"`, `"tada-3b"` — changing this triggers a model reload (slow, ~30s)

#### `POST /settings/choose-directory`
Opens a native file picker dialog (via Tauri IPC or subprocess) and returns the selected path. If running headless, return 501.

---

### Export

#### `POST /export/batch`
Export multiple generations as a zip file or concatenated single file.

Request:
```json
{
  "generation_ids": ["uuid1", "uuid2", "uuid3"],
  "mode": "zip",
  "format": "wav"
}
```

`mode` options:
- `"zip"` — Package all files into a zip archive
- `"concatenate"` — Stitch all audio files sequentially into one file with configurable pause between segments

If `mode` is `"concatenate"`, additional optional fields:
- `pause_seconds` (float, default 0.5): Silence gap between segments
- `filename` (string, optional): Output filename

Response: File download.

---

## Model Engine Implementation

### Initialization (`engine.py`)

```python
class TadaEngine:
    def __init__(self, model_name="tada-1b", num_threads=6):
        self.device = "cpu"
        self.dtype = torch.float32  # DO NOT CHANGE — float32 is faster on Apple Silicon
        self.model = None
        self.encoder = None
        self.warmed_up = False
        self.generating = False
        self.progress_callback = None

    async def load_model(self):
        """Load TADA model and encoder. Call once on startup."""
        torch.set_num_threads(self.num_threads)
        torch.set_float32_matmul_precision('medium')  # Uses AMX coprocessor

        # Apply monkey-patch BEFORE loading model
        self._patch_generate()

        self.encoder = Encoder.from_pretrained(
            "HumeAI/tada-codec",
            subfolder="encoder"
        ).to(self.device).to(self.dtype)
        self.encoder.eval()

        self.model = TadaForCausalLM.from_pretrained(
            f"HumeAI/{self.model_name}"
        ).to(self.device).to(self.dtype)
        self.model.eval()

    def _patch_generate(self):
        """Monkey-patch to disable internal timing overhead."""
        _original = TadaForCausalLM.generate
        @torch.no_grad()
        def _fast(self_model, *args, **kwargs):
            kwargs['verbose'] = False
            orig = self_model._generate
            def patched(*a, **kw):
                kw['log_time'] = False
                kw['verbose'] = False
                return orig(*a, **kw)
            self_model._generate = patched
            try:
                return _original(self_model, *args, **kwargs)
            finally:
                self_model._generate = orig
        TadaForCausalLM.generate = _fast

    async def warmup(self):
        """Run a silent dummy generation to prime caches."""
        dummy_prompt = self._encode_reference(WARMUP_AUDIO_PATH, WARMUP_TEXT)
        _ = self.model.generate(
            prompt=dummy_prompt,
            text="Hello world.",
            num_transition_steps=5,
            inference_options=self._default_options(),
        )
        self.warmed_up = True

    def _default_options(self):
        return InferenceOptions(
            text_do_sample=True,
            text_temperature=0.6,
            text_top_k=0,
            text_top_p=0.9,
            acoustic_cfg_scale=1.6,
            duration_cfg_scale=1.0,
            cfg_schedule="constant",
            noise_temperature=0.9,
            num_flow_matching_steps=20,
            time_schedule="logsnr",
            num_acoustic_candidates=1,
        )

    def _encode_reference(self, audio_path, transcript=None):
        """Encode reference audio into a prompt for generation."""
        audio, sr = torchaudio.load(audio_path)
        # Must be mono
        if audio.shape[0] > 1:
            audio = audio.mean(dim=0, keepdim=True)
        audio = audio.to(device=self.device, dtype=self.dtype)
        kwargs = {"sample_rate": sr}
        if transcript:
            kwargs["text"] = [transcript]
            kwargs["audio_length"] = torch.tensor([audio.shape[1]], device=self.device)
        return self.encoder(audio, **kwargs)

    async def generate(self, text, voice, system_prompt=None, progress_cb=None):
        """Generate speech. Returns dict with waveform and metadata."""
        if self.generating:
            raise RuntimeError("Generation already in progress")

        self.generating = True
        try:
            if progress_cb:
                progress_cb({"status": "encoding", "percent": 5})

            prompt = self._encode_reference(
                voice.reference_audio_path,
                voice.reference_text
            )

            if progress_cb:
                progress_cb({"status": "generating", "percent": 10})

            gen_kwargs = {
                "prompt": prompt,
                "text": text,
                "num_transition_steps": 5,  # DO NOT set to 0
                "inference_options": self._default_options(),
            }
            if system_prompt:
                gen_kwargs["system_prompt"] = system_prompt

            start = time.time()
            output = self.model.generate(**gen_kwargs)
            gen_time = time.time() - start

            if progress_cb:
                progress_cb({"status": "decoding", "percent": 90})

            waveform = output.audio[0].detach().float().cpu()
            waveform = trim_trailing_silence(waveform)
            duration = waveform.shape[-1] / 24000

            return {
                "waveform": waveform,
                "sample_rate": 24000,
                "duration_seconds": duration,
                "generation_time_seconds": gen_time,
                "rtf": gen_time / duration if duration > 0 else float("inf"),
            }
        finally:
            self.generating = False
```

### Performance Numbers

Tested on M4 Mac Mini (16GB RAM), CPU only, float32:

| Metric | Value |
|--------|-------|
| RTF (short text, 1 sentence) | ~5-7x |
| RTF (medium text, 3-5 sentences) | ~3-4x |
| RTF (long text, paragraph+) | ~3-4x |
| RAM during inference | ~5-6 GB |
| Model loading time | ~30s |
| Warmup time | ~45-60s |
| Example: 25s audio generation | ~85s wall clock |

RTF improves with longer text because per-token overhead amortizes. After warmup, the model runs fastest from the second generation onward.

---

## Audio Processing

### Format Conversion

```python
def convert_audio(input_path, output_path, format, sample_rate, bit_depth):
    if format == "wav":
        torchaudio.save(output_path, waveform, sample_rate,
                       bits_per_sample=bit_depth)
    elif format == "mp3":
        audio = AudioSegment.from_wav(input_path)
        audio.export(output_path, format="mp3", bitrate="192k")
    elif format == "aac":
        audio = AudioSegment.from_wav(input_path)
        audio.export(output_path, format="adts", bitrate="192k")
```

### Reference Audio Validation

When a user uploads reference audio for cloning:

1. Load with torchaudio
2. Resample to 24kHz if needed
3. Convert to mono if stereo
4. Trim leading/trailing silence (threshold: -40dB)
5. Measure duration — reject if < 6 seconds, warn if < 9 seconds
6. Estimate SNR: compute RMS of speech segments vs silent segments
7. Save as WAV 24kHz 16-bit mono
8. Return quality metrics

### Concatenation

For batch export with concatenation:

1. Load all audio files
2. Resample to match target sample rate if any differ
3. Insert silence tensor of `pause_seconds` duration between each
4. Concatenate along time axis
5. Export as single file

---

## Preset Voices

Ship 14 preset voices. Each needs:
- A ~10-15 second clean WAV reference clip
- A transcript of what's being said in the clip
- Metadata (name, gender, color, tags, description)

The reference audio for presets should be generated using a clean, rights-free source. Generate them once during development and bundle them with the app.

```python
PRESET_VOICES = [
    {
        "name": "Warm Narrator",
        "gender": "M",
        "color": "#E8A849",
        "description": "Rich, warm male baritone. Great for audiobooks and storytelling.",
        "tags": ["narration", "audiobook", "warm"],
        "reference_file": "warm-narrator.wav"
    },
    {
        "name": "Bright Host",
        "gender": "F",
        "color": "#D4735E",
        "description": "Energetic female voice with clear diction. Ideal for podcasts and explainers.",
        "tags": ["podcast", "energetic", "clear"],
        "reference_file": "bright-host.wav"
    },
    {
        "name": "Deep Anchor",
        "gender": "M",
        "color": "#7B8F6A",
        "description": "Authoritative deep male voice. Perfect for documentaries and trailers.",
        "tags": ["documentary", "deep", "authority"],
        "reference_file": "deep-anchor.wav"
    },
    {
        "name": "Gentle Reader",
        "gender": "F",
        "color": "#9B8EC4",
        "description": "Soft, calming female voice. Suited for meditation, children's content.",
        "tags": ["calm", "soft", "children"],
        "reference_file": "gentle-reader.wav"
    },
    {
        "name": "Crisp Lecturer",
        "gender": "M",
        "color": "#6BA3B7",
        "description": "Precise, measured delivery. Technical tutorials and presentations.",
        "tags": ["technical", "precise", "tutorial"],
        "reference_file": "crisp-lecturer.wav"
    },
    {
        "name": "Velvet Evening",
        "gender": "F",
        "color": "#B07DA0",
        "description": "Smooth, intimate tone with a slight rasp. Late-night radio feel.",
        "tags": ["intimate", "smooth", "radio"],
        "reference_file": "velvet-evening.wav"
    },
    {
        "name": "Young Storyteller",
        "gender": "M",
        "color": "#5EB88D",
        "description": "Casual, conversational twentysomething. Social media, vlogs, casual narration.",
        "tags": ["casual", "young", "conversational"],
        "reference_file": "young-storyteller.wav"
    },
    {
        "name": "Wise Elder",
        "gender": "M",
        "color": "#8B7355",
        "description": "Weathered, deliberate voice with gravitas. Heritage, wisdom, reflective pieces.",
        "tags": ["wise", "gravitas", "elder"],
        "reference_file": "wise-elder.wav"
    },
    {
        "name": "News Anchor",
        "gender": "F",
        "color": "#4A7FB5",
        "description": "Polished, neutral broadcast delivery. News, corporate, professional.",
        "tags": ["news", "professional", "neutral"],
        "reference_file": "news-anchor.wav"
    },
    {
        "name": "Noir Detective",
        "gender": "M",
        "color": "#5C5C5C",
        "description": "Gritty, world-weary voice. Crime fiction, drama, character work.",
        "tags": ["dramatic", "gritty", "character"],
        "reference_file": "noir-detective.wav"
    },
    {
        "name": "Cheerful Teacher",
        "gender": "F",
        "color": "#F4A261",
        "description": "Warm, encouraging voice. Education, kids, e-learning.",
        "tags": ["education", "encouraging", "friendly"],
        "reference_file": "cheerful-teacher.wav"
    },
    {
        "name": "Epic Trailer",
        "gender": "M",
        "color": "#C0392B",
        "description": "Dramatic, cinematic voice. Trailers, games, hype content.",
        "tags": ["cinematic", "epic", "trailer"],
        "reference_file": "epic-trailer.wav"
    },
    {
        "name": "Soothing Guide",
        "gender": "M",
        "color": "#7DCEA0",
        "description": "Gentle, grounding male voice. Meditation, wellness, breathing exercises.",
        "tags": ["meditation", "soothing", "wellness"],
        "reference_file": "soothing-guide.wav"
    },
    {
        "name": "Bold Commercial",
        "gender": "F",
        "color": "#E74C8B",
        "description": "Punchy, confident delivery. Ads, promos, product videos.",
        "tags": ["commercial", "bold", "promo"],
        "reference_file": "bold-commercial.wav"
    }
]
```

---

## Startup Sequence

1. Create directory structure if not exists (`~/Library/Application Support/Foundry Vox/` tree)
2. Initialize SQLite database, run migrations
3. Seed preset voices if `voices` table is empty
4. Start FastAPI server on `localhost:3456`
5. **Verify bundled model weights** — check that `Resources/models/tada-1b/`, `tada-codec/`, and `llama-tokenizer/` exist and are readable. If missing, set status to `"error"` with message: "Voice engine files are missing or damaged. Please reinstall Foundry Vox."
6. Load TADA model from bundled weights in background thread (report `status: "loading"` on `/health`)
7. Apply monkey-patch for internal timing after model load
8. If `warmup_on_launch` setting is true, run warmup generation (report `status: "warming_up"`)
9. Set status to `"ready"`

The frontend should poll `GET /health` on startup and show a loading state until `status === "ready"`. During loading, the frontend displays rotating tips about voice selection, style prompts, and reference audio quality (see User Guidance section). If status is `"error"`, display a clear, non-technical error message.

---

## Error Handling

All error responses follow this format:

```json
{
  "error": "error_code",
  "message": "Human-readable description",
  "details": {}
}
```

Error codes:
- `models_missing` (503): Bundled model weights are missing or corrupt — user should reinstall
- `model_not_loaded` (503): Model is still loading
- `generation_in_progress` (429): Another generation is running
- `voice_not_found` (404): Voice ID doesn't exist
- `generation_not_found` (404): Generation ID doesn't exist
- `invalid_audio` (400): Uploaded audio is corrupt or unsupported format
- `audio_too_short` (400): Reference audio < 6 seconds
- `text_too_long` (400): Input text > 50,000 characters
- `text_empty` (400): Input text is empty/whitespace
- `invalid_setting` (400): Setting value out of valid range
- `preset_immutable` (403): Tried to delete/modify a preset voice
- `disk_full` (507): Not enough disk space for output
- `model_error` (500): TADA threw an unexpected error during generation
- `out_of_memory` (500): System ran out of RAM during generation

---

## CORS Configuration

Allow `localhost` origins only:

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:*", "tauri://localhost"],
    allow_methods=["*"],
    allow_headers=["*"],
)
```

---

## Dependencies

```
# requirements.txt
fastapi>=0.110.0
uvicorn[standard]>=0.27.0
aiosqlite>=0.19.0
torch>=2.2.0
torchaudio>=2.2.0
pydub>=0.25.1
python-multipart>=0.0.7
aiofiles>=23.2.0
descript-audio-codec
transformers>=4.57.1,<5
hume-tada
```

System requirement: `ffmpeg` must be installed for MP3/AAC conversion via pydub.

---

## File Structure (Backend Codebase)

```
foundry-vox-backend/
├── main.py                     -- FastAPI app, startup sequence, CORS
├── engine.py                   -- TadaEngine class (model loading, generation)
├── audio.py                    -- Audio processing (conversion, validation, trimming, concat)
├── database.py                 -- SQLite initialization, migrations, CRUD helpers
├── models.py                   -- Pydantic models for request/response schemas
├── routes/
│   ├── health.py               -- GET /health
│   ├── voices.py               -- Voice CRUD + clone + preview
│   ├── generate.py             -- POST /generate, SSE progress, audio streaming
│   ├── history.py              -- History listing, stats, deletion
│   ├── settings.py             -- Settings CRUD
│   └── export.py               -- Batch export / concatenation
├── presets/
│   ├── voices.json             -- Preset voice definitions
│   └── audio/                  -- Preset reference WAV files
├── requirements.txt
└── README.md
```

---

## Testing Notes

- Test on M4 Mac Mini 16GB (primary target hardware)
- Verify float32 inference works (not float16)
- Confirm warmup reduces first-gen RTF
- Test with reference audio of varying lengths (6s, 9s, 15s, 30s)
- Test with text of varying lengths (1 sentence, 1 paragraph, full chapter ~2000 words)
- Verify 429 is returned if you hit `/generate` while a generation is in progress
- Test format conversion for WAV, MP3, AAC
- Test clone flow end-to-end: upload audio -> voice created -> generate with new voice
- Verify preset voices cannot be deleted or have references replaced
- Test system_prompt with different emotions (excited, sad, angry, whispering)
- Verify bundled model weight detection and clear error if missing/corrupt
- Verify all 14 preset voices load and generate correctly

---

## Legal Requirements

The following must be visible in the app's About screen and/or App Store listing:

- **"Built with Llama"** — Required by the Llama 3.2 Community License
- **TADA MIT license notice** — Include in licenses screen
- **Llama 3.2 Community License text** — Bundle in app

---

## Out of Scope (v1)

These are NOT part of this backend build:

- SSML or markup parsing
- Streaming audio during generation (TADA is batch, not streaming)
- Multi-language support (English only for v1, even though TADA supports 8 languages)
- Model fine-tuning or LoRA
- Cloud sync
- User accounts or auth
- 3B model support (v1 ships 1B only; 3B is a future upgrade)
- SRT/subtitle-synced generation
