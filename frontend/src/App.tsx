import { ChangeEvent, FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { api } from "./lib/api";
import type { Generation, HealthResponse, ProgressEvent, Settings, Voice } from "./types";

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

function localAudioSrc(path: string) {
  return convertFileSrc(path);
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
  const [styleDirection, setStyleDirection] = useState("");
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
  const scriptImportRef = useRef<HTMLInputElement | null>(null);

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
  const latestGeneration = useMemo(() => history[0] ?? null, [history]);
  const recentGenerations = useMemo(() => history.slice(0, 3), [history]);
  const setupActions = health?.setup_actions ?? [];
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
      setError(requestError instanceof Error ? requestError.message : "Unable to load Foundry Vox.");
    }
  }

  useEffect(() => {
    void refreshAll();
    const interval = window.setInterval(() => {
      void api
        .getHealth()
        .then(setHealth)
        .catch((requestError) => {
          setError(requestError instanceof Error ? requestError.message : "Unable to reach the backend.");
        });
      void refreshHistory().catch(() => {
        // Keep the current history if a background refresh misses once.
      });
    }, 3000);
    return () => {
      window.clearInterval(interval);
      void eventSourceRef.current?.close();
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
    };
  }, []);

  async function handleGenerate() {
    if (!selectedVoice) {
      setError("Select a voice before generating.");
      return;
    }
    if (!text.trim()) {
      setError("Enter some text before generating.");
      return;
    }

    setBusy(true);
    setError("");
    setProgress({ status: "connecting", percent: 1 });

    try {
      await eventSourceRef.current?.close();
      eventSourceRef.current = await api.progressStream((event, type) => {
        if (type === "complete") {
          setProgress({ status: "complete", percent: 100, generation_id: event.generation_id });
        } else if (type === "error") {
          setError(event.message ?? "Generation failed.");
        } else {
          setProgress(event);
        }
      });
    } catch {
      setProgress({ status: "starting", percent: 2 });
    }

    try {
      const response = await api.generate({
        text,
        voice_id: selectedVoice.id,
        system_prompt: styleDirection || null,
        format: settings.output_format,
        sample_rate: settings.sample_rate,
      });
      setHistory((current) => {
        const withoutDuplicate = current.filter((entry) => entry.id !== response.generation.id);
        return [response.generation, ...withoutDuplicate];
      });
      setView("forge");
      setProgress({ status: "complete", percent: 100, generation_id: response.generation.id });
      await eventSourceRef.current?.close();
      void refreshHistory()
        .catch(() => {
          // Keep the optimistic state if the background refresh fails.
        });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Generation failed.");
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
      setCloneQuality(
        `${response.quality.quality_rating.toUpperCase()} · ${response.quality.duration_seconds.toFixed(1)}s · SNR ${response.quality.snr_estimate_db}dB`,
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
      setError(requestError instanceof Error ? requestError.message : "Voice cloning failed.");
    }
  }

  async function handleDeleteVoice(voiceId: string) {
    await api.deleteVoice(voiceId);
    setVoices((current) => current.filter((voice) => voice.id !== voiceId));
    setSelectedVoiceId((current) => (current === voiceId ? "" : current));
  }

  async function handleDeleteGeneration(generationId: string) {
    await api.deleteHistoryItem(generationId);
    setHistory((current) => current.filter((entry) => entry.id !== generationId));
    setHistorySelection((current) => current.filter((id) => id !== generationId));
  }

  async function handleClearHistory() {
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
      <header className="window-chrome">
        <div className="chrome-left">
          <div className="traffic-lights" aria-hidden="true">
            <span className="traffic close" />
            <span className="traffic minimize" />
            <span className="traffic zoom" />
          </div>
          <div className="brand-lockup">
            <div className="brand-mark">F</div>
            <div>
              <p className="eyebrow">Local Voice Forge</p>
              <h1>Foundry Vox</h1>
            </div>
          </div>
        </div>

        <nav className="chrome-tabs">
          {TOP_LEVEL_VIEWS.map((item) => (
            <button
              key={item.id}
              className={`chrome-tab ${view === item.id ? "active" : ""}`}
              onClick={() => setView(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>

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
          <section className="error-banner">
            <strong>{health?.error ?? "Action needed"}</strong>
            <p>{error}</p>
          </section>
        ) : null}

        {health && health.status !== "ready" ? (
          <section className={`setup-card ${health.status}`}>
            <div className="setup-copy">
              <p className="eyebrow">Engine setup</p>
              <h2>{health.setup_title ?? (health.status === "warming_up" ? "Warming up the model" : "Preparing the voice engine")}</h2>
              <p>
                {health.setup_detail ??
                  health.message ??
                  "Foundry Vox is still preparing its local runtime before generation becomes available."}
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
            <div className="setup-checklist">
              {setupChecklist.map((item) => (
                <div key={item.label} className={`setup-check ${item.done ? "done" : ""}`}>
                  <span>{item.done ? "✓" : "·"}</span>
                  <span>{item.label}</span>
                </div>
              ))}
            </div>
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
                <span className="eyebrow">Selected</span>
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
                    <p className="eyebrow">Script</p>
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
                  placeholder="Type or paste your script here..."
                />

                <div className="script-footer">
                  <span>{wordCount} words · {charCount} chars</span>
                  <span>~{estimatedDuration}s audio · ~{estimatedForgeTime}s forge time</span>
                </div>
              </article>

              <article className={`forge-wave-card ${busy ? "active" : ""}`} style={{ ["--voice-accent" as string]: accentColor(selectedVoice) }}>
                <EmberParticles active={busy} />
                <div className="section-header">
                  <div>
                    <p className="eyebrow">Forge</p>
                    <h2>{busy ? "Heating the metal" : "Ready for output"}</h2>
                  </div>
                  <div className="forge-wave-meta">
                    <span>{selectedVoice?.name ?? "No voice"}</span>
                    <span>{settings.output_format.toUpperCase()} · {settings.sample_rate / 1000}kHz</span>
                  </div>
                </div>

                <WaveformBars active={busy || Boolean(latestGeneration)} color={accentColor(selectedVoice)} />

                {progress ? (
                  <div className="progress-block">
                    <div className="progress-meta">
                      <span>{progress.status}</span>
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
                      ? "The forge is primed. Generate locally with your selected voice and output format."
                      : "The model is still warming up. Once ready, the first render will appear here."}
                  </p>
                )}
              </article>
            </section>

            <aside className="forge-sidebar">
              <article className="control-card">
                <div className="section-header">
                  <div>
                    <p className="eyebrow">Direction</p>
                    <h3>Performance settings</h3>
                  </div>
                </div>

                <label className="control-field">
                  <span>Voice</span>
                  <select value={selectedVoice?.id ?? ""} onChange={(event) => setSelectedVoiceId(event.target.value)}>
                    {voices.map((voice) => (
                      <option key={voice.id} value={voice.id}>
                        {voice.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="control-field">
                  <span>Output format</span>
                  <select
                    value={settings.output_format}
                    onChange={(event) => {
                      void handleSaveSettings({ output_format: event.target.value as Settings["output_format"] });
                    }}
                  >
                    <option value="wav">WAV</option>
                    <option value="mp3">MP3</option>
                    <option value="aac">AAC</option>
                  </select>
                </label>

                <label className="control-field">
                  <span>Style direction</span>
                  <input
                    value={styleDirection}
                    onChange={(event) => setStyleDirection(event.target.value)}
                    placeholder="Warm, intimate, with calm pacing"
                  />
                </label>

                <div className="button-row">
                  <button className="primary-button" onClick={() => void handleGenerate()} disabled={!canGenerate}>
                    {busy ? "Forging..." : engineReady ? "Forge voice  cmd+enter" : engineWarming ? "Preparing engine..." : "Generation unavailable"}
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

              <article className="latest-render-card" style={{ ["--voice-accent" as string]: accentColor(selectedVoice) }}>
                <div className="section-header">
                  <div>
                    <p className="eyebrow">Latest render</p>
                    <h3>{latestGeneration ? latestGeneration.voice_name : "Nothing forged yet"}</h3>
                  </div>
                  {latestGeneration ? <span className="quality-badge">{formatSeconds(latestGeneration.duration_seconds)}</span> : null}
                </div>

                {latestGeneration ? (
                  <>
                    <MiniWaveform color={accentColor(voiceMap.get(latestGeneration.voice_id))} bars={30} />
                    <audio
                      className="audio-player"
                      controls
                      src={localAudioSrc(latestGeneration.output_path)}
                    />
                    <div className="metrics-grid">
                      <div>
                        <span>RTF</span>
                        <strong>{latestGeneration.rtf.toFixed(1)}x</strong>
                      </div>
                      <div>
                        <span>Forge time</span>
                        <strong>{formatSeconds(latestGeneration.generation_time_seconds)}</strong>
                      </div>
                      <div>
                        <span>Format</span>
                        <strong>{latestGeneration.format.toUpperCase()}</strong>
                      </div>
                      <div>
                        <span>Created</span>
                        <strong>{relativeDate(latestGeneration.created_at)}</strong>
                      </div>
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
                    <h3>Latest sessions</h3>
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
                <p className="eyebrow">Voice Library</p>
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
                <p className="eyebrow">Forge History</p>
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
                        <span>{formatSeconds(entry.duration_seconds)}</span>
                        <span>{entry.rtf.toFixed(1)}x RTF</span>
                        <span>{entry.format.toUpperCase()}</span>
                        <span>{relativeDate(entry.created_at)}</span>
                      </div>
                    </div>
                    <div className="history-actions">
                      <audio controls src={localAudioSrc(entry.output_path)} />
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
                  <h3>No forged clips match those filters.</h3>
                  <p>Try clearing the search or render a fresh sample from the Forge tab.</p>
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
                <h2>Reference upload</h2>
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
                  Provide clean speech audio and the exact transcript for what is spoken in that clip.
                </p>
              </label>
              <label className="control-field control-field-wide">
                <span>Transcript of the reference audio</span>
                <textarea
                  value={cloneTranscript}
                  onChange={(event) => setCloneTranscript(event.target.value)}
                  placeholder="Paste the exact words spoken in the uploaded audio."
                  required
                />
                <p className="field-help">
                  The transcript should closely match the uploaded audio. Auto-transcription is currently disabled.
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
                >
                  <option value="true">Enabled</option>
                  <option value="false">Disabled</option>
                </select>
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
