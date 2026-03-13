import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api } from "./lib/api";
import type { Generation, HealthResponse, ProgressEvent, Settings, Voice } from "./types";

type View = "forge" | "library" | "history" | "settings" | "about";

const NAV_ITEMS: Array<{ id: View; label: string; hint: string }> = [
  { id: "forge", label: "Forge", hint: "Generate audio" },
  { id: "library", label: "Library", hint: "Voices and cloning" },
  { id: "history", label: "History", hint: "Recent renders" },
  { id: "settings", label: "Settings", hint: "Performance and output" },
  { id: "about", label: "About", hint: "Shipping and legal" },
];

const DEFAULT_SETTINGS: Settings = {
  model: "tada-1b",
  cpu_threads: 6,
  output_format: "wav",
  sample_rate: 24000,
  bit_depth: 16,
  output_directory: "~/Documents/FoundryVox/output",
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

export default function App() {
  const [view, setView] = useState<View>("forge");
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>("");
  const [history, setHistory] = useState<Generation[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [text, setText] = useState("The forge burns brightest at midnight. Every voice begins as raw metal, waiting for its final shape.");
  const [styleDirection, setStyleDirection] = useState("");
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [latestGeneration, setLatestGeneration] = useState<Generation | null>(null);
  const [error, setError] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneName, setCloneName] = useState("");
  const [cloneTranscript, setCloneTranscript] = useState("");
  const [cloneGender, setCloneGender] = useState("O");
  const [cloneTags, setCloneTags] = useState("personal, clone");
  const [cloneFile, setCloneFile] = useState<File | null>(null);
  const [cloneQuality, setCloneQuality] = useState<string>("");
  const [historySearch, setHistorySearch] = useState("");
  const [historySelection, setHistorySelection] = useState<string[]>([]);
  const eventSourceRef = useRef<EventSource | null>(null);

  const selectedVoice = useMemo(
    () => voices.find((voice) => voice.id === selectedVoiceId) ?? voices[0] ?? null,
    [selectedVoiceId, voices],
  );

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
    }, 3000);
    return () => {
      window.clearInterval(interval);
      eventSourceRef.current?.close();
    };
  }, []);

  async function handleGenerate() {
    if (!selectedVoice) return;
    setBusy(true);
    setError("");
    setProgress({ status: "connecting", percent: 1 });
    eventSourceRef.current?.close();
    eventSourceRef.current = api.progressStream((event, type) => {
      if (type === "complete") {
        setProgress({ status: "complete", percent: 100, generation_id: event.generation_id });
      } else if (type === "error") {
        setError(event.message ?? "Generation failed.");
      } else {
        setProgress(event);
      }
    });

    try {
      const response = await api.generate({
        text,
        voice_id: selectedVoice.id,
        system_prompt: styleDirection || null,
        format: settings.output_format,
        sample_rate: settings.sample_rate,
      });
      setLatestGeneration(response.generation);
      setHistory((current) => [response.generation, ...current]);
      setView("forge");
      setProgress({ status: "complete", percent: 100, generation_id: response.generation.id });
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

  async function handlePickDirectory() {
    const selected = await open({ directory: true, multiple: false, title: "Choose output directory" });
    if (typeof selected === "string" && selected.length > 0) {
      const updated = await api.patchSettings({ output_directory: selected });
      setSettings(updated);
    }
  }

  async function handleSaveSettings(patch: Partial<Settings>) {
    const updated = await api.patchSettings(patch);
    setSettings(updated);
  }

  async function handleExportSelection(mode: "zip" | "concatenate") {
    if (historySelection.length === 0) return;
    const blob = await api.exportBatch({
      generation_ids: historySelection,
      mode,
      format: settings.output_format,
    });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  const filteredHistory = history.filter((entry) =>
    historySearch ? entry.text.toLowerCase().includes(historySearch.toLowerCase()) : true,
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">FV</div>
          <div>
            <p className="eyebrow">Local Voice Forge</p>
            <h1>Foundry Vox</h1>
          </div>
        </div>
        <nav className="nav-stack">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${view === item.id ? "active" : ""}`}
              onClick={() => setView(item.id)}
            >
              <span>{item.label}</span>
              <small>{item.hint}</small>
            </button>
          ))}
        </nav>
        <div className="sidebar-panel">
          <p className="eyebrow">Engine</p>
          <div className={`status-pill ${health?.status ?? "loading"}`}>{health?.status ?? "loading"}</div>
          <p className="muted">
            {health?.status === "error"
              ? health.message
              : health?.status === "warming_up"
                ? "Priming caches so first real render is faster."
                : "Runs locally on Apple Silicon with CPU float32 inference."}
          </p>
        </div>
      </aside>

      <main className="main-shell">
        <header className="topbar">
          <div>
            <p className="eyebrow">Backend</p>
            <h2>{health?.model_loaded ? "Ready to forge" : "Starting model engine"}</h2>
          </div>
          <div className="topbar-actions">
            {cloneQuality ? <span className="quality-badge">{cloneQuality}</span> : null}
            {selectedVoice ? (
              <button className="ghost-button" onClick={() => setView("library")}>
                {selectedVoice.name}
              </button>
            ) : null}
          </div>
        </header>

        {error ? (
          <section className="error-banner">
            <strong>{health?.error ?? "Action needed"}</strong>
            <p>{error}</p>
          </section>
        ) : null}

        {view === "forge" ? (
          <section className="forge-layout">
            <div className="forge-panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Compose</p>
                  <h3>Text to speech</h3>
                </div>
                <div className="stats-inline">
                  <span>{text.length} chars</span>
                  <span>{text.trim().split(/\s+/).filter(Boolean).length} words</span>
                </div>
              </div>

              <textarea
                className="forge-textarea"
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="Paste narration, script copy, or chapter text."
              />

              <div className="field-grid">
                <label className="field-card">
                  <span>Voice</span>
                  <select value={selectedVoice?.id ?? ""} onChange={(event) => setSelectedVoiceId(event.target.value)}>
                    {voices.map((voice) => (
                      <option key={voice.id} value={voice.id}>
                        {voice.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field-card">
                  <span>Output</span>
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
              </div>

              <label className="field-card field-card-wide">
                <span>Style direction</span>
                <input
                  value={styleDirection}
                  onChange={(event) => setStyleDirection(event.target.value)}
                  placeholder="Speak with warmth and excitement"
                />
              </label>

              <div className="action-row">
                <button
                  className="primary-button"
                  onClick={() => void handleGenerate()}
                  disabled={busy || !selectedVoice || !health || health.status !== "ready"}
                >
                  {busy ? "Forging..." : "Generate Audio"}
                </button>
                <button className="ghost-button" onClick={() => setText("")}>
                  Clear
                </button>
              </div>

              {progress ? (
                <div className="progress-card">
                  <div className="progress-header">
                    <span>{progress.status}</span>
                    <strong>{Math.round(progress.percent)}%</strong>
                  </div>
                  <div className="progress-track">
                    <div className="progress-fill" style={{ width: `${progress.percent}%` }} />
                  </div>
                  {progress.tokens_total ? (
                    <p className="muted">
                      {progress.tokens_generated ?? 0} / {progress.tokens_total} tokens
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="hero-panel">
              <div className="voice-hero" style={{ ["--voice-accent" as string]: selectedVoice?.color ?? "#E8A849" }}>
                <p className="eyebrow">Selected voice</p>
                <h3>{selectedVoice?.name ?? "No voice selected"}</h3>
                <p>{selectedVoice?.description ?? "Choose a preset or clone a new reference voice."}</p>
                <div className="chip-row">
                  {(selectedVoice?.tags ?? []).map((tag) => (
                    <span key={tag} className="chip">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>

              <div className="latest-card">
                <div className="panel-header">
                  <div>
                    <p className="eyebrow">Latest render</p>
                    <h3>{latestGeneration ? latestGeneration.voice_name : "Nothing forged yet"}</h3>
                  </div>
                  {latestGeneration ? <span className="quality-badge">{formatSeconds(latestGeneration.duration_seconds)}</span> : null}
                </div>
                {latestGeneration ? (
                  <>
                    <audio
                      className="audio-player"
                      controls
                      src={`${api.baseUrl}/generate/${latestGeneration.id}/audio`}
                    />
                    <div className="metrics-grid">
                      <div>
                        <span>RTF</span>
                        <strong>{latestGeneration.rtf.toFixed(1)}x</strong>
                      </div>
                      <div>
                        <span>Wall clock</span>
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
                  <p className="muted">
                    Your next generation will appear here with inline playback and download-ready output.
                  </p>
                )}
              </div>
            </div>
          </section>
        ) : null}

        {view === "library" ? (
          <section className="library-layout">
            <div className="section-title">
              <div>
                <p className="eyebrow">Voices</p>
                <h3>Preset and cloned references</h3>
              </div>
              <button className="primary-button" onClick={() => setCloneOpen(true)}>
                Clone New Voice
              </button>
            </div>

            <div className="voice-grid">
              {voices.map((voice) => (
                <article
                  key={voice.id}
                  className={`voice-card ${selectedVoiceId === voice.id ? "selected" : ""}`}
                  style={{ ["--voice-accent" as string]: voice.color ?? "#E8A849" }}
                  onClick={() => setSelectedVoiceId(voice.id)}
                >
                  <div className="voice-card-top">
                    <div>
                      <p className="eyebrow">{voice.type}</p>
                      <h4>{voice.name}</h4>
                    </div>
                    <button
                      className="ghost-button compact"
                      onClick={(event) => {
                        event.stopPropagation();
                        const preview = new Audio(`${api.baseUrl}/voices/${voice.id}/preview`);
                        void preview.play();
                      }}
                    >
                      Preview
                    </button>
                  </div>
                  <p>{voice.description}</p>
                  <div className="chip-row">
                    {voice.tags.map((tag) => (
                      <span key={tag} className="chip">
                        {tag}
                      </span>
                    ))}
                  </div>
                  <footer className="voice-card-footer">
                    <span>{voice.reference_duration_seconds ? `${voice.reference_duration_seconds.toFixed(1)}s ref` : "Bundled preset"}</span>
                    {voice.type === "clone" ? (
                      <button
                        className="danger-button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleDeleteVoice(voice.id);
                        }}
                      >
                        Delete
                      </button>
                    ) : null}
                  </footer>
                </article>
              ))}
            </div>

            {cloneOpen ? (
              <form className="modal" onSubmit={(event) => void handleCloneSubmit(event)}>
                <div className="modal-card">
                  <div className="panel-header">
                    <div>
                      <p className="eyebrow">Clone voice</p>
                      <h3>Reference upload</h3>
                    </div>
                    <button type="button" className="ghost-button compact" onClick={() => setCloneOpen(false)}>
                      Close
                    </button>
                  </div>
                  <div className="field-grid">
                    <label className="field-card">
                      <span>Name</span>
                      <input value={cloneName} onChange={(event) => setCloneName(event.target.value)} required />
                    </label>
                    <label className="field-card">
                      <span>Gender</span>
                      <select value={cloneGender} onChange={(event) => setCloneGender(event.target.value)}>
                        <option value="F">Female</option>
                        <option value="M">Male</option>
                        <option value="O">Other</option>
                      </select>
                    </label>
                  </div>
                  <label className="field-card field-card-wide">
                    <span>Reference audio</span>
                    <input
                      type="file"
                      accept=".wav,.mp3,.m4a,.aac"
                      onChange={(event) => setCloneFile(event.target.files?.[0] ?? null)}
                      required
                    />
                  </label>
                  <label className="field-card field-card-wide">
                    <span>Manual transcript</span>
                    <textarea
                      value={cloneTranscript}
                      onChange={(event) => setCloneTranscript(event.target.value)}
                      placeholder="Leave blank to let TADA transcribe the reference."
                    />
                  </label>
                  <label className="field-card field-card-wide">
                    <span>Tags</span>
                    <input value={cloneTags} onChange={(event) => setCloneTags(event.target.value)} />
                  </label>
                  <div className="action-row">
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
          </section>
        ) : null}

        {view === "history" ? (
          <section className="history-layout">
            <div className="section-title">
              <div>
                <p className="eyebrow">History</p>
                <h3>Rendered audio archive</h3>
              </div>
              <div className="action-row">
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

            <div className="history-toolbar">
              <input
                className="search-input"
                value={historySearch}
                onChange={(event) => setHistorySearch(event.target.value)}
                placeholder="Search generated text"
              />
              <p className="muted">{filteredHistory.length} entries</p>
            </div>

            <div className="history-list">
              {filteredHistory.map((entry) => {
                const checked = historySelection.includes(entry.id);
                return (
                  <article key={entry.id} className="history-card">
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
                    <div className="history-copy">
                      <h4>{entry.voice_name}</h4>
                      <p>{entry.text}</p>
                      <div className="history-meta">
                        <span>{formatSeconds(entry.duration_seconds)}</span>
                        <span>{entry.rtf.toFixed(1)}x RTF</span>
                        <span>{entry.format.toUpperCase()}</span>
                        <span>{relativeDate(entry.created_at)}</span>
                      </div>
                    </div>
                    <div className="history-actions">
                      <audio controls src={`${api.baseUrl}/generate/${entry.id}/audio`} />
                      <div className="action-row">
                        <a className="ghost-button compact" href={`${api.baseUrl}/generate/${entry.id}/download`}>
                          Download
                        </a>
                        <button className="danger-button compact" onClick={() => void handleDeleteGeneration(entry.id)}>
                          Delete
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}

        {view === "settings" ? (
          <section className="settings-layout">
            <div className="section-title">
              <div>
                <p className="eyebrow">Settings</p>
                <h3>Performance, output, storage</h3>
              </div>
            </div>
            <div className="settings-grid">
              <label className="field-card">
                <span>CPU threads</span>
                <input
                  type="number"
                  min={1}
                  max={16}
                  value={settings.cpu_threads}
                  onChange={(event) => setSettings((current) => ({ ...current, cpu_threads: Number(event.target.value) }))}
                  onBlur={() => void handleSaveSettings({ cpu_threads: settings.cpu_threads })}
                />
              </label>
              <label className="field-card">
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
              <label className="field-card">
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
              <label className="field-card">
                <span>Warmup on launch</span>
                <select
                  value={String(settings.warmup_on_launch)}
                  onChange={(event) => void handleSaveSettings({ warmup_on_launch: event.target.value === "true" })}
                >
                  <option value="true">Enabled</option>
                  <option value="false">Disabled</option>
                </select>
              </label>
            </div>
            <div className="field-card field-card-wide">
              <span>Output directory</span>
              <div className="inline-path">
                <input
                  value={settings.output_directory}
                  onChange={(event) => setSettings((current) => ({ ...current, output_directory: event.target.value }))}
                  onBlur={() => void handleSaveSettings({ output_directory: settings.output_directory })}
                />
                <button className="ghost-button" onClick={() => void handlePickDirectory()}>
                  Choose
                </button>
              </div>
            </div>
          </section>
        ) : null}

        {view === "about" ? (
          <section className="about-layout">
            <article className="about-card">
              <p className="eyebrow">App Store readiness</p>
              <h3>Built for an offline macOS bundle</h3>
              <p>
                Foundry Vox ships as a Tauri desktop shell with a bundled FastAPI sidecar, local SQLite state, and
                Apple Silicon CPU inference. The release flow builds a native app plus a packaged backend executable for
                distribution.
              </p>
            </article>
            <article className="about-card">
              <p className="eyebrow">Required notices</p>
              <h3>Licensing</h3>
              <ul>
                <li>Built with Llama</li>
                <li>TADA MIT license bundled in the app resources</li>
                <li>Llama 3.2 Community License bundled in the app resources</li>
              </ul>
            </article>
          </section>
        ) : null}
      </main>
    </div>
  );
}

