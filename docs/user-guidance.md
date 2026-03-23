# Foundry Vox — User Guidance Content

All user-facing copy for onboarding, tooltips, help text, loading screens, and error messages. This is the single source of truth for UX writing — frontend should pull strings from here.

---

## First Launch / Loading Screen

The model takes ~30s to load and ~45-60s to warm up on first launch. This screen must feel intentional, not broken.

### Loading States

**Stage 1: Model Loading (~30s)**
- Headline: "Firing up the forge..."
- Subtext: "Loading the voice engine. This takes about 30 seconds on first launch."

**Stage 2: Warmup (~45-60s)**
- Headline: "Warming up..."
- Subtext: "Running a quick test generation to get everything ready."

**Stage 3: Ready**
- Headline: "The forge is ready."
- Subtext: "Select a voice, type your text, and hit Generate."

### Loading Screen Tips (rotate every 5 seconds)

These display below the progress bar during model loading/warmup:

1. "The voice you choose sets the tone. Try a few presets to find your starting point."
2. "Want more emotion? The reference audio clip is the strongest control — an excited clip produces excited speech."
3. "Style Direction is a gentle nudge, not a hard steer. Think of it as mood lighting for the voice."
4. "Longer text generates more efficiently. A full paragraph runs ~3x faster per second of audio than a single sentence."
5. "You can clone any voice from a 10-second audio clip. Longer clips with clear speech give the best results."
6. "Speech generation runs locally on your Mac. Foundry Vox does not require cloud inference for generation."
7. "The first word of each generation may sound slightly different. This is a known characteristic of the voice engine."
8. "WAV gives you the highest quality. Use MP3 or AAC when you need smaller file sizes."
9. "Try the same text with different voices to hear how much character the voice adds."
10. "Use the History tab to find and re-download any audio you've generated."

---

## Forge View (Main Generation Screen)

### Text Input

- Placeholder: "Type or paste your text here..."
- Character counter format: "142 / 50,000 characters"
- When empty and focused: "Paste a script, type a sentence, or try one of the example texts below."

### Voice Selector

- When no voice selected: "Choose a voice to get started"
- Preset badge: "Built-in"
- Clone badge: "Custom"
- Voice card tooltip: Shows description + tags

### Style Direction Field

- Label: "Style Direction (optional)"
- Placeholder: "e.g., Speak with warmth and excitement"
- Help tooltip: "Gives the voice engine a hint about tone and emotion. The effect is subtle — your reference audio has much more influence over the final sound. Try phrases like 'Speak softly and slowly' or 'Sound urgent and concerned.'"

### Generate Button States

- Ready: "Generate"
- Generating: "Forging..." (with progress %)
- Cooldown (if somehow triggered twice): "Generation in progress..."

### Progress Messages

These map to the SSE progress events:

- `encoding` (0-10%): "Preparing voice..."
- `generating` (10-90%): "Generating audio..." + token progress
- `decoding` (90-100%): "Finalizing..."
- `complete`: "Done!" (auto-transitions to playback)

### After Generation

- Play button tooltip: "Play / Pause"
- Download button tooltip: "Save audio file"
- Regenerate button tooltip: "Generate again with the same settings (results will vary slightly)"
- Duration display: "24.3s audio · generated in 85s"

---

## Library View (Voice Management)

### Empty State (no cloned voices yet)

- Headline: "Your voice library"
- Body: "Foundry Vox comes with 14 built-in voices. You can also clone any voice from a short audio clip — just click 'Clone Voice' to get started."

### Clone Voice Flow

**Step 1: Upload**
- Headline: "Clone a voice"
- Body: "Upload a clean audio clip of the voice you want to clone. For best results, use a recording that's at least 10 seconds long with minimal background noise."
- Upload button: "Choose Audio File"
- Supported formats note: "WAV, MP3, or M4A"
- Rights acknowledgment: "I confirm I have the right to use this recording and create a voice clone from it."
- Rights help text: "Only upload speech you own, created yourself, or have explicit permission to clone."

**Step 2: Quality Feedback (shown after upload)**

Based on the quality rating from the backend:

- **Excellent** (>25dB SNR, ≥15s): "Excellent reference audio. This will produce very accurate voice cloning."
- **Good** (18-25dB, ≥9s): "Good reference audio. You should get solid results."
- **Fair** (10-18dB or 6-9s): "Usable, but results will improve with a longer or cleaner recording. Tips: record in a quiet room, speak clearly, aim for 10+ seconds."
- **Poor** (<10dB or <6s): "This recording may not produce good results. The audio is too short or has too much background noise. Try recording in a quieter environment with at least 10 seconds of clear speech."

**Step 3: Details**
- Name field placeholder: "e.g., My Narrator Voice"
- Transcript field label: "What's being said in the clip? (optional)"
- Transcript help text: "If you know exactly what's said in the reference audio, type it here. This helps the engine match the voice more accurately. If you leave it blank, the engine will transcribe it automatically."

