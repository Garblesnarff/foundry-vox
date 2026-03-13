import type {
  Generation,
  HealthResponse,
  HistoryStats,
  ProgressEvent,
  Settings,
  Voice,
} from "../types";

const API_BASE = "http://127.0.0.1:3456/api/v1";

interface ApiErrorShape {
  error: string;
  message: string;
  details?: Record<string, unknown>;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init);
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as ApiErrorShape | null;
    throw new Error(error?.message ?? `Request failed with ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export const api = {
  baseUrl: API_BASE,
  getHealth: () => request<HealthResponse>("/health"),
  getVoices: (type?: "preset" | "clone") =>
    request<{ voices: Voice[] }>(type ? `/voices?type=${type}` : "/voices"),
  getVoice: (voiceId: string) => request<{ voice: Voice }>(`/voices/${voiceId}`),
  createClone: async (formData: FormData) => {
    const response = await fetch(`${API_BASE}/voices/clone`, {
      method: "POST",
      body: formData,
    });
    if (!response.ok) {
      const error = (await response.json().catch(() => null)) as ApiErrorShape | null;
      throw new Error(error?.message ?? "Failed to clone voice");
    }
    return response.json() as Promise<{
      voice: Voice;
      quality: {
        duration_seconds: number;
        snr_estimate_db: number;
        quality_rating: string;
        warnings: string[];
      };
    }>;
  },
  updateVoice: (voiceId: string, payload: Record<string, unknown>) =>
    request<{ voice: Voice }>(`/voices/${voiceId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  deleteVoice: (voiceId: string) =>
    request<{ deleted: boolean }>(`/voices/${voiceId}`, { method: "DELETE" }),
  generate: (payload: Record<string, unknown>) =>
    request<{ generation: Generation }>("/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  getHistory: (params: URLSearchParams) => request<{ generations: Generation[]; total: number }>(`/history?${params}`),
  getHistoryStats: () => request<HistoryStats>("/history/stats"),
  deleteHistoryItem: (generationId: string) =>
    request<{ deleted: boolean }>(`/history/${generationId}`, { method: "DELETE" }),
  clearHistory: () => request<{ deleted: number }>("/history", { method: "DELETE" }),
  getSettings: () => request<Settings>("/settings"),
  patchSettings: (payload: Partial<Settings>) =>
    request<Settings>("/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  exportBatch: async (payload: {
    generation_ids: string[];
    mode: "zip" | "concatenate";
    format: "wav" | "mp3" | "aac";
    pause_seconds?: number;
  }) => {
    const response = await fetch(`${API_BASE}/export/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const error = (await response.json().catch(() => null)) as ApiErrorShape | null;
      throw new Error(error?.message ?? "Failed to export batch");
    }
    return response.blob();
  },
  progressStream: (onEvent: (event: ProgressEvent, type: string) => void) => {
    const source = new EventSource(`${API_BASE}/generate/progress`);
    source.addEventListener("progress", (event) => {
      onEvent(JSON.parse((event as MessageEvent).data), "progress");
    });
    source.addEventListener("complete", (event) => {
      onEvent(JSON.parse((event as MessageEvent).data), "complete");
    });
    source.addEventListener("error", (event) => {
      if (event instanceof MessageEvent) {
        onEvent(JSON.parse(event.data), "error");
      }
    });
    return source;
  },
};

