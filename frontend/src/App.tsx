import { ChangeEvent, FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { api } from "./lib/api";
import { QUALITY_PRESETS, speedHint } from "./lib/qualityPresets";
import FabricTabs from "./components/FabricTabs";
import ForgeVisualizer from "./components/ForgeVisualizer";
import type { Generation, HealthResponse, ProgressEvent, QualityPreset, Settings, Voice } from "./types";

type View = "forge" | "library" | "history";
type LibraryFilter = "all" | "preset" | "clone";
type LibraryMode = "grid" | "list";
type HistorySort = "newest" | "longest" | "shortest";

const TOP_LEVEL_VIEWS: Array<{ id: Extract<View, "forge" | "library" | "history">; label: string }> = [
  { id: "forge", label: "Forge" },
  { id: "library", label: "Library" },
  { id: "history", label: "History" },
];

const DEFAULT_SETTINGS: Settings = {
  model: "tada-1b",
  cpu_threads: 6,
  output_format: "wav",
  sample_rate: 24000,
  bit_depth: 16,
  output_directory: "~/Library/Application Support/Foundry Vox/output",
  warmup_on_launch: true,
};

const ERROR_MESSAGES: Record<string, string> = {
  models_missing: "The voice engine files are missing or damaged. Please reinstall Foundry Vox.",
  model_not_loaded: "The voice engine is still starting up. Please wait a moment and try again.",
  generation_in_progress: "A generation is already running. Please wait for it to finish.",
  voice_not_found: "This voice could not be found. It may have been deleted.",
  generation_not_found: "This audio file could not be found. It may have been deleted.",
  invalid_audio: "This audio file couldn't be read. Please try a different file (WAV, MP3, or M4A).",
  audio_too_short: "This clip is too short. Please use a recording that's at least 6 seconds long.",
  text_too_long: "Your text is over the 50,000 character limit. Try splitting it into smaller sections.",
  text_empty: "Please enter some text to generate audio from.",
  preset_immutable: "Built-in voices can't be modified.",
  disk_full: "Your disk is full. Free up some space and try again.",
  model_error: "Something went wrong with the voice engine. Try again, or restart the app if it keeps happening.",
  out_of_memory: "Your Mac ran out of available memory. Close some other apps and try again.",
  permission_denied: "Foundry Vox doesn't have permission to write to the output folder. Check your system permissions.",
  system_error: "A system error occurred. Try again, or restart the app if it keeps happening.",
  no_space_left: "Your disk is full. Free up some space and try again.",
  unable_to_open_database: "Your disk may be full or the database is locked. Free up some space and try again.",
};

const LOADING_TIPS = [
  "The voice you choose sets the tone. Try a few presets to find your starting point.",
  "Want more emotion? The reference audio clip is the strongest control \u2014 an excited clip produces excited speech.",
  "Style Direction is a gentle nudge, not a hard steer. Think of it as mood lighting for the voice.",
  "Longer text generates more efficiently. A full paragraph runs ~3x faster per second of audio than a single sentence.",
  "You can clone any voice from a 10-second audio clip. Longer clips with clear speech give the best results.",
  "All generation happens locally on your Mac. Nothing leaves your machine \u2014 ever.",
  "The first word of each generation may sound slightly different. This is a known characteristic of the voice engine.",
  "WAV gives you the highest quality. Use MP3 or AAC when you need smaller file sizes.",
  "Try the same text with different voices to hear how much character the voice adds.",
  "Use the History tab to find and re-download any audio you've generated.",
  "Switching voices? The first generation with each new voice takes longer while the engine compiles its profile. After that, it's much faster.",
];

const PROGRESS_LABELS: Record<string, string> = {
  connecting: "Preparing voice...",
  starting: "Preparing voice...",
  encoding: "Preparing voice...",
  generating: "Generating audio...",
  decoding: "Finalizing...",
  complete: "Done!",
};

const CLONE_QUALITY_FEEDBACK: Record<string, { label: string; message: string }> = {
  excellent: { label: "Excellent", message: "Excellent reference audio. This will produce very accurate voice cloning." },
  good: { label: "Good", message: "Good reference audio. You should get solid results." },
  fair: { label: "Fair", message: "Usable, but results will improve with a longer or cleaner recording. Tips: record in a quiet room, speak clearly, aim for 10+ seconds." },
  poor: { label: "Poor", message: "This recording may not produce good results. The audio is too short or has too much background noise. Try recording in a quieter environment with at least 10 seconds of clear speech." },
};

function formatSeconds(value: number) {
  return value >= 60 ? `${Math.floor(value / 60)}m ${Math.round(value % 60)}s` : `${value.toFixed(1)}s`;
}

function relativeDate(iso: string) {
  return new Date(iso).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function accentColor(voice: Voice | null | undefined) {
  return voice?.color ?? "#E8A849";
}

function waveformHeight(index: number, max = 88) {
  const shaped = Math.sin(index * 0.34) * 18 + Math.cos(index * 0.63) * 14 + max * 0.45;
  return Math.max(8, Math.min(max, shaped));
}

function miniWaveHeight(index: number, max = 24) {
  const shaped = Math.sin(index * 0.55) * (max * 0.28) + Math.cos(index * 0.95) * (max * 0.18) + max * 0.48;
  return Math.max(4, Math.min(max, shaped));
}

function WaveformBars({ active, color, barCount = 56 }: { active: boolean; color: string; barCount?: number }) {
  return (
    <div className="waveform-bars" aria-hidden="true">
      {Array.from({ length: barCount }).map((_, index) => (
        <span
          key={index}
          className={`waveform-bar ${active ? "active" : ""}`}
          style={{
            height: `${active ? waveformHeight(index) : 8}px`,
            animationDelay: `${index * 0.025}s`,
            ["--bar-color" as string]: color,
          }}
        />
      ))}
    </div>
  );
}

function MiniWaveform({ color, bars = 18 }: { color: string; bars?: number }) {
  return (
    <div className="mini-waveform" aria-hidden="true">
      {Array.from({ length: bars }).map((_, index) => (
        <span
          key={index}
          className="mini-waveform-bar"
          style={{
            height: `${miniWaveHeight(index)}px`,
            ["--bar-color" as string]: color,
          }}
        />
      ))}
    </div>
  );
}

function EmberParticles({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div className="ember-layer" aria-hidden="true">
      {Array.from({ length: 12 }).map((_, index) => (
        <span
          key={index}
          className="ember-particle"
          style={{
            left: `${10 + index * 7}%`,
            animationDelay: `${index * 0.22}s`,
            animationDuration: `${2.3 + (index % 5) * 0.38}s`,
          }}
        />
      ))}
    </div>
  );
}

function humanError(raw: string): string {
  const code = raw.toLowerCase().replace(/\s+/g, "_");
  for (const [key, message] of Object.entries(ERROR_MESSAGES)) {
    if (code.includes(key) || raw.includes(key)) return message;
  }
  return raw;
}

export default function App() {
  const [view, setView] = useState<View>("forge");
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>("");
  const [history, setHistory] = useState<Generation[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [text, setText] = useState(
    "The forge burns brightest at midnight. Every voice begins as raw metal, waiting for its final shape.",
  );
  const [selectedQuality, setSelectedQuality] = useState<QualityPreset>("balanced");

  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [error, setError] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  const [showAboutPanel, setShowAboutPanel] = useState(false);
  const [cloneName, setCloneName] = useState("");
  const [cloneTranscript, setCloneTranscript] = useState("");
  const [cloneGender, setCloneGender] = useState("O");
  const [cloneTags, setCloneTags] = useState("personal, clone");
  const [cloneFile, setCloneFile] = useState<File | null>(null);
  const [cloneQuality, setCloneQuality] = useState<string>("");
  const [historySearch, setHistorySearch] = useState("");
  const [historySelection, setHistorySelection] = useState<string[]>([]);
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>("all");
  const [libraryMode, setLibraryMode] = useState<LibraryMode>("grid");
  const [previewVoiceId, setPreviewVoiceId] = useState<string | null>(null);
  const [historyVoiceFilter, setHistoryVoiceFilter] = useState("all");
  const [historySort, setHistorySort] = useState<HistorySort>("newest");
  const eventSourceRef = useRef<{ close: () => Promise<void> } | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const generationAudioUrlsRef = useRef<Record<string, string>>({});
  const scriptImportRef = useRef<HTMLInputElement | null>(null);
  const renderAudioRef = useRef<HTMLAudioElement | null>(null);
  const [renderPlaying, setRenderPlaying] = useState(false);
  const [renderTime, setRenderTime] = useState(0);
  const [renderDuration, setRenderDuration] = useState(0);
  const [generationAudioUrls, setGenerationAudioUrls] = useState<Record<string, string>>({});
  const [loadingTipIndex, setLoadingTipIndex] = useState(0);

  const selectedVoice = useMemo(
    () => voices.find((voice) => voice.id === selectedVoiceId) ?? voices[0] ?? null,
    [selectedVoiceId, voices],
  );

  const voiceMap = useMemo(() => new Map(voices.map((voice) => [voice.id, voice])), [voices]);

  const filteredVoices = useMemo(
    () => voices.filter((voice) => (libraryFilter === "all" ? true : voice.type === libraryFilter)),
    [libraryFilter, voices],
  );

  const filteredHistory = useMemo(() => {
    const byVoice = historyVoiceFilter === "all" ? history : history.filter((entry) => entry.voice_id === historyVoiceFilter);
    const bySearch = historySearch
      ? byVoice.filter((entry) => entry.text.toLowerCase().includes(historySearch.toLowerCase()))
      : byVoice;
    return [...bySearch].sort((left, right) => {
      if (historySort === "longest") return right.duration_seconds - left.duration_seconds;
      if (historySort === "shortest") return left.duration_seconds - right.duration_seconds;
      return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
    });
  }, [history, historySearch, historySort, historyVoiceFilter]);

  const historySummary = useMemo(() => {
    const totalAudioSeconds = history.reduce((sum, entry) => sum + entry.duration_seconds, 0);
    const totalGenerationSeconds = history.reduce((sum, entry) => sum + entry.generation_time_seconds, 0);
    const avgRtf = history.length ? history.reduce((sum, entry) => sum + entry.rtf, 0) / history.length : 0;
    return { totalAudioSeconds, totalGenerationSeconds, avgRtf };
  }, [history]);
  const generatedVoiceIds = useMemo(() => new Set(history.map((entry) => entry.voice_id)), [history]);
  const [sessionCompiledVoiceIds, setSessionCompiledVoiceIds] = useState<Set<string>>(new Set());
  const latestGeneration = useMemo(() => history[0] ?? null, [history]);
  const recentGenerations = useMemo(() => history.slice(0, 3), [history]);
  const setupActions = health?.setup_actions ?? [];
  const modelsDirectory = useMemo(
    () => setupActions.find((action) => action.startsWith("App models directory: "))?.replace("App models directory: ", "") ?? null,
    [setupActions],
  );
  const engineReady = health?.status === "ready";
  const engineWarming = health?.status === "warming_up" || health?.status === "loading";
  const setupChecklist = [
    { label: "Backend connected", done: Boolean(health) },
    { label: "Model loaded", done: Boolean(health?.model_loaded) },
    { label: "Warmup complete", done: Boolean(health?.warmed_up) || !settings.warmup_on_launch },
  ];

  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  const charCount = text.length;
  const estimatedDuration = Math.max(1, Math.round(wordCount * 0.45));
  const estimatedForgeTime = Math.max(1, Math.round(estimatedDuration * 3.5));
  const canGenerate = engineReady && !busy && Boolean(selectedVoice) && Boolean(text.trim());
  const launchWarmedVoiceId = settings.warmup_on_launch ? voices[0]?.id ?? null : null;
  const firstRenderMayBeSlower =
    Boolean(selectedVoice) &&
    Boolean(engineReady) &&
    selectedVoice?.id !== launchWarmedVoiceId &&
    !sessionCompiledVoiceIds.has(selectedVoice!.id);

  useEffect(() => {
    generationAudioUrlsRef.current = generationAudioUrls;
  }, [generationAudioUrls]);

  async function refreshHealth() {
    const healthData = await api.getHealth();
    setHealth(healthData);
    return healthData;
  }

  async function refreshHistory() {
    const historyData = await api.getHistory(new URLSearchParams({ limit: "50", sort: "newest" }));
    setHistory(historyData.generations);
  }

  async function refreshAll() {
    try {
      const [healthData, voicesData, historyData, settingsData] = await Promise.all([
        api.getHealth(),
        api.getVoices(),
        api.getHistory(new URLSearchParams({ limit: "50", sort: "newest" })),
        api.getSettings(),
      ]);
      setHealth(healthData);
      setVoices(voicesData.voices);
      setSelectedVoiceId((current) => current || voicesData.voices[0]?.id || "");
      setHistory(historyData.generations);
      setSettings(settingsData);
      setError("");
    } catch (requestError) {
      setError(humanError(requestError instanceof Error ? requestError.message : "Unable to load Foundry Vox."));
    }
  }

  useEffect(() => {
    void refreshAll();
    return () => {
      void eventSourceRef.current?.close();
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
      Object.values(generationAudioUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  useEffect(() => {
    if (busy || health?.status === "ready") {
      return;
    }

    let cancelled = false;
    let timeoutId: number | null = null;

    const scheduleNext = (delayMs: number) => {
      timeoutId = window.setTimeout(() => {
        void pollHealth();
      }, delayMs);
    };

    const pollHealth = async () => {
      try {
        const nextHealth = await refreshHealth();
        if (cancelled || nextHealth.status === "ready") {
          return;
        }
        if (!cancelled) {
          scheduleNext(5_000);
        }
        return;
      } catch (requestError) {
        if (!cancelled) {
          setError(humanError(requestError instanceof Error ? requestError.message : "Unable to reach the backend."));
        }
      }

      if (!cancelled) {
        scheduleNext(5_000);
      }
    };

    scheduleNext(5_000);

    return () => {
      cancelled = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [busy, health?.status]);

  function audioMimeType(format: Generation["format"]) {
    if (format === "mp3") return "audio/mpeg";
    if (format === "aac") return "audio/aac";
    return "audio/wav";
  }

  async function ensureGenerationAudioUrl(entry: Generation) {
    const existing = generationAudioUrlsRef.current[entry.id];
    if (existing) return existing;

    const file = await api.downloadGenerationAudio(entry.id);
    const audioUrl = URL.createObjectURL(
      new Blob([new Uint8Array(file.bytes)], { type: audioMimeType(entry.format) }),
    );
    setGenerationAudioUrls((current) => ({ ...current, [entry.id]: audioUrl }));
    return audioUrl;
  }

  useEffect(() => {
    if (busy) {
      return;
    }

    const visibleEntries = new Map<string, Generation>();
    if (latestGeneration) {
      visibleEntries.set(latestGeneration.id, latestGeneration);
    }

    if (view === "history") {
      filteredHistory.slice(0, 12).forEach((entry) => visibleEntries.set(entry.id, entry));
    }

    recentGenerations.forEach((entry) => visibleEntries.set(entry.id, entry));

    // Load audio sequentially to avoid overwhelming IPC, with retry
    let cancelled = false;
    (async () => {
      for (const entry of visibleEntries.values()) {
        if (cancelled) break;
        if (generationAudioUrlsRef.current[entry.id]) continue;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            await ensureGenerationAudioUrl(entry);
            break;
          } catch {
            if (attempt < 2) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
          }
        }
      }
    })();

    return () => { cancelled = true; };
  }, [busy, filteredHistory, latestGeneration, recentGenerations, view]);

  // Rotate loading tips every 5 seconds while engine is not ready
  useEffect(() => {
    if (engineReady) return;
    const interval = window.setInterval(() => {
      setLoadingTipIndex((current) => (current + 1) % LOADING_TIPS.length);
    }, 5000);
    return () => window.clearInterval(interval);
  }, [engineReady]);

  // Global keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.metaKey || event.ctrlKey) {
        if (event.key === "1") { event.preventDefault(); setView("forge"); }
        else if (event.key === "2") { event.preventDefault(); setView("library"); }
        else if (event.key === "3") { event.preventDefault(); setView("history"); }
        else if (event.key === "s" && latestGeneration) { event.preventDefault(); void handleSaveGeneration(latestGeneration); }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [latestGeneration]);

  async function handleGenerate() {
    if (!selectedVoice) {
      setError("Choose a voice to get started.");
      return;
    }
    if (!text.trim()) {
      setError(ERROR_MESSAGES.text_empty);
      return;
    }

    setBusy(true);
    setError("");
    setProgress({ status: "connecting", percent: 1 });
    setProgress({ status: "starting", percent: 2 });

    try {
      const response = await api.generate({
        text,
        voice_id: selectedVoice.id,
        system_prompt: null,
        format: settings.output_format,
        sample_rate: settings.sample_rate,
        quality: selectedQuality,
      });
      setHistory((current) => {
        const withoutDuplicate = current.filter((entry) => entry.id !== response.generation.id);
        return [response.generation, ...withoutDuplicate];
      });
      setSessionCompiledVoiceIds((current) => new Set([...current, selectedVoice.id]));
      setView("forge");
      setProgress({ status: "complete", percent: 100, generation_id: response.generation.id });
    } catch (requestError) {
      setError(humanError(requestError instanceof Error ? requestError.message : "Generation failed."));
      void refreshHealth().catch(() => {
        // Keep the last-known health state if the refresh misses.
      });
    } finally {
      setBusy(false);
      window.setTimeout(() => setProgress(null), 2500);
    }
  }

  async function handleCloneSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!cloneFile || !cloneName.trim()) return;

    const formData = new FormData();
    formData.append("name", cloneName.trim());
    formData.append("audio", cloneFile);
    formData.append("gender", cloneGender);
    formData.append("transcript", cloneTranscript);
    formData.append("tags", JSON.stringify(cloneTags.split(",").map((tag) => tag.trim()).filter(Boolean)));

    try {
      const response = await api.createClone(formData);
      const rating = response.quality.quality_rating.toLowerCase();
      const feedback = CLONE_QUALITY_FEEDBACK[rating];
      setCloneQuality(
        feedback ? feedback.message : `${response.quality.quality_rating.toUpperCase()} · ${response.quality.duration_seconds.toFixed(1)}s · SNR ${response.quality.snr_estimate_db}dB`,
      );
      setVoices((current) => [response.voice, ...current]);
      setSelectedVoiceId(response.voice.id);
      setCloneOpen(false);
      setCloneFile(null);
      setCloneName("");
      setCloneTranscript("");
      setCloneTags("personal, clone");
      setView("library");
    } catch (requestError) {
      setError(humanError(requestError instanceof Error ? requestError.message : "Voice cloning failed."));
    }
  }

  async function handleDeleteVoice(voiceId: string) {
    await api.deleteVoice(voiceId);
    setVoices((current) => current.filter((voice) => voice.id !== voiceId));
    setSelectedVoiceId((current) => (current === voiceId ? "" : current));
  }

  async function handleDeleteGeneration(generationId: string) {
    const audioUrl = generationAudioUrlsRef.current[generationId];
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      setGenerationAudioUrls((current) => {
        const next = { ...current };
        delete next[generationId];
        return next;
      });
    }
    await api.deleteHistoryItem(generationId);
    setHistory((current) => current.filter((entry) => entry.id !== generationId));
    setHistorySelection((current) => current.filter((id) => id !== generationId));
  }

  async function handleClearHistory() {
    Object.values(generationAudioUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
    setGenerationAudioUrls({});
    await api.clearHistory();
    setHistory([]);
    setHistorySelection([]);
  }

  async function handleSaveSettings(patch: Partial<Settings>) {
    const updated = await api.patchSettings(patch);
    setSettings(updated);
  }

  async function handleExportSelection(mode: "zip" | "concatenate") {
    if (historySelection.length === 0) return;
    const file = await api.exportBatch({
      generation_ids: historySelection,
      mode,
      format: settings.output_format,
    });
    const destination = await save({
      title: mode === "zip" ? "Save export archive" : "Save stitched audio",
      defaultPath: file.fileName,
    });
    if (!destination) return;

    await writeFile(destination, new Uint8Array(file.bytes));
  }

  async function handleSaveGeneration(entry: Generation) {
    const destination = await save({
      title: "Save rendered audio",
      defaultPath: `foundry-vox-${entry.voice_name.toLowerCase().replace(/\s+/g, "-")}.${entry.format}`,
    });
    if (!destination) return;

    const file = await api.downloadGenerationAudio(entry.id);
    await writeFile(destination, new Uint8Array(file.bytes));
  }

  async function handleVoicePreview(voiceId: string) {
    setPreviewVoiceId(voiceId);
    try {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }

      const file = await api.getVoicePreview(voiceId);
      const audioUrl = URL.createObjectURL(new Blob([new Uint8Array(file.bytes)], { type: "audio/wav" }));
      previewUrlRef.current = audioUrl;

      const preview = new Audio(audioUrl);
      preview.addEventListener(
        "ended",
        () => {
          setPreviewVoiceId((current) => (current === voiceId ? null : current));
          if (previewUrlRef.current) {
            URL.revokeObjectURL(previewUrlRef.current);
            previewUrlRef.current = null;
          }
        },
        { once: true },
      );
      await preview.play();
    } catch {
      setPreviewVoiceId(null);
    }
  }

  async function handleOpenModelsDirectory() {
    try {
      await invoke("open_models_directory");
    } catch {
      setError("Unable to open the models folder.");
    }
  }

  async function handlePasteScript() {
    try {
      const clipboardText = await navigator.clipboard.readText();
      if (clipboardText) {
        setText(clipboardText);
      }
    } catch {
      setError("Clipboard access was denied.");
    }
  }

  function handleImportScript(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    void file.text().then((contents) => setText(contents));
    event.target.value = "";
  }

  function handleForgeEditorKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && canGenerate) {
      event.preventDefault();
      void handleGenerate();
    }
  }

  return (
    <div className="app-frame">
      {/* Hidden SVG filter — Damascus steel organic turbulence pattern */}
      <svg aria-hidden="true" style={{ position: "absolute", width: 0, height: 0 }}>
        <defs>
          <filter id="damascus" x="0%" y="0%" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.004 0.012" numOctaves="6" seed="3" stitchTiles="stitch" result="noise" />
            <feColorMatrix type="saturate" values="0" in="noise" result="mono" />
            <feComponentTransfer in="mono" result="contrast">
              <feFuncR type="linear" slope="3" intercept="-0.8" />
              <feFuncG type="linear" slope="3" intercept="-0.8" />
              <feFuncB type="linear" slope="3" intercept="-0.8" />
              <feFuncA type="linear" slope="1" intercept="0" />
            </feComponentTransfer>
          </filter>
        </defs>
      </svg>
      <header className="window-chrome">
        <div className="chrome-left">
          <div className="brand-lockup">
            <div className="brand-mark">F</div>
            <div>
              <p className="eyebrow">Local voice forge</p>
              <h1>Foundry Vox</h1>
            </div>
          </div>
        </div>

        <FabricTabs views={TOP_LEVEL_VIEWS} activeView={view} onViewChange={setView} />

        <div className="chrome-right">
          <div className="engine-pill">
            <span className={`engine-dot ${health?.status ?? "loading"}`} />
            <span>{health?.status === "ready" ? "Ready to forge" : health?.status ?? "loading"}</span>
          </div>
          <button
            className={`icon-button ${showAboutPanel ? "active" : ""}`}
            onClick={() => {
              setShowAboutPanel((current) => !current);
              setShowSettingsPanel(false);
            }}
          >
            About
          </button>
          <button
            className={`icon-button ${showSettingsPanel ? "active" : ""}`}
            onClick={() => {
              setShowSettingsPanel((current) => !current);
              setShowAboutPanel(false);
            }}
          >
            Settings
          </button>
        </div>
      </header>

      <main className="workspace-shell">
        {error ? (
          <section className={`error-banner ${error.includes("disk") ? "error-critical" : ""}`}>
            <div className="error-content">
              <strong>{error.includes("disk") ? "Disk full" : error.includes("memory") ? "Out of memory" : "Something went wrong"}</strong>
              <p>{error}</p>
            </div>
            <button className="error-dismiss" onClick={() => setError("")} title="Dismiss">✕</button>
          </section>
        ) : null}

        {health && health.status !== "ready" ? (
          <section className={`setup-card ${health.status}`}>
            <div className="engine-pulse-container">
              <div className="engine-pulse" />
              <div className="engine-pulse-ring" />
            </div>
            <div className="setup-copy">
              <p className="eyebrow">Engine setup</p>
              <h2>{health.status === "warming_up" ? "Warming up..." : "Firing up the forge..."}</h2>
              <p>
                {health.status === "warming_up"
                  ? "Running a quick test generation to get everything ready."
                  : "Loading the voice engine. This takes about 30 seconds on first launch."}
              </p>
            </div>
            <div className="setup-meta">
              <span className={`status-pill ${health.status}`}>{health.status}</span>
              <span>{health.model.toUpperCase()}</span>
              <span>{health.device}</span>
              <span>{health.dtype}</span>
            </div>
            {setupActions.length > 0 ? (
              <div className="setup-actions">
                {setupActions.map((action) => (
                  <div key={action} className="setup-action">
                    {action}
                  </div>
                ))}
              </div>
            ) : null}
            {modelsDirectory ? (
              <div className="setup-button-row">
                <button className="micro-button accent" onClick={() => void handleOpenModelsDirectory()}>
                  Open models folder
                </button>
              </div>
            ) : null}
            <div className="setup-checklist">
              {setupChecklist.map((item) => (
                <div key={item.label} className={`setup-check ${item.done ? "done" : ""}`}>
                  <span>{item.done ? "✓" : "·"}</span>
                  <span>{item.label}</span>
                </div>
              ))}
            </div>
            <p className="loading-tip">{LOADING_TIPS[loadingTipIndex]}</p>
          </section>
        ) : null}

        {view === "forge" ? (
          <section className="forge-page">
            <aside className="voice-rail">
              <div className="rail-header">
                <span className="eyebrow">Voices</span>
                <button className="micro-button accent" onClick={() => setCloneOpen(true)}>
                  + Clone
                </button>
              </div>

              <div className="voice-rail-list">
                {voices.map((voice) => {
                  const selected = selectedVoice?.id === voice.id;
                  const color = accentColor(voice);
                  return (
                    <button
                      key={voice.id}
                      className={`voice-rail-card ${selected ? "selected" : ""}`}
                      style={{ ["--voice-accent" as string]: color }}
                      onClick={() => setSelectedVoiceId(voice.id)}
                    >
                      <div className="voice-rail-mark">{voice.type === "clone" ? "◆" : "▪"}</div>
                      <div className="voice-rail-copy">
                        <strong>{voice.name}</strong>
                        <span>
                          {voice.type === "clone"
                            ? `CLONED · ${voice.reference_duration_seconds?.toFixed(1) ?? "?"}s`
                            : `PRESET · ${voice.gender ?? "?"}`}
                        </span>
                      </div>
                      {selected ? <span className="voice-rail-dot" /> : null}
                    </button>
                  );
                })}
              </div>

              <div className="selected-voice-card" style={{ ["--voice-accent" as string]: accentColor(selectedVoice) }}>
                <h3>{selectedVoice?.name ?? "No voice selected"}</h3>
                <p>{selectedVoice?.description ?? "Choose a preset or clone a new reference voice."}</p>
                <div className="chip-row">
                  {(selectedVoice?.tags ?? []).slice(0, 3).map((tag) => (
                    <span key={tag} className="chip">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </aside>

            <section className="forge-stage">
              <article className="forge-script-card">
                <div className="section-header">
                  <div>
                    <h2>Shape the narration</h2>
                  </div>
                  <div className="section-actions">
                    <button className="micro-button" onClick={() => scriptImportRef.current?.click()}>
                      Import .txt
                    </button>
                    <button className="micro-button" onClick={() => void handlePasteScript()}>
                      Paste
                    </button>
                  </div>
                </div>

                <input
                  ref={scriptImportRef}
                  className="hidden-input"
                  type="file"
                  accept=".txt,.md"
                  onChange={handleImportScript}
                />

                <textarea
                  className="forge-textarea"
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  onKeyDown={handleForgeEditorKeyDown}
                  placeholder="Type or paste your text here..."
                />

                <div className="script-footer">
                  <span>{charCount.toLocaleString()} / 50,000 characters</span>
                  <span>~{estimatedDuration}s audio · ~{estimatedForgeTime}s forge time</span>
                </div>
              </article>

              <article className={`forge-wave-card ${busy ? "active" : ""}`} style={{ ["--voice-accent" as string]: accentColor(selectedVoice) }}>
                <EmberParticles active={busy} />
                <div className="section-header">
                  <div>
                    <h2>{busy ? "Heating the metal" : "Ready for output"}</h2>
                  </div>
                  <div className="forge-wave-meta">
                    <span>{selectedVoice?.name ?? "No voice"}</span>
                    <span>{settings.output_format.toUpperCase()} · {settings.sample_rate / 1000}kHz</span>
                  </div>
                </div>

                <ForgeVisualizer
                  state={busy ? "generating" : engineWarming ? "warming" : latestGeneration ? "complete" : "idle"}
                  color={accentColor(selectedVoice)}
                  progress={progress?.percent ?? 0}
                />

                {progress ? (
                  <div className="progress-block">
                    <div className="progress-meta">
                      <span>{PROGRESS_LABELS[progress.status] ?? progress.status}</span>
                      <strong>{Math.round(progress.percent)}%</strong>
                    </div>
                    <div className="progress-track">
                      <div className="progress-fill" style={{ width: `${progress.percent}%` }} />
                    </div>
                    <p className="muted">
                      {progress.tokens_total
                        ? `${progress.tokens_generated ?? 0} / ${progress.tokens_total} tokens`
                        : "Local generation is running in the background."}
                    </p>
                  </div>
                ) : (
                  <p className="wave-note">
                    {health?.status === "ready"
                      ? "The forge is ready. Select a voice, type your text, and hit Generate."
                      : "The model is still warming up. Once ready, the first render will appear here."}
                  </p>
                )}
              </article>
            </section>

            <aside className="forge-sidebar">
              <article className="control-card">
                <div className="section-header">
                  <div>
                    <h3>Performance settings</h3>
                  </div>
                </div>

                <label className="control-field">
                  <span>Voice</span>
                  <select
                    value={selectedVoice?.id ?? ""}
                    onChange={(event) => setSelectedVoiceId(event.target.value)}
                    title="Switching voices can make the first render slower while Foundry Vox compiles that voice's prompt shape."
                  >
                    {voices.map((voice) => (
                      <option key={voice.id} value={voice.id}>
                        {voice.name}
                      </option>
                    ))}
                  </select>
                  {firstRenderMayBeSlower ? (
                    <p className="field-help field-help-emphasis">
                      First generation with <strong>{selectedVoice?.name}</strong> takes extra time while the engine compiles this voice's profile. After that, generations with this voice will be much faster for the rest of the session.
                    </p>
                  ) : null}
                </label>

                <div className="quality-control">
                  <div className="quality-control-head">
                    <span>Quality preset</span>
                    <span className="quality-control-note">Higher quality is slower</span>
                  </div>
                  <div className="quality-picker" role="radiogroup" aria-label="Generation quality preset">
                    {QUALITY_PRESETS.map((preset) => {
                      const selected = selectedQuality === preset.key;
                      return (
                        <button
                          key={preset.key}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          className={`quality-chip ${selected ? "selected" : ""}`}
                          title={`${preset.description} • ${speedHint(preset.expected_rtf)} • ${preset.steps} diffusion steps`}
                          onClick={() => setSelectedQuality(preset.key)}
                        >
                          <strong>{preset.label}</strong>
                          <span>{speedHint(preset.expected_rtf)}</span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="field-help">
                    <strong>{QUALITY_PRESETS.find((preset) => preset.key === selectedQuality)?.label ?? "Balanced"}</strong>
                    {" "}
                    uses{" "}
                    {QUALITY_PRESETS.find((preset) => preset.key === selectedQuality)?.steps ?? 3}
                    {" "}
                    diffusion steps.
                  </p>
                </div>

                {firstRenderMayBeSlower ? (
                  <div className="first-gen-inline-notice">
                    <span className="first-gen-inline-icon">⏱</span>
                    <span>First forge with <strong>{selectedVoice?.name}</strong> takes longer — the engine needs to compile this voice. It'll be fast after that.</span>
                  </div>
                ) : null}

                <div className="button-row">
                  <button
                    className={`primary-button${firstRenderMayBeSlower ? " first-gen-glow" : ""}`}
                    onClick={() => void handleGenerate()}
                    disabled={!canGenerate}
                    title={
                      firstRenderMayBeSlower
                        ? "First generation with a new voice takes extra time while the engine compiles its profile. Subsequent generations will be much faster."
                        : "Generate audio with the selected voice."
                    }
                  >
                    {busy
                      ? "Forging..."
                      : engineReady
                        ? firstRenderMayBeSlower
                          ? "Forge voice (slower first run)"
                          : "Forge voice  cmd+enter"
                        : engineWarming
                          ? "Preparing engine..."
                          : "Generation unavailable"}
                  </button>
                  <button className="ghost-button" onClick={() => setText("")}>
                    Clear
                  </button>
                </div>
                {!engineReady ? (
                  <p className="field-help">
                    {health?.setup_detail ??
                      "Generation unlocks once the local model finishes loading and warmup completes."}
                  </p>
                ) : null}
              </article>

              <article className="latest-render-card" style={{ ["--voice-accent" as string]: accentColor(latestGeneration ? voiceMap.get(latestGeneration.voice_id) : selectedVoice) }}>
                {latestGeneration ? <div className="render-accent-bar" /> : null}
                <div className="section-header">
                  <div>
                    <p className="eyebrow">{latestGeneration ? `${latestGeneration.voice_name} · ${latestGeneration.quality ?? "balanced"}` : "Latest render"}</p>
                    <h3>{latestGeneration ? formatSeconds(latestGeneration.duration_seconds) + " of audio" : "Nothing forged yet"}</h3>
                  </div>
                  {latestGeneration ? (
                    <button
                      className="micro-button accent"
                      onClick={() => void handleSaveGeneration(latestGeneration)}
                      title="Save to disk"
                    >
                      Save
                    </button>
                  ) : null}
                </div>

                {latestGeneration ? (
                  <>
                    <div className="custom-player">
                      <button
                        className="player-play-btn"
                        onClick={() => {
                          const audio = renderAudioRef.current;
                          if (!audio) return;
                          if (renderPlaying) { audio.pause(); } else { void audio.play(); }
                        }}
                      >
                        {renderPlaying ? "❚❚" : "▶"}
                      </button>
                      <input
                        className="scrub-bar"
                        type="range"
                        min={0}
                        max={renderDuration || 1}
                        step={0.01}
                        value={renderTime}
                        onChange={(e) => {
                          const audio = renderAudioRef.current;
                          if (audio) audio.currentTime = Number(e.target.value);
                          setRenderTime(Number(e.target.value));
                        }}
                        style={{ "--scrub-pct": `${renderDuration ? (renderTime / renderDuration) * 100 : 0}%` } as React.CSSProperties}
                      />
                      <span className="player-time">
                        {formatSeconds(renderTime)} / {formatSeconds(renderDuration)}
                      </span>
                    </div>
                    <audio
                      ref={renderAudioRef}
                      src={generationAudioUrls[latestGeneration.id]}
                      onPlay={() => setRenderPlaying(true)}
                      onPause={() => setRenderPlaying(false)}
                      onEnded={() => { setRenderPlaying(false); setRenderTime(0); }}
                      onTimeUpdate={(e) => setRenderTime((e.target as HTMLAudioElement).currentTime)}
                      onLoadedMetadata={(e) => setRenderDuration((e.target as HTMLAudioElement).duration)}
                      style={{ display: "none" }}
                    />
                    <div className="metrics-row">
                      <span title="Real-time factor — lower is faster">{latestGeneration.rtf.toFixed(1)}x RTF</span>
                      <span>{formatSeconds(latestGeneration.generation_time_seconds)} forge</span>
                      <span>{latestGeneration.format.toUpperCase()}</span>
                      <span>{relativeDate(latestGeneration.created_at)}</span>
                    </div>
                  </>
                ) : (
                  <p className="muted">Your next generation will appear here with inline playback and export-ready metadata.</p>
                )}
              </article>

              <article className="recent-forges-card">
                <div className="section-header">
                  <div>
                    <p className="eyebrow">Recent forges</p>
                  </div>
                  <button className="micro-button" onClick={() => setView("history")}>
                    View all
                  </button>
                </div>
                <div className="recent-forges-list">
                  {recentGenerations.length > 0 ? (
                    recentGenerations.map((entry) => (
                      <button
                        key={entry.id}
                        className="recent-forge-item"
                        onClick={() => setView("history")}
                      >
                        <p>{entry.text}</p>
                        <div className="recent-forge-meta">
                          <span>{entry.voice_name}</span>
                          <span>
                            {formatSeconds(entry.duration_seconds)} · {entry.rtf.toFixed(1)}x
                          </span>
                        </div>
                        <div className="recent-forge-time">{relativeDate(entry.created_at)}</div>
                      </button>
                    ))
                  ) : (
                    <p className="muted">Your recent renders will stack up here once you begin forging.</p>
                  )}
                </div>
              </article>

              <article className="session-card">
                <p className="eyebrow">Session</p>
                <div className="session-stats">
                  <div>
                    <span>Forged</span>
                    <strong>{history.length} clips</strong>
                  </div>
                  <div>
                    <span>Audio</span>
                    <strong>{formatSeconds(historySummary.totalAudioSeconds)}</strong>
                  </div>
                  <div>
                    <span>Avg RTF</span>
                    <strong>{historySummary.avgRtf.toFixed(1)}x</strong>
                  </div>
                  <div>
                    <span>Model</span>
                    <strong>{health?.status === "ready" ? "Warmed up" : health?.status ?? "loading"}</strong>
                  </div>
                </div>
              </article>
            </aside>
          </section>
        ) : null}

        {view === "library" ? (
          <section className="library-page">
            <div className="section-title">
              <div>
                <p className="eyebrow">Voice library</p>
                <h2>Preset and cloned references</h2>
              </div>
              <div className="section-actions">
                <div className="toggle-group">
                  {(["grid", "list"] as const).map((mode) => (
                    <button
                      key={mode}
                      className={`toggle-button ${libraryMode === mode ? "active" : ""}`}
                      onClick={() => setLibraryMode(mode)}
                    >
                      {mode === "grid" ? "Grid" : "List"}
                    </button>
                  ))}
                </div>
                <div className="toggle-group">
                  {(["all", "preset", "clone"] as const).map((filter) => (
                    <button
                      key={filter}
                      className={`toggle-button ${libraryFilter === filter ? "active" : ""}`}
                      onClick={() => setLibraryFilter(filter)}
                    >
                      {filter}
                    </button>
                  ))}
                </div>
                <button className="primary-button" onClick={() => setCloneOpen(true)}>
                  Clone new voice
                </button>
              </div>
            </div>

            <div className="library-content">
              <div className={`voice-grid ${libraryMode === "list" ? "list-mode" : ""}`}>
                {filteredVoices.map((voice) => {
                  const selected = selectedVoiceId === voice.id;
                  const color = accentColor(voice);
                  return (
                    <article
                      key={voice.id}
                      className={`voice-card ${selected ? "selected" : ""}`}
                      style={{ ["--voice-accent" as string]: color }}
                      onClick={() => setSelectedVoiceId(voice.id)}
                    >
                      <div className="voice-card-top">
                        <div className="voice-icon">{voice.type === "clone" ? "◆" : "▪"}</div>
                        <div className="voice-card-copy">
                          <p className="eyebrow">{voice.type}</p>
                          <h4>{voice.name}</h4>
                          <span>
                        {voice.type === "clone"
                              ? `${voice.reference_duration_seconds?.toFixed(1) ?? "?"}s reference`
                              : `Preset · ${voice.gender ?? "Unknown"}`}
                          </span>
                        </div>
                        <button
                          className="micro-button"
                          disabled={!engineReady}
                          title={
                            !engineReady
                              ? "Previews unlock once the local model finishes loading."
                              : "Preview creates a short sample with this voice. The first preview can take a moment on a fresh voice."
                          }
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleVoicePreview(voice.id);
                          }}
                        >
                          {!engineReady ? "Setup" : previewVoiceId === voice.id ? "Playing" : "Preview"}
                        </button>
                      </div>
                      <MiniWaveform color={color} bars={28} />
                      <p className="voice-description">{voice.description ?? "No description yet."}</p>
                      <div className="chip-row">
                        {voice.tags.map((tag) => (
                          <span key={tag} className="chip">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </article>
                  );
                })}
              </div>

              {selectedVoice ? (
                <aside className="voice-detail-panel" style={{ ["--voice-accent" as string]: accentColor(selectedVoice) }}>
                  <div className="voice-detail-head">
                    <div className="voice-detail-mark">{selectedVoice.type === "clone" ? "◆" : "▪"}</div>
                    <div>
                      <p className="eyebrow">Voice detail</p>
                      <h3>{selectedVoice.name}</h3>
                    </div>
                  </div>
                  <p className="muted">{selectedVoice.description ?? "Choose a voice to inspect its metadata and reference profile."}</p>
                  <MiniWaveform color={accentColor(selectedVoice)} bars={36} />
                  <div className="detail-stats">
                    <div>
                      <span>Type</span>
                      <strong>{selectedVoice.type === "clone" ? "Cloned voice" : "Stock preset"}</strong>
                    </div>
                    <div>
                      <span>Gender</span>
                      <strong>{selectedVoice.gender ?? "Unknown"}</strong>
                    </div>
                    <div>
                      <span>Reference</span>
                      <strong>
                        {selectedVoice.reference_duration_seconds ? `${selectedVoice.reference_duration_seconds.toFixed(1)}s` : "Bundled"}
                      </strong>
                    </div>
                    <div>
                      <span>Tags</span>
                      <strong>{selectedVoice.tags.length}</strong>
                    </div>
                  </div>
                  <div className="button-column">
                    <button className="ghost-button" onClick={() => setView("forge")}>
                      Use in forge
                    </button>
                    {selectedVoice.type === "clone" ? (
                      <button className="danger-button" onClick={() => void handleDeleteVoice(selectedVoice.id)}>
                        Delete clone
                      </button>
                    ) : null}
                  </div>
                </aside>
              ) : null}
            </div>

          </section>
        ) : null}

        {view === "history" ? (
          <section className="history-page">
            <div className="section-title">
              <div>
                <p className="eyebrow">Forge history</p>
                <h2>Rendered audio archive</h2>
              </div>
              <div className="button-row">
                <button className="ghost-button" onClick={() => void handleExportSelection("zip")}>
                  Export ZIP
                </button>
                <button className="ghost-button" onClick={() => void handleExportSelection("concatenate")}>
                  Stitch
                </button>
                <button className="danger-button" onClick={() => void handleClearHistory()}>
                  Clear all
                </button>
              </div>
            </div>

            <div className="stats-row">
              <article className="stat-card accent-gold">
                <span>Total audio</span>
                <strong>{formatSeconds(historySummary.totalAudioSeconds)}</strong>
              </article>
              <article className="stat-card accent-copper">
                <span>Generations</span>
                <strong>{history.length}</strong>
              </article>
              <article className="stat-card accent-olive">
                <span>Forge time</span>
                <strong>{formatSeconds(historySummary.totalGenerationSeconds)}</strong>
              </article>
              <article className="stat-card accent-plum">
                <span>Avg RTF</span>
                <strong>{historySummary.avgRtf.toFixed(1)}x</strong>
              </article>
            </div>

            <div className="history-toolbar">
              <input
                className="search-input"
                value={historySearch}
                onChange={(event) => setHistorySearch(event.target.value)}
                placeholder="Search generated text"
              />
              <select value={historyVoiceFilter} onChange={(event) => setHistoryVoiceFilter(event.target.value)}>
                <option value="all">All voices</option>
                {voices.map((voice) => (
                  <option key={voice.id} value={voice.id}>
                    {voice.name}
                  </option>
                ))}
              </select>
              <select value={historySort} onChange={(event) => setHistorySort(event.target.value as HistorySort)}>
                <option value="newest">Newest first</option>
                <option value="longest">Longest first</option>
                <option value="shortest">Shortest first</option>
              </select>
            </div>

            <div className="history-list">
              {filteredHistory.map((entry) => {
                const checked = historySelection.includes(entry.id);
                const voice = voiceMap.get(entry.voice_id);
                const color = accentColor(voice);
                return (
                  <article key={entry.id} className="history-card" style={{ ["--voice-accent" as string]: color }}>
                    <label className="history-check">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) =>
                          setHistorySelection((current) =>
                            event.target.checked ? [...current, entry.id] : current.filter((id) => id !== entry.id),
                          )
                        }
                      />
                    </label>
                    <button className="history-play">{checked ? "■" : "▶"}</button>
                    <div className="history-copy">
                      <p>{entry.text}</p>
                      <MiniWaveform color={color} bars={34} />
                      <div className="history-meta">
                        <span className="voice-tag">
                          <i style={{ ["--voice-accent" as string]: color }} />
                          {entry.voice_name}
                        </span>
                        <span>{entry.quality ?? "balanced"}</span>
                        <span>{formatSeconds(entry.duration_seconds)}</span>
                        <span>{entry.rtf.toFixed(1)}x RTF</span>
                        <span>{entry.format.toUpperCase()}</span>
                        <span>{relativeDate(entry.created_at)}</span>
                      </div>
                    </div>
                    <div className="history-actions">
                      <audio controls src={generationAudioUrls[entry.id]} />
                      <div className="button-row">
                        <button className="ghost-button compact" onClick={() => void handleSaveGeneration(entry)}>
                          Save
                        </button>
                        <button className="danger-button compact" onClick={() => void handleDeleteGeneration(entry.id)}>
                          Delete
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}

              {filteredHistory.length === 0 ? (
                <article className="empty-card">
                  <h3>{history.length === 0 ? "Nothing here yet" : "No forged clips match those filters."}</h3>
                  <p>{history.length === 0
                    ? "Your generated audio will appear here. Head to the Forge to create your first one."
                    : "Try clearing the search or changing the filter."}</p>
                </article>
              ) : null}
            </div>
          </section>
        ) : null}

      </main>

      {cloneOpen ? (
        <form className="modal" onSubmit={(event) => void handleCloneSubmit(event)}>
          <div className="modal-card">
            <div className="section-header">
              <div>
                <p className="eyebrow">Clone voice</p>
                <h2>Clone a voice</h2>
              </div>
              <button type="button" className="icon-button" onClick={() => setCloneOpen(false)}>
                Close
              </button>
            </div>
            <div className="modal-grid">
              <label className="control-field">
                <span>Name</span>
                <input value={cloneName} onChange={(event) => setCloneName(event.target.value)} required />
              </label>
              <label className="control-field">
                <span>Gender</span>
                <select value={cloneGender} onChange={(event) => setCloneGender(event.target.value)}>
                  <option value="F">Female</option>
                  <option value="M">Male</option>
                  <option value="O">Other</option>
                </select>
              </label>
              <label className="control-field control-field-wide">
                <span>Reference audio</span>
                <input
                  type="file"
                  accept=".wav,.mp3,.m4a,.aac"
                  onChange={(event) => setCloneFile(event.target.files?.[0] ?? null)}
                  required
                />
                <p className="field-help">
                  Upload a clean audio clip of the voice you want to clone. For best results, use a recording that's at least 10 seconds long with minimal background noise. WAV, MP3, or M4A.
                </p>
              </label>
              <label className="control-field control-field-wide">
                <span>What's being said in the clip? (optional)</span>
                <textarea
                  value={cloneTranscript}
                  onChange={(event) => setCloneTranscript(event.target.value)}
                  placeholder="Type exactly what's said in the reference audio..."
                />
                <p className="field-help">
                  If you know exactly what's said in the reference audio, type it here. This helps the engine match the voice more accurately. If you leave it blank, the engine will transcribe it automatically.
                </p>
              </label>
              <label className="control-field control-field-wide">
                <span>Tags</span>
                <input value={cloneTags} onChange={(event) => setCloneTags(event.target.value)} />
              </label>
            </div>
            <div className="button-row">
              <button className="primary-button" type="submit">
                Create clone
              </button>
              <button type="button" className="ghost-button" onClick={() => setCloneOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        </form>
      ) : null}

      {showSettingsPanel ? (
        <div className="side-panel-overlay" onClick={() => setShowSettingsPanel(false)}>
          <aside className="side-panel" onClick={(event) => event.stopPropagation()}>
            <div className="section-header">
              <div>
                <p className="eyebrow">Settings</p>
                <h2>Forge configuration</h2>
              </div>
              <button className="icon-button" onClick={() => setShowSettingsPanel(false)}>
                Close
              </button>
            </div>

            <section className="settings-block">
              <p className="eyebrow">Model</p>
              <div className="toggle-group full-width">
                {[
                  { id: "tada-1b", label: "TADA 1B" },
                  { id: "tada-3b", label: "TADA 3B" },
                ].map((model) => (
                  <button
                    key={model.id}
                    className={`toggle-button ${settings.model === model.id ? "active" : ""}`}
                    onClick={() => void handleSaveSettings({ model: model.id as Settings["model"] })}
                  >
                    {model.label}
                  </button>
                ))}
              </div>
              <p className="muted">3B aims higher on quality but carries a much heavier local footprint.</p>
            </section>

            <section className="settings-block">
              <div className="settings-split">
                <span className="eyebrow">CPU threads</span>
                <strong>{settings.cpu_threads}</strong>
              </div>
              <input
                className="thread-slider"
                type="range"
                min={1}
                max={16}
                value={settings.cpu_threads}
                onChange={(event) => setSettings((current) => ({ ...current, cpu_threads: Number(event.target.value) }))}
                onMouseUp={() => void handleSaveSettings({ cpu_threads: settings.cpu_threads })}
                onTouchEnd={() => void handleSaveSettings({ cpu_threads: settings.cpu_threads })}
              />
            </section>

            <section className="settings-grid">
              <label className="control-field">
                <span>Sample rate</span>
                <select
                  value={settings.sample_rate}
                  onChange={(event) => void handleSaveSettings({ sample_rate: Number(event.target.value) as Settings["sample_rate"] })}
                >
                  {[16000, 22050, 24000, 44100, 48000].map((rate) => (
                    <option key={rate} value={rate}>
                      {rate} Hz
                    </option>
                  ))}
                </select>
              </label>
              <label className="control-field">
                <span>Bit depth</span>
                <select
                  value={settings.bit_depth}
                  onChange={(event) => void handleSaveSettings({ bit_depth: Number(event.target.value) as Settings["bit_depth"] })}
                >
                  {[16, 24, 32].map((depth) => (
                    <option key={depth} value={depth}>
                      {depth}-bit
                    </option>
                  ))}
                </select>
              </label>
              <label className="control-field">
                <span>Output format</span>
                <select
                  value={settings.output_format}
                  onChange={(event) => void handleSaveSettings({ output_format: event.target.value as Settings["output_format"] })}
                >
                  {["wav", "mp3", "aac"].map((format) => (
                    <option key={format} value={format}>
                      {format.toUpperCase()}
                    </option>
                  ))}
                </select>
              </label>
              <label className="control-field">
                <span>Warmup on launch</span>
                <select
                  value={String(settings.warmup_on_launch)}
                  onChange={(event) => void handleSaveSettings({ warmup_on_launch: event.target.value === "true" })}
                  title="Launch warmup primes the default preset so your first render starts faster."
                >
                  <option value="true">Enabled</option>
                  <option value="false">Disabled</option>
                </select>
                <p className="field-help">
                  Launch warmup only primes the default starting voice. Switching to a different voice can still make the first render slower.
                </p>
              </label>
            </section>

            <section className="settings-block">
              <p className="eyebrow">Internal storage</p>
              <div className="inline-path">
                <input value={settings.output_directory} readOnly />
              </div>
              <p className="field-help">
                Foundry Vox keeps working renders inside its app data container. Use Save or Export when you want a copy in a user folder.
              </p>
            </section>

            <section className="settings-footer">
              <div>
                <strong>Foundry Vox</strong>
                <p className="muted">Built with Llama and TADA, packaged for a local-first macOS workflow.</p>
              </div>
            </section>
          </aside>
        </div>
      ) : null}

      {showAboutPanel ? (
        <div className="side-panel-overlay" onClick={() => setShowAboutPanel(false)}>
          <aside className="side-panel about-panel" onClick={(event) => event.stopPropagation()}>
            <div className="section-header">
              <div>
                <p className="eyebrow">About</p>
                <h2>Release context</h2>
              </div>
              <button className="icon-button" onClick={() => setShowAboutPanel(false)}>
                Close
              </button>
            </div>
            <article className="about-card">
              <p className="eyebrow">App shape</p>
              <h2>Built as an offline desktop forge</h2>
              <p>
                Foundry Vox ships as a Tauri macOS app with a bundled local backend, SQLite state, and Apple Silicon
                inference. The interface is designed to feel like a dedicated desktop tool instead of a generic control panel.
              </p>
            </article>
            <article className="about-card">
              <p className="eyebrow">Current release notes</p>
              <h2>Submission still needs hardening</h2>
              <ul>
                <li>TADA 1B generation is local and offline once the model is available.</li>
                <li>Licenses ship with the app resources for final packaging.</li>
                <li>Sandboxing and App Store packaging still need the engineering pass we discussed.</li>
              </ul>
            </article>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
