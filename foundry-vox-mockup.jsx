import { useState, useEffect } from "react";

const VOICES = [
  { id: 1, name: "Warm Narrator", type: "preset", gender: "M", color: "#E8A849", desc: "Rich, warm male baritone. Great for audiobooks and storytelling.", duration: null, tags: ["narration", "audiobook", "warm"] },
  { id: 2, name: "Bright Host", type: "preset", gender: "F", color: "#D4735E", desc: "Energetic female voice with clear diction. Ideal for podcasts and explainers.", duration: null, tags: ["podcast", "energetic", "clear"] },
  { id: 3, name: "Deep Anchor", type: "preset", gender: "M", color: "#7B8F6A", desc: "Authoritative deep male voice. Perfect for documentaries and trailers.", duration: null, tags: ["documentary", "deep", "authority"] },
  { id: 4, name: "Gentle Reader", type: "preset", gender: "F", color: "#9B8EC4", desc: "Soft, calming female voice. Suited for meditation, children's content.", duration: null, tags: ["calm", "soft", "children"] },
  { id: 5, name: "Crisp Lecturer", type: "preset", gender: "M", color: "#6BA3B7", desc: "Precise, measured delivery. Technical tutorials and presentations.", duration: null, tags: ["technical", "precise", "tutorial"] },
  { id: 6, name: "Velvet Evening", type: "preset", gender: "F", color: "#B07DA0", desc: "Smooth, intimate tone with a slight rasp. Late-night radio feel.", duration: null, tags: ["intimate", "smooth", "radio"] },
  { id: 7, name: "My Clone", type: "clone", gender: "M", color: "#C9965A", desc: "Cloned from 9.2s reference audio.", duration: "9.2s", tags: ["personal", "clone"] },
  { id: 8, name: "Studio Voice", type: "clone", gender: "F", color: "#D4A76A", desc: "Cloned from 14.8s reference audio.", duration: "14.8s", tags: ["personal", "clone"] },
];

const FULL_HISTORY = [
  { id: 1, text: "The old lighthouse keeper watched the storm roll in from the east, his weathered hands gripping the railing as waves crashed against the rocks below.", voice: "Warm Narrator", voiceColor: "#E8A849", duration: "24.3s", genTime: "85.1s", rtf: "3.5x", time: "11:42 PM", date: "Mar 12", format: "WAV 24kHz", chars: 142 },
  { id: 2, text: "Chapter Seven: The Discovery. Margaret pushed open the heavy oak door and stepped into the chamber that had been sealed for three hundred years.", voice: "My Clone", voiceColor: "#C9965A", duration: "18.1s", genTime: "57.9s", rtf: "3.2x", time: "11:38 PM", date: "Mar 12", format: "WAV 24kHz", chars: 138 },
  { id: 3, text: "Welcome back to another episode of the podcast where we break down the most fascinating stories in science and technology.", voice: "Bright Host", voiceColor: "#D4735E", duration: "31.7s", genTime: "120.5s", rtf: "3.8x", time: "11:21 PM", date: "Mar 12", format: "WAV 24kHz", chars: 118 },
  { id: 4, text: "In this tutorial, we'll walk through setting up your development environment from scratch. First, install the required dependencies.", voice: "Crisp Lecturer", voiceColor: "#6BA3B7", duration: "22.6s", genTime: "72.3s", rtf: "3.2x", time: "10:55 PM", date: "Mar 12", format: "MP3 48kHz", chars: 148 },
  { id: 5, text: "Close your eyes. Breathe deeply. Feel the weight of the day dissolving, carried away like leaves on a slow river.", voice: "Gentle Reader", voiceColor: "#9B8EC4", duration: "19.4s", genTime: "67.9s", rtf: "3.5x", time: "10:31 PM", date: "Mar 12", format: "WAV 24kHz", chars: 112 },
  { id: 6, text: "The forge burns brightest at midnight. Every voice begins as raw metal — shapeless, waiting.", voice: "Warm Narrator", voiceColor: "#E8A849", duration: "12.1s", genTime: "41.1s", rtf: "3.4x", time: "9:47 PM", date: "Mar 12", format: "WAV 24kHz", chars: 89 },
  { id: 7, text: "Breaking news tonight: the city council has approved the controversial downtown development plan after six months of heated debate.", voice: "Deep Anchor", voiceColor: "#7B8F6A", duration: "26.8s", genTime: "93.8s", rtf: "3.5x", time: "9:12 PM", date: "Mar 11", format: "WAV 24kHz", chars: 136 },
  { id: 8, text: "And that's the thing about building something from nothing — you never quite believe it's real until someone else sees it too.", voice: "Velvet Evening", voiceColor: "#B07DA0", duration: "16.3s", genTime: "52.2s", rtf: "3.2x", time: "8:45 PM", date: "Mar 11", format: "AAC 48kHz", chars: 117 },
];

/* ── Waveform Bars ── */
function WaveformBars({ active, barCount = 48, color = "#E8A849" }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2, height: 110, padding: "0 16px" }}>
      {Array.from({ length: barCount }).map((_, i) => {
        const h = Math.sin(i * 0.3) * 28 + Math.cos(i * 0.7) * 20 + 42;
        return <div key={i} style={{ width: 3, borderRadius: 2, backgroundColor: active ? color : "#3A3530", height: active ? h : 4, opacity: active ? 0.6 + Math.sin(i * 0.5) * 0.4 : 0.4, transition: `height ${0.3 + Math.random() * 0.3}s ease`, animation: active ? `pulse ${1 + Math.random() * 1.5}s ease-in-out infinite alternate` : "none", animationDelay: `${i * 0.03}s` }} />;
      })}
    </div>
  );
}