### Voice Card Actions

- Preview tooltip: "Listen to a short sample"
- Edit tooltip: "Edit name, color, or tags"
- Delete tooltip: "Remove this voice" (clones only)
- Delete confirmation: "Delete this voice? This removes the voice and its reference audio. Any audio you've already generated with this voice will still be available in History."

### Preset Voice — Delete Blocked

- Message: "Built-in voices can't be deleted."

---

## History View

### Empty State

- Headline: "Nothing here yet"
- Body: "Your generated audio will appear here. Head to the Forge to create your first one."

### History Entry

- Displays: voice name, text preview (truncated), duration, date, RTF
- Play button: inline playback
- Download button: save to disk
- Delete tooltip: "Remove from history"
- Delete confirmation: "Delete this generation? The audio file will be permanently removed."

### Clear All

- Button: "Clear History"
- Confirmation: "Delete all generated audio? This removes every file and cannot be undone."

### Stats Panel

- "This session: 3 generations · 1m 14s of audio"
- "All time: 156 generations · 1h 4m of audio"

---

## Settings View

### CPU Threads

- Label: "Processing Threads"
- Help text: "How many CPU cores to use for generation. More threads can improve speed but may slow down other apps. The default of 6 works well for most Macs."

### Output Format

- Label: "Default Output Format"
- Options: WAV (highest quality), MP3 (smaller file size), AAC (smallest file size)

### Output Directory

- Label: "Save Location"
- Help text: "Where generated audio files are stored on your Mac."
- Button: "Change..."

### Warmup on Launch

- Label: "Warm up engine on launch"
- Help text: "Runs a quick silent generation when the app starts so your first real generation is faster. Adds about 45 seconds to startup time."

---

## Error Messages (User-Facing)

These replace the technical error codes with human-readable messages:

| Error Code | User Message |
|---|---|
| `models_missing` | "The voice engine files are missing or damaged. Please reinstall Foundry Vox." |
| `model_not_loaded` | "The voice engine is still starting up. Please wait a moment and try again." |
| `generation_in_progress` | "A generation is already running. Please wait for it to finish." |
| `voice_not_found` | "This voice could not be found. It may have been deleted." |
| `generation_not_found` | "This audio file could not be found. It may have been deleted." |
| `invalid_audio` | "This audio file couldn't be read. Please try a different file (WAV, MP3, or M4A)." |
| `audio_too_short` | "This clip is too short. Please use a recording that's at least 6 seconds long." |
| `text_too_long` | "Your text is over the 50,000 character limit. Try splitting it into smaller sections." |
| `text_empty` | "Please enter some text to generate audio from." |
| `preset_immutable` | "Built-in voices can't be modified." |
| `disk_full` | "Your disk is full. Free up some space and try again." |
| `model_error` | "Something went wrong with the voice engine. Try again, or restart the app if it keeps happening." |
| `out_of_memory` | "Your Mac ran out of available memory. Close some other apps and try again." |

---

## Tooltips & Microcopy

### Voice Quality Indicators (shown on clone cards)

- SNR badge: "Audio clarity: Excellent / Good / Fair / Poor"
- Duration badge: "Reference length: 12.4s"

### Generation Metadata

- RTF explanation (on hover over RTF number): "Real-time factor — how many seconds of processing per second of audio. Lower is faster."

### Keyboard Shortcuts (if implemented)

- `⌘ Enter` — Generate
- `Space` — Play / Pause (when audio player is focused)
- `⌘ S` — Save / Download current audio
- `⌘ 1/2/3` — Switch between Forge / Library / History

---

## Reference Audio Best Practices (Help Panel / Docs)

This content can live in an expandable "Tips" section within the Clone Voice flow, or as a standalone help page.

### What makes good reference audio?

**Length**: 10-15 seconds is the sweet spot. The engine needs enough speech to learn the voice's character. Clips under 6 seconds are rejected; clips under 9 seconds may produce inconsistent results.

**Clarity**: Record in a quiet room. Background noise, music, or other voices confuse the engine and degrade clone quality. A phone recording in a quiet room beats a professional mic in a noisy cafe.

**Content**: Natural speech works best. Read a few sentences at a normal pace. Avoid whispering, shouting, or exaggerated delivery unless that's the voice style you want to clone — the engine reproduces whatever it hears, including emotion and energy level.

**Format**: WAV is ideal, but MP3 and M4A work fine. The engine converts everything to 24kHz mono internally.

### What to avoid

- Background music or ambient noise
- Multiple speakers in the same clip
- Heavily compressed audio (low bitrate MP3s, phone call recordings)
- Very long clips (30+ seconds) — they don't help and slow down processing
- Clips where the speaker changes emotion dramatically mid-sentence
