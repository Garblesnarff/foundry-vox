import { invoke } from "@tauri-apps/api/core";
import type {
  Generation,
  HealthResponse,
  HistoryStats,
  ProgressEvent,
  Settings,
  Voice,
} from "../types";

interface RuntimeConfig {
  apiBase: string;
  apiToken: string | null;
}

interface ApiErrorShape {
  error: string;
  message: string;
  details?: Record<string, unknown>;
}

interface HistoryResponse {
  generations: Generation[];
  total: number;
}

const DEFAULT_API_BASE = "http://127.0.0.1:3456/api/v1";

let runtimeConfig: RuntimeConfig = {
  apiBase: DEFAULT_API_BASE,
  apiToken: null,
};
let runtimeConfigPromise: Promise<void> | null = null;

async function initRuntimeConfig(): Promise<void> {
  if (!runtimeConfigPromise) {
    runtimeConfigPromise = (async () => {
      try {
        const config = await invoke<RuntimeConfig>("runtime_config");
        runtimeConfig = {
          apiBase: config.apiBase || DEFAULT_API_BASE,
          apiToken: config.apiToken || null,
        };
      } catch {
        runtimeConfig = {
          apiBase: DEFAULT_API_BASE,
          apiToken: null,
        };
      }
    })();
  }
  await runtimeConfigPromise;
}

function withToken(path: string): string {
  if (!runtimeConfig.apiToken) {
    return `${runtimeConfig.apiBase}${path}`;
  }
  const separator = path.includes("?") ? "&" : "?";
  return `${runtimeConfig.apiBase}${path}${separator}token=${encodeURIComponent(runtimeConfig.apiToken)}`;
}

function requestHeaders(init?: RequestInit): Headers {
  const headers = new Headers(init?.headers ?? {});
  if (runtimeConfig.apiToken) {
    headers.set("x-foundry-vox-token", runtimeConfig.apiToken);
  }
  return headers;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  await initRuntimeConfig();
  const response = await fetch(`${runtimeConfig.apiBase}${path}`, {
    cache: "no-store",
    ...init,
    headers: requestHeaders(init),
  });
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as ApiErrorShape | null;
    throw new Error(error?.message ?? `Request failed with ${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function fetchBlob(path: string, init?: RequestInit): Promise<Blob> {
  await initRuntimeConfig();
  const response = await fetch(`${runtimeConfig.apiBase}${path}`, {
    cache: "no-store",
    ...init,
    headers: requestHeaders(init),
  });
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as ApiErrorShape | null;
    throw new Error(error?.message ?? `Request failed with ${response.status}`);
  }
  return response.blob();
}

async function invokeBackend<T>(command: string, payload?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, payload);
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(typeof error === "string" ? error : "Request failed.");
  }
}

export const api = {
  init: initRuntimeConfig,
  get baseUrl() {
    return runtimeConfig.apiBase;
  },
  mediaUrl: (path: string) => withToken(path),
  getHealth: () => invokeBackend<HealthResponse>("backend_get_health"),
  getVoices: (type?: "preset" | "clone") =>
    request<{ voices: Voice[] }>(type ? `/voices?type=${type}` : "/voices"),
  getVoice: (voiceId: string) => request<{ voice: Voice }>(`/voices/${voiceId}`),
  createClone: async (formData: FormData) => {
    await initRuntimeConfig();
    const response = await fetch(`${runtimeConfig.apiBase}/voices/clone`, {
      method: "POST",
      body: formData,
      headers: requestHeaders(),
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
  getHistory: (params: URLSearchParams) =>
    invokeBackend<HistoryResponse>("backend_get_history", { query: params.toString() }),
  getHistoryStats: () => invokeBackend<HistoryStats>("backend_get_history_stats"),
  deleteHistoryItem: (generationId: string) =>
    request<{ deleted: boolean }>(`/history/${generationId}`, { method: "DELETE" }),
  clearHistory: () => request<{ deleted: number }>("/history", { method: "DELETE" }),
  getSettings: () => invokeBackend<Settings>("backend_get_settings"),
  patchSettings: (payload: Partial<Settings>) => invokeBackend<Settings>("backend_patch_settings", { payload }),
  downloadGenerationAudio: (generationId: string) => fetchBlob(`/generate/${generationId}/download`),
  exportBatch: async (payload: {
    generation_ids: string[];
    mode: "zip" | "concatenate";
    format: "wav" | "mp3" | "aac";
    pause_seconds?: number;
  }) => {
    await initRuntimeConfig();
    const response = await fetch(`${runtimeConfig.apiBase}/export/batch`, {
      method: "POST",
      headers: requestHeaders({ headers: { "Content-Type": "application/json" } }),
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const error = (await response.json().catch(() => null)) as ApiErrorShape | null;
      throw new Error(error?.message ?? "Failed to export batch");
    }
    return response.blob();
  },
  progressStream: async (onEvent: (event: ProgressEvent, type: string) => void) => {
    await initRuntimeConfig();
    const source = new EventSource(withToken("/generate/progress"));
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