function MiniWaveform({ color = "#E8A849", bars = 20, height = 24 }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 1.5, height }}>
      {Array.from({ length: bars }).map((_, i) => {
        const h2 = Math.sin(i * 0.6) * (height * 0.35) + Math.cos(i * 1.1) * (height * 0.2) + height * 0.4;
        return <div key={i} style={{ width: 2, borderRadius: 1, backgroundColor: color, height: h2, opacity: 0.5 + Math.sin(i * 0.4) * 0.3 }} />;
      })}
    </div>
  );
}

function EmberParticles({ active }) {
  if (!active) return null;
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} style={{ position: "absolute", width: 3, height: 3, borderRadius: "50%", backgroundColor: "#E8A849", left: `${10 + Math.random() * 80}%`, bottom: 0, opacity: 0, animation: `ember ${2 + Math.random() * 3}s ease-out infinite`, animationDelay: `${Math.random() * 2}s` }} />
      ))}
    </div>
  );
}

function VoiceCard({ voice, selected, onClick }) {
  return (
    <button onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 10, border: selected ? `1.5px solid ${voice.color}` : "1.5px solid transparent", backgroundColor: selected ? `${voice.color}15` : "#1E1B18", cursor: "pointer", width: "100%", textAlign: "left", transition: "all 0.2s ease" }}>
      <div style={{ width: 36, height: 36, borderRadius: 8, backgroundColor: `${voice.color}25`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, color: voice.color, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", flexShrink: 0 }}>
        {voice.type === "clone" ? "◆" : "▪"}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: selected ? "#F0E6D6" : "#A89B8C", fontFamily: "'DM Sans', sans-serif", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{voice.name}</div>
        <div style={{ fontSize: 10, color: "#6B5F52", fontFamily: "'JetBrains Mono', monospace", marginTop: 2 }}>{voice.type === "clone" ? "CLONED" : "PRESET"} · {voice.gender}</div>
      </div>
      {selected && <div style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: voice.color, flexShrink: 0 }} />}
    </button>
  );
}

const mono = "'JetBrains Mono', monospace";
const sans = "'DM Sans', sans-serif";
const serif = "'Playfair Display', serif";

/* ════════════════════════════════════════════
   LIBRARY VIEW
   ════════════════════════════════════════════ */
function LibraryView({ voices, onClone }) {
  const [filter, setFilter] = useState("all");
  const [selectedVoice, setSelectedVoice] = useState(null);
  const [playingId, setPlayingId] = useState(null);
  const [viewMode, setViewMode] = useState("grid");

  const filtered = voices.filter((v) => filter === "all" ? true : v.type === filter);
  const detail = selectedVoice ? voices.find((v) => v.id === selectedVoice) : null;

  return (
    <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
      <div style={{ flex: 1, padding: 24, overflowY: "auto" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <div>
            <h2 style={{ fontSize: 22, fontWeight: 600, fontFamily: serif, color: "#F0E6D6", marginBottom: 4 }}>Voice Library</h2>
            <p style={{ fontSize: 12, color: "#6B5F52" }}>{voices.length} voices · {voices.filter((v) => v.type === "clone").length} clones</p>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <div style={{ display: "flex", border: "1px solid #2A2520", borderRadius: 6, overflow: "hidden", marginRight: 6 }}>
              {["grid", "list"].map((m) => (
                <button key={m} onClick={() => setViewMode(m)} style={{ padding: "5px 10px", border: "none", backgroundColor: viewMode === m ? "#2A2520" : "transparent", color: viewMode === m ? "#F0E6D6" : "#4A3F35", fontSize: 12, cursor: "pointer", transition: "all 0.2s" }}>
                  {m === "grid" ? "▦" : "≡"}
                </button>
              ))}
            </div>
            {["all", "preset", "clone"].map((f) => (
              <button key={f} onClick={() => setFilter(f)} style={{ padding: "5px 12px", borderRadius: 6, border: "none", backgroundColor: filter === f ? "#2A2520" : "transparent", color: filter === f ? "#F0E6D6" : "#6B5F52", fontSize: 11, cursor: "pointer", fontFamily: mono, textTransform: "uppercase", transition: "all 0.2s" }}>
                {f}
              </button>
            ))}
            <button onClick={onClone} style={{ marginLeft: 8, padding: "6px 14px", borderRadius: 7, border: "none", background: "linear-gradient(135deg, #E8A849, #C9783A)", color: "#141210", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: mono }}>+ CLONE NEW</button>
          </div>
        </div>

        {/* Voice Grid */}
        {viewMode === "grid" ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
          {filtered.map((v) => (
            <div key={v.id} onClick={() => setSelectedVoice(v.id === selectedVoice ? null : v.id)}
              style={{ padding: 16, borderRadius: 12, backgroundColor: selectedVoice === v.id ? "#221F1A" : "#1A1815", border: selectedVoice === v.id ? `1px solid ${v.color}40` : "1px solid #2A2520", cursor: "pointer", transition: "all 0.2s" }}
              onMouseEnter={(e) => { if (selectedVoice !== v.id) e.currentTarget.style.borderColor = "#3A3530"; }}
              onMouseLeave={(e) => { if (selectedVoice !== v.id) e.currentTarget.style.borderColor = "#2A2520"; }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                <div style={{ width: 44, height: 44, borderRadius: 10, backgroundColor: `${v.color}20`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <span style={{ fontSize: 18, color: v.color }}>{v.type === "clone" ? "◆" : "▪"}</span>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#F0E6D6", marginBottom: 2 }}>{v.name}</div>
                  <div style={{ fontSize: 10, color: "#6B5F52", fontFamily: mono }}>{v.type === "clone" ? `CLONE · ${v.duration} ref` : `PRESET · ${v.gender}`}</div>
                </div>
                <button onClick={(e) => { e.stopPropagation(); setPlayingId(playingId === v.id ? null : v.id); }}
                  style={{ width: 30, height: 30, borderRadius: 7, border: "none", backgroundColor: playingId === v.id ? v.color : `${v.color}25`, color: playingId === v.id ? "#141210" : v.color, fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, transition: "all 0.2s", flexShrink: 0 }}>
                  {playingId === v.id ? "■" : "▶"}
                </button>
              </div>
              <MiniWaveform color={v.color} bars={28} height={20} />
              <div style={{ display: "flex", gap: 4, marginTop: 10, flexWrap: "wrap" }}>
                {v.tags.map((tag) => (
                  <span key={tag} style={{ fontSize: 9, color: "#6B5F52", backgroundColor: "#2A2520", padding: "2px 7px", borderRadius: 4, fontFamily: mono }}>{tag}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
        ) : (
        /* List View */
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {filtered.map((v) => (
            <div key={v.id} onClick={() => setSelectedVoice(v.id === selectedVoice ? null : v.id)}
              style={{ padding: "12px 16px", borderRadius: 10, backgroundColor: selectedVoice === v.id ? "#221F1A" : "#1A1815", border: selectedVoice === v.id ? `1px solid ${v.color}40` : "1px solid #2A2520", cursor: "pointer", display: "flex", alignItems: "center", gap: 14, transition: "all 0.2s" }}
              onMouseEnter={(e) => { if (selectedVoice !== v.id) e.currentTarget.style.borderColor = "#3A3530"; }}
              onMouseLeave={(e) => { if (selectedVoice !== v.id) e.currentTarget.style.borderColor = "#2A2520"; }}>
              <div style={{ width: 38, height: 38, borderRadius: 9, backgroundColor: `${v.color}20`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <span style={{ fontSize: 16, color: v.color }}>{v.type === "clone" ? "◆" : "▪"}</span>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#F0E6D6" }}>{v.name}</div>
                <div style={{ fontSize: 10, color: "#6B5F52", fontFamily: mono, marginTop: 2 }}>{v.type === "clone" ? `CLONE · ${v.duration} ref` : `PRESET · ${v.gender}`}</div>
              </div>
              <MiniWaveform color={v.color} bars={20} height={18} />
              <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                {v.tags.slice(0, 2).map((tag) => (
                  <span key={tag} style={{ fontSize: 9, color: "#6B5F52", backgroundColor: "#2A2520", padding: "2px 7px", borderRadius: 4, fontFamily: mono }}>{tag}</span>
                ))}
              </div>
              <button onClick={(e) => { e.stopPropagation(); setPlayingId(playingId === v.id ? null : v.id); }}
                style={{ width: 30, height: 30, borderRadius: 7, border: "none", backgroundColor: playingId === v.id ? v.color : `${v.color}25`, color: playingId === v.id ? "#141210" : v.color, fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, transition: "all 0.2s", flexShrink: 0 }}>
                {playingId === v.id ? "■" : "▶"}
              </button>
            </div>
          ))}
        </div>
        )}
      </div>

      {/* Detail Sidebar */}
      {detail && (
        <div style={{ width: 280, borderLeft: "1px solid #2A2520", padding: 20, backgroundColor: "#16140F", flexShrink: 0, overflowY: "auto", animation: "fadeIn 0.2s ease" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: "#6B5F52", letterSpacing: "0.12em", fontFamily: mono }}>VOICE DETAIL</span>
            <button onClick={() => setSelectedVoice(null)} style={{ background: "none", border: "none", color: "#4A3F35", cursor: "pointer", fontSize: 16 }}>×</button>
          </div>
          <div style={{ width: 64, height: 64, borderRadius: 14, backgroundColor: `${detail.color}20`, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
            <span style={{ fontSize: 28, color: detail.color }}>{detail.type === "clone" ? "◆" : "▪"}</span>
          </div>
          <div style={{ fontSize: 18, fontWeight: 600, color: "#F0E6D6", fontFamily: serif, marginBottom: 4 }}>{detail.name}</div>
          <div style={{ fontSize: 11, color: "#6B5F52", lineHeight: 1.5, marginBottom: 16 }}>{detail.desc}</div>

          <div style={{ padding: 12, borderRadius: 10, backgroundColor: "#1E1B18", border: "1px solid #2A2520", marginBottom: 12 }}>
            <MiniWaveform color={detail.color} bars={36} height={32} />
            <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 10 }}>
              <button style={{ width: 36, height: 36, borderRadius: 8, border: "none", backgroundColor: detail.color, color: "#141210", fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>▶</button>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
            {[
              { label: "Type", value: detail.type === "clone" ? "Cloned Voice" : "Stock Preset" },
              { label: "Gender", value: detail.gender === "M" ? "Male" : "Female" },
              ...(detail.duration ? [{ label: "Reference", value: detail.duration }] : []),
              { label: "Used", value: `${Math.floor(Math.random() * 20 + 3)}x` },
            ].map((row) => (
              <div key={row.label} style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                <span style={{ color: "#6B5F52" }}>{row.label}</span>
                <span style={{ color: "#A89B8C", fontFamily: mono }}>{row.value}</span>
              </div>
            ))}
          </div>

          {detail.type === "clone" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <button style={{ width: "100%", padding: "8px 0", borderRadius: 8, border: "1px solid #2A2520", backgroundColor: "transparent", color: "#A89B8C", fontSize: 11, cursor: "pointer", fontFamily: mono }}>UPDATE REFERENCE</button>
              <button style={{ width: "100%", padding: "8px 0", borderRadius: 8, border: "1px solid #3A2020", backgroundColor: "transparent", color: "#8B4A4A", fontSize: 11, cursor: "pointer", fontFamily: mono }}>DELETE CLONE</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════
   HISTORY VIEW
   ════════════════════════════════════════════ */
function HistoryView({ history }) {
  const [playingId, setPlayingId] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [voiceFilter, setVoiceFilter] = useState("all");
  const [sortBy, setSortBy] = useState("newest");

  const uniqueVoices = [...new Set(history.map((h) => h.voice))];
  const filtered = history
    .filter((h) => (voiceFilter === "all" || h.voice === voiceFilter) && (!searchQuery || h.text.toLowerCase().includes(searchQuery.toLowerCase())))
    .sort((a, b) => sortBy === "longest" ? parseFloat(b.duration) - parseFloat(a.duration) : sortBy === "shortest" ? parseFloat(a.duration) - parseFloat(b.duration) : a.id - b.id);

  const totalDur = history.reduce((s, h) => s + parseFloat(h.duration), 0);
  const totalGen = history.reduce((s, h) => s + parseFloat(h.genTime), 0);
  const avgRtf = (history.reduce((s, h) => s + parseFloat(h.rtf), 0) / history.length).toFixed(1);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: "24px 24px 0 24px" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 }}>
          <div>
            <h2 style={{ fontSize: 22, fontWeight: 600, fontFamily: serif, color: "#F0E6D6", marginBottom: 4 }}>Forge History</h2>
            <p style={{ fontSize: 12, color: "#6B5F52" }}>{history.length} generations · {totalDur.toFixed(1)}s total audio</p>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid #2A2520", backgroundColor: "transparent", color: "#A89B8C", fontSize: 11, cursor: "pointer", fontFamily: mono }}>EXPORT ALL ↓</button>
            <button style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid #3A2020", backgroundColor: "transparent", color: "#8B4A4A", fontSize: 11, cursor: "pointer", fontFamily: mono }}>CLEAR</button>
          </div>
        </div>

        {/* Stats Row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 20 }}>
          {[
            { label: "TOTAL AUDIO", value: `${Math.floor(totalDur / 60)}m ${Math.round(totalDur % 60)}s`, accent: "#E8A849" },
            { label: "GENERATIONS", value: String(history.length), accent: "#D4735E" },
            { label: "FORGE TIME", value: `${Math.floor(totalGen / 60)}m ${Math.round(totalGen % 60)}s`, accent: "#7B8F6A" },
            { label: "AVG RTF", value: `${avgRtf}x`, accent: "#9B8EC4" },
          ].map((c) => (
            <div key={c.label} style={{ padding: 14, borderRadius: 10, backgroundColor: "#1A1815", border: "1px solid #2A2520" }}>
              <div style={{ fontSize: 9, color: "#4A3F35", fontFamily: mono, letterSpacing: "0.1em", marginBottom: 6 }}>{c.label}</div>
              <div style={{ fontSize: 20, fontWeight: 600, color: c.accent, fontFamily: mono }}>{c.value}</div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 16 }}>
          <div style={{ flex: 1, position: "relative" }}>
            <input type="text" placeholder="Search text..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
              style={{ width: "100%", padding: "8px 12px 8px 32px", borderRadius: 8, border: "1px solid #2A2520", backgroundColor: "#1A1815", color: "#E0D5C5", fontSize: 12, fontFamily: sans }} />
            <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", fontSize: 13, color: "#4A3F35" }}>⌕</span>
          </div>
          <select value={voiceFilter} onChange={(e) => setVoiceFilter(e.target.value)}
            style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #2A2520", backgroundColor: "#1A1815", color: "#A89B8C", fontSize: 11, fontFamily: mono, cursor: "pointer" }}>
            <option value="all">All voices</option>
            {uniqueVoices.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}
            style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #2A2520", backgroundColor: "#1A1815", color: "#A89B8C", fontSize: 11, fontFamily: mono, cursor: "pointer" }}>
            <option value="newest">Newest first</option>
            <option value="longest">Longest first</option>
            <option value="shortest">Shortest first</option>
          </select>
        </div>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: "auto", padding: "0 24px 24px 24px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {filtered.map((item) => (
            <div key={item.id}
              style={{ padding: 16, borderRadius: 12, backgroundColor: playingId === item.id ? "#1E1B18" : "#1A1815", border: playingId === item.id ? `1px solid ${item.voiceColor}30` : "1px solid #2A2520", transition: "all 0.2s" }}
              onMouseEnter={(e) => { if (playingId !== item.id) e.currentTarget.style.borderColor = "#3A3530"; }}
              onMouseLeave={(e) => { if (playingId !== item.id) e.currentTarget.style.borderColor = "#2A2520"; }}>
              <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                <button onClick={() => setPlayingId(playingId === item.id ? null : item.id)}
                  style={{ width: 38, height: 38, borderRadius: 9, border: "none", backgroundColor: playingId === item.id ? item.voiceColor : `${item.voiceColor}20`, color: playingId === item.id ? "#141210" : item.voiceColor, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, flexShrink: 0, marginTop: 2, transition: "all 0.2s" }}>
                  {playingId === item.id ? "■" : "▶"}
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: "#D0C5B5", lineHeight: 1.5, marginBottom: 8, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{item.text}</div>
                  {playingId === item.id && (
                    <div style={{ marginBottom: 8, animation: "fadeIn 0.2s ease" }}>
                      <MiniWaveform color={item.voiceColor} bars={48} height={28} />
                    </div>
                  )}
                  <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: item.voiceColor, fontFamily: mono }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: item.voiceColor, display: "inline-block" }} />
                      {item.voice}
                    </span>
                    <span style={{ fontSize: 10, color: "#4A3F35", fontFamily: mono }}>{item.duration} · {item.rtf} RTF</span>
                    <span style={{ fontSize: 10, color: "#3A3530", fontFamily: mono }}>{item.format}</span>
                    <span style={{ fontSize: 10, color: "#3A3530", fontFamily: mono, marginLeft: "auto" }}>{item.date} · {item.time}</span>
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, flexShrink: 0 }}>
                  <button style={{ padding: "5px 10px", borderRadius: 5, border: "1px solid #2A2520", backgroundColor: "transparent", color: "#6B5F52", fontSize: 10, cursor: "pointer", fontFamily: mono, transition: "all 0.15s" }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#E8A849"; e.currentTarget.style.color = "#E8A849"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#2A2520"; e.currentTarget.style.color = "#6B5F52"; }}>↓ SAVE</button>
                  <button style={{ padding: "5px 10px", borderRadius: 5, border: "1px solid #2A2520", backgroundColor: "transparent", color: "#6B5F52", fontSize: 10, cursor: "pointer", fontFamily: mono, transition: "all 0.15s" }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#6B5F52"; e.currentTarget.style.color = "#A89B8C"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#2A2520"; e.currentTarget.style.color = "#6B5F52"; }}>↻ REDO</button>
                </div>
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div style={{ textAlign: "center", padding: 48, color: "#4A3F35" }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>⚒</div>
              <div style={{ fontSize: 13 }}>No forges match your filters</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════
   MAIN APP
   ════════════════════════════════════════════ */
export default function FoundryVox() {
  const [selectedVoice, setSelectedVoice] = useState(1);
  const [text, setText] = useState("The forge burns brightest at midnight. Every voice begins as raw metal — shapeless, waiting. What comes out depends on the hands that guide it.");
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [progress, setProgress] = useState(0);
  const [showCloneModal, setShowCloneModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [activeTab, setActiveTab] = useState("generate");
  const [playing, setPlaying] = useState(false);

  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  const charCount = text.length;
  const estDur = Math.round(wordCount * 0.45);
  const estGen = Math.round(estDur * 3.5);

  useEffect(() => {
    if (generating) {
      const iv = setInterval(() => setProgress((p) => { if (p >= 100) { clearInterval(iv); setGenerating(false); setGenerated(true); return 100; } return p + 1.5; }), 50);
      return () => clearInterval(iv);
    }
  }, [generating]);

  const voice = VOICES.find((v) => v.id === selectedVoice);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700&family=JetBrains+Mono:wght@300;400;500&family=Playfair+Display:wght@400;500;600;700&display=swap');
        @keyframes pulse { 0%{transform:scaleY(.6)} 100%{transform:scaleY(1.2)} }
        @keyframes ember { 0%{transform:translateY(0) scale(1);opacity:.8} 50%{opacity:.5} 100%{transform:translateY(-120px) scale(0);opacity:0} }
        @keyframes glow { 0%{box-shadow:0 0 20px rgba(232,168,73,.1)} 100%{box-shadow:0 0 40px rgba(232,168,73,.25)} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        *{box-sizing:border-box;margin:0;padding:0}
        textarea:focus,button:focus,input:focus,select:focus{outline:none}
        textarea::placeholder,input::placeholder{color:#4A3F35}
        ::-webkit-scrollbar{width:5px} ::-webkit-scrollbar-track{background:transparent} ::-webkit-scrollbar-thumb{background:#3A3530;border-radius:3px}
      `}</style>

      <div style={{ width: "100%", minHeight: "100vh", backgroundColor: "#141210", color: "#F0E6D6", fontFamily: sans, display: "flex", flexDirection: "column" }}>
        {/* ── Title Bar ── */}
        <div style={{ height: 48, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 20px", borderBottom: "1px solid #2A2520", backgroundColor: "#18160F", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ display: "flex", gap: 7 }}>
              <div style={{ width: 11, height: 11, borderRadius: "50%", backgroundColor: "#FF5F57" }} />
              <div style={{ width: 11, height: 11, borderRadius: "50%", backgroundColor: "#FEBD2E" }} />
              <div style={{ width: 11, height: 11, borderRadius: "50%", backgroundColor: "#28C840" }} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: 8 }}>
              <div style={{ width: 22, height: 22, borderRadius: 5, background: "linear-gradient(135deg, #E8A849, #C9783A)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#141210" }}>F</div>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#A89B8C", letterSpacing: "0.08em", fontFamily: sans }}>FOUNDRY VOX</span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {["generate", "library", "history"].map((tab) => (
              <button key={tab} onClick={() => setActiveTab(tab)} style={{ padding: "5px 14px", borderRadius: 6, border: "none", backgroundColor: activeTab === tab ? "#2A2520" : "transparent", color: activeTab === tab ? "#F0E6D6" : "#6B5F52", fontSize: 12, fontWeight: 500, cursor: "pointer", fontFamily: sans, textTransform: "capitalize", transition: "all 0.2s" }}>{tab}</button>
            ))}
          </div>
          <div style={{ fontSize: 10, color: "#4A3F35", fontFamily: mono, display: "flex", alignItems: "center", gap: 12 }}>
            <span>TADA 1B · float32 · M4</span>
            <button onClick={() => setShowSettings(!showSettings)} style={{ width: 28, height: 28, borderRadius: 6, border: "1px solid #2A2520", backgroundColor: showSettings ? "#2A2520" : "transparent", color: showSettings ? "#E8A849" : "#4A3F35", fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s" }}>⚙</button>
          </div>
        </div>

        {/* ══ GENERATE TAB ══ */}
        {activeTab === "generate" && (
          <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
            {/* Left — Voices */}
            <div style={{ width: 220, borderRight: "1px solid #2A2520", padding: 16, display: "flex", flexDirection: "column", gap: 12, flexShrink: 0, backgroundColor: "#16140F" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 10, fontWeight: 600, color: "#6B5F52", letterSpacing: "0.12em", fontFamily: mono }}>VOICES</span>
                <button onClick={() => setShowCloneModal(true)} style={{ fontSize: 10, color: "#E8A849", backgroundColor: "transparent", border: "1px solid #3A3530", borderRadius: 5, padding: "3px 8px", cursor: "pointer", fontFamily: mono, fontWeight: 500 }}>+ CLONE</button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, overflowY: "auto" }}>
                {VOICES.map((v) => <VoiceCard key={v.id} voice={v} selected={selectedVoice === v.id} onClick={() => setSelectedVoice(v.id)} />)}
              </div>
              <div style={{ padding: 12, borderRadius: 10, backgroundColor: "#1E1B18", border: "1px solid #2A2520" }}>
                <div style={{ fontSize: 10, color: "#6B5F52", fontFamily: mono, letterSpacing: "0.1em", marginBottom: 8 }}>SELECTED</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: voice.color, marginBottom: 4 }}>{voice.name}</div>
                <div style={{ fontSize: 11, color: "#6B5F52" }}>{voice.type === "clone" ? `${voice.duration} reference · Cloned` : "Stock preset voice"}</div>
              </div>
            </div>

            {/* Center — Editor */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: 24, gap: 20, overflow: "auto" }}>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 10, fontWeight: 600, color: "#6B5F52", letterSpacing: "0.12em", fontFamily: mono }}>SCRIPT</span>
                  <div style={{ display: "flex", gap: 8 }}>
                    {["IMPORT .TXT", "PASTE"].map((btn) => (
                      <button key={btn} style={{ fontSize: 10, color: "#6B5F52", backgroundColor: "transparent", border: "1px solid #2A2520", borderRadius: 5, padding: "3px 10px", cursor: "pointer", fontFamily: mono }}>{btn}</button>
                    ))}
                  </div>
                </div>
                <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Type or paste your script here..."
                  style={{ flex: 1, minHeight: 180, padding: 16, borderRadius: 12, border: "1px solid #2A2520", backgroundColor: "#1A1815", color: "#E0D5C5", fontSize: 15, lineHeight: 1.7, fontFamily: sans, resize: "none" }}
                  onFocus={(e) => e.target.style.borderColor = "#3A3530"} onBlur={(e) => e.target.style.borderColor = "#2A2520"} />
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#4A3F35", fontFamily: mono }}>
                  <span>{wordCount} words · {charCount} chars</span>
                  <span>~{estDur}s audio · ~{estGen}s to generate</span>
                </div>
              </div>

              {/* Waveform */}
              <div style={{ position: "relative", borderRadius: 12, border: `1px solid ${generating ? "#E8A84930" : "#2A2520"}`, backgroundColor: generating ? "#1A1815" : "#18160F", overflow: "hidden", transition: "all 0.3s", animation: generating ? "glow 2s ease-in-out infinite alternate" : "none" }}>
                <EmberParticles active={generating} />
                <div style={{ padding: "20px 0" }}><WaveformBars active={generating || generated} barCount={64} /></div>
                {generating && (
                  <div style={{ padding: "0 16px 12px" }}>
                    <div style={{ height: 3, borderRadius: 2, backgroundColor: "#2A2520", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${progress}%`, backgroundColor: "#E8A849", borderRadius: 2, transition: "width 0.1s linear" }} />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#6B5F52", fontFamily: mono, marginTop: 6 }}>
                      <span>Forging audio...</span><span>{Math.round(progress)}%</span>
                    </div>
                  </div>
                )}
                {generated && !generating && (
                  <div style={{ padding: "0 16px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", animation: "fadeIn 0.3s ease" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <button onClick={() => setPlaying(!playing)} style={{ width: 32, height: 32, borderRadius: 8, border: "none", backgroundColor: "#E8A849", color: "#141210", fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>{playing ? "❚❚" : "▶"}</button>
                      <div style={{ fontSize: 12, color: "#A89B8C", fontFamily: mono }}>24.3s · 3.5x RTF · WAV 24kHz</div>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid #2A2520", backgroundColor: "transparent", color: "#A89B8C", fontSize: 11, cursor: "pointer", fontFamily: mono }}>↻ REDO</button>
                      <button style={{ padding: "6px 14px", borderRadius: 6, border: "none", backgroundColor: "#E8A849", color: "#141210", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: mono }}>EXPORT ↓</button>
                    </div>
                  </div>
                )}
              </div>

              <button onClick={() => { setGenerating(true); setGenerated(false); setProgress(0); }} disabled={generating || !text.trim()}
                style={{ width: "100%", padding: "14px 0", borderRadius: 12, border: "none", background: generating ? "#2A2520" : "linear-gradient(135deg, #E8A849, #C9783A)", color: generating ? "#6B5F52" : "#141210", fontSize: 14, fontWeight: 700, letterSpacing: "0.08em", cursor: generating ? "not-allowed" : "pointer", fontFamily: sans, transition: "all 0.3s" }}>
                {generating ? "FORGING..." : "FORGE VOICE ⌘↵"}
              </button>
            </div>

            {/* Right — Recent */}
            <div style={{ width: 260, borderLeft: "1px solid #2A2520", padding: 16, display: "flex", flexDirection: "column", gap: 12, flexShrink: 0, backgroundColor: "#16140F" }}>
              <span style={{ fontSize: 10, fontWeight: 600, color: "#6B5F52", letterSpacing: "0.12em", fontFamily: mono }}>RECENT FORGES</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1, overflowY: "auto" }}>
                {FULL_HISTORY.slice(0, 3).map((item) => (
                  <div key={item.id} style={{ padding: 12, borderRadius: 10, backgroundColor: "#1E1B18", border: "1px solid #2A2520", cursor: "pointer", transition: "border-color 0.2s" }}
                    onMouseEnter={(e) => e.currentTarget.style.borderColor = "#3A3530"} onMouseLeave={(e) => e.currentTarget.style.borderColor = "#2A2520"}>
                    <div style={{ fontSize: 12, color: "#C4B8A8", lineHeight: 1.4, marginBottom: 8, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{item.text}</div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#4A3F35", fontFamily: mono }}>
                      <span>{item.voice}</span><span>{item.duration} · {item.rtf}</span>
                    </div>
                    <div style={{ fontSize: 9, color: "#3A3530", fontFamily: mono, marginTop: 4 }}>{item.time}</div>
                  </div>
                ))}
              </div>
              <button onClick={() => setActiveTab("history")} style={{ width: "100%", padding: "8px 0", borderRadius: 8, border: "1px solid #2A2520", backgroundColor: "transparent", color: "#6B5F52", fontSize: 11, cursor: "pointer", fontFamily: mono }}>VIEW ALL HISTORY →</button>
              <div style={{ padding: 12, borderRadius: 10, backgroundColor: "#1E1B18", border: "1px solid #2A2520" }}>
                <div style={{ fontSize: 10, color: "#6B5F52", fontFamily: mono, letterSpacing: "0.1em", marginBottom: 10 }}>SESSION</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {[{ l: "Forged", v: "3 clips" }, { l: "Audio", v: "1m 14s" }, { l: "Avg RTF", v: "3.5x" }, { l: "Model", v: "Warmed up ✓" }].map((s) => (
                    <div key={s.l} style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                      <span style={{ color: "#6B5F52" }}>{s.l}</span>
                      <span style={{ color: "#A89B8C", fontFamily: mono, fontSize: 11 }}>{s.v}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ══ LIBRARY TAB ══ */}
        {activeTab === "library" && <LibraryView voices={VOICES} onClone={() => setShowCloneModal(true)} />}

        {/* ══ HISTORY TAB ══ */}
        {activeTab === "history" && <HistoryView history={FULL_HISTORY} />}

        {/* ── Settings Panel ── */}
        {showSettings && (
          <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(10,9,8,.85)", display: "flex", justifyContent: "flex-end", zIndex: 99, animation: "fadeIn 0.15s ease" }} onClick={() => setShowSettings(false)}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: 340, backgroundColor: "#1A1815", borderLeft: "1px solid #2A2520", padding: 24, overflowY: "auto", display: "flex", flexDirection: "column", gap: 24 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <h3 style={{ fontSize: 18, fontWeight: 600, fontFamily: serif, color: "#F0E6D6" }}>Settings</h3>
                <button onClick={() => setShowSettings(false)} style={{ background: "none", border: "none", color: "#4A3F35", cursor: "pointer", fontSize: 18 }}>×</button>
              </div>

              {/* Model */}
              <div>
                <div style={{ fontSize: 10, color: "#6B5F52", fontFamily: mono, letterSpacing: "0.1em", marginBottom: 10 }}>MODEL</div>
                <div style={{ display: "flex", gap: 8 }}>
                  {["TADA 1B", "TADA 3B"].map((m) => (
                    <button key={m} style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: m === "TADA 1B" ? "1.5px solid #E8A849" : "1px solid #2A2520", backgroundColor: m === "TADA 1B" ? "#E8A84910" : "#141210", color: m === "TADA 1B" ? "#E8A849" : "#6B5F52", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: mono, transition: "all 0.2s" }}>{m}</button>
                  ))}
                </div>
                <div style={{ fontSize: 10, color: "#4A3F35", fontFamily: mono, marginTop: 6 }}>3B requires 32GB RAM · Higher quality, slower</div>
              </div>

              {/* CPU Threads */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontSize: 10, color: "#6B5F52", fontFamily: mono, letterSpacing: "0.1em" }}>CPU THREADS</span>
                  <span style={{ fontSize: 11, color: "#E8A849", fontFamily: mono }}>6 / 8</span>
                </div>
                <div style={{ height: 6, borderRadius: 3, backgroundColor: "#2A2520", position: "relative" }}>
                  <div style={{ height: "100%", width: "75%", backgroundColor: "#E8A849", borderRadius: 3 }} />
                  <div style={{ position: "absolute", top: -4, left: "75%", transform: "translateX(-50%)", width: 14, height: 14, borderRadius: "50%", backgroundColor: "#E8A849", border: "2px solid #141210", cursor: "pointer" }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#3A3530", fontFamily: mono, marginTop: 4 }}>
                  <span>1</span><span>8</span>
                </div>
              </div>

              {/* Audio Quality */}
              <div>
                <div style={{ fontSize: 10, color: "#6B5F52", fontFamily: mono, letterSpacing: "0.1em", marginBottom: 10 }}>AUDIO OUTPUT</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {[
                    { label: "Format", value: "WAV" },
                    { label: "Sample Rate", value: "24 kHz" },
                    { label: "Bit Depth", value: "16-bit" },
                  ].map((row) => (
                    <div key={row.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 11, color: "#6B5F52" }}>{row.label}</span>
                      <select style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #2A2520", backgroundColor: "#141210", color: "#A89B8C", fontSize: 11, fontFamily: mono, cursor: "pointer" }}>
                        <option>{row.value}</option>
                      </select>
                    </div>
                  ))}
                </div>
              </div>

              {/* Output Directory */}
              <div>
                <div style={{ fontSize: 10, color: "#6B5F52", fontFamily: mono, letterSpacing: "0.1em", marginBottom: 10 }}>OUTPUT DIRECTORY</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <div style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "1px solid #2A2520", backgroundColor: "#141210", fontSize: 11, color: "#6B5F52", fontFamily: mono, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>~/Documents/FoundryVox</div>
                  <button style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #2A2520", backgroundColor: "transparent", color: "#A89B8C", fontSize: 11, cursor: "pointer", fontFamily: mono, flexShrink: 0 }}>CHOOSE</button>
                </div>
              </div>

              {/* Warmup */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 11, color: "#A89B8C", marginBottom: 2 }}>Warmup on launch</div>
                    <div style={{ fontSize: 10, color: "#4A3F35" }}>Run silent generation at startup for faster first forge</div>
                  </div>
                  <div style={{ width: 40, height: 22, borderRadius: 11, backgroundColor: "#E8A849", cursor: "pointer", position: "relative", transition: "all 0.2s" }}>
                    <div style={{ width: 18, height: 18, borderRadius: "50%", backgroundColor: "#141210", position: "absolute", top: 2, right: 2, transition: "all 0.2s" }} />
                  </div>
                </div>
              </div>

              {/* About */}
              <div style={{ borderTop: "1px solid #2A2520", paddingTop: 16, marginTop: "auto" }}>
                <div style={{ fontSize: 12, color: "#6B5F52", marginBottom: 4 }}>Foundry Vox v1.0.0</div>
                <div style={{ fontSize: 10, color: "#3A3530", fontFamily: mono }}>Built with Llama · TADA by Hume AI</div>
                <div style={{ fontSize: 10, color: "#3A3530", fontFamily: mono, marginTop: 2 }}>Hanson Foundry © 2026</div>
              </div>
            </div>
          </div>
        )}

        {/* ── Clone Modal ── */}
        {showCloneModal && (
          <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(10,9,8,.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, animation: "fadeIn 0.2s ease" }} onClick={() => setShowCloneModal(false)}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: 440, backgroundColor: "#1E1B18", borderRadius: 16, border: "1px solid #2A2520", padding: 28, display: "flex", flexDirection: "column", gap: 20 }}>
              <div>
                <h3 style={{ fontSize: 20, fontWeight: 600, fontFamily: serif, color: "#F0E6D6", marginBottom: 6 }}>Clone a Voice</h3>
                <p style={{ fontSize: 13, color: "#6B5F52", lineHeight: 1.5 }}>Record or upload at least 9 seconds of clean speech. Less noise = better clone.</p>
              </div>
              <div style={{ border: "2px dashed #3A3530", borderRadius: 12, padding: 32, textAlign: "center", cursor: "pointer", transition: "border-color 0.2s" }}
                onMouseEnter={(e) => e.currentTarget.style.borderColor = "#E8A849"} onMouseLeave={(e) => e.currentTarget.style.borderColor = "#3A3530"}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>🎙</div>
                <div style={{ fontSize: 13, color: "#A89B8C", marginBottom: 4 }}>Drop an audio file or click to record</div>
                <div style={{ fontSize: 11, color: "#4A3F35", fontFamily: mono }}>WAV, MP3, M4A · 9s minimum</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, fontFamily: mono }}>
                  <span style={{ color: "#6B5F52" }}>REFERENCE QUALITY</span>
                  <span style={{ color: "#4A3F35" }}>Waiting for audio...</span>
                </div>
                <div style={{ height: 4, borderRadius: 2, backgroundColor: "#2A2520" }}><div style={{ height: "100%", width: "0%", backgroundColor: "#6B5F52", borderRadius: 2 }} /></div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#3A3530", fontFamily: mono }}>
                  <span>0s / 9s minimum</span><span>30s recommended</span>
                </div>
              </div>
              <div>
                <label style={{ fontSize: 10, color: "#6B5F52", fontFamily: mono, letterSpacing: "0.1em", display: "block", marginBottom: 6 }}>VOICE NAME</label>
                <input type="text" placeholder="e.g. My Narrator Voice" style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: "1px solid #2A2520", backgroundColor: "#141210", color: "#F0E6D6", fontSize: 14, fontFamily: sans }} />
              </div>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button onClick={() => setShowCloneModal(false)} style={{ padding: "10px 20px", borderRadius: 8, border: "1px solid #2A2520", backgroundColor: "transparent", color: "#A89B8C", fontSize: 13, cursor: "pointer", fontFamily: sans }}>Cancel</button>
                <button style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: "linear-gradient(135deg, #E8A849, #C9783A)", color: "#141210", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: sans }}>Clone Voice</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
