import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  Generation,
  HealthResponse,
  HistoryStats,
  ProgressEvent,
  Settings,
  Voice,
} from "../types";

interface HistoryResponse {
  generations: Generation[];
  total: number;
}

interface BinaryResponse {
  fileName: string;
  bytes: number[];
}

interface ProgressBridgeEvent {
  eventType: string;
  payload: ProgressEvent | string;
}

interface ProgressSubscription {
  close: () => Promise<void>;
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
  init: async () => undefined,
  getHealth: () => invokeBackend<HealthResponse>("backend_get_health"),
  getVoices: (type?: "preset" | "clone") =>
    invokeBackend<{ voices: Voice[] }>("backend_get_voices", { voiceType: type ?? null }),
  getVoice: (voiceId: string) => invokeBackend<{ voice: Voice }>("backend_get_voice", { voiceId }),
  getVoicePreview: (voiceId: string) => invokeBackend<BinaryResponse>("backend_get_voice_preview", { voiceId }),
  createClone: async (formData: FormData) => {
    const audio = formData.get("audio");
    if (!(audio instanceof File)) {
      throw new Error("Reference audio is required.");
    }

    const name = String(formData.get("name") ?? "").trim();
    const transcript = String(formData.get("transcript") ?? "").trim();
    const gender = String(formData.get("gender") ?? "");
    const tags = String(formData.get("tags") ?? "[]");

    if (!name) {
      throw new Error("Clone name is required.");
    }
    if (!transcript) {
      throw new Error("A matching transcript is required.");
    }

    return invokeBackend<{
      voice: Voice;
      quality: {
        duration_seconds: number;
        snr_estimate_db: number;
        quality_rating: string;
        warnings: string[];
      };
    }>("backend_create_clone", {
      payload: {
        name,
        gender,
        transcript,
        tags,
        filename: audio.name || "reference.wav",
        audioBytes: Array.from(new Uint8Array(await audio.arrayBuffer())),
      },
    });
  },
  updateVoice: (voiceId: string, payload: Record<string, unknown>) =>
    invokeBackend<{ voice: Voice }>("backend_update_voice", { voiceId, payload }),
  deleteVoice: (voiceId: string) => invokeBackend<{ deleted: boolean }>("backend_delete_voice", { voiceId }),
  generate: (payload: Record<string, unknown>) => invokeBackend<{ generation: Generation }>("backend_generate", { payload }),
  getHistory: (params: URLSearchParams) =>
    invokeBackend<HistoryResponse>("backend_get_history", { query: params.toString() }),
  getHistoryStats: () => invokeBackend<HistoryStats>("backend_get_history_stats"),
  deleteHistoryItem: (generationId: string) =>
    invokeBackend<{ deleted: boolean }>("backend_delete_history_item", { generationId }),
  clearHistory: () => invokeBackend<{ deleted: number }>("backend_clear_history"),
  getSettings: () => invokeBackend<Settings>("backend_get_settings"),
  patchSettings: (payload: Partial<Settings>) => invokeBackend<Settings>("backend_patch_settings", { payload }),
  downloadGenerationAudio: (generationId: string) =>
    invokeBackend<BinaryResponse>("backend_download_generation_audio", { generationId }),
  exportBatch: (payload: {
    generation_ids: string[];
    mode: "zip" | "concatenate";
    format: "wav" | "mp3" | "aac";
    pause_seconds?: number;
  }) => invokeBackend<BinaryResponse>("backend_export_batch", { payload }),
  progressStream: async (onEvent: (event: ProgressEvent, type: string) => void) => {
    const unlistenProgress = await listen<ProgressBridgeEvent>("backend://progress", (event) => {
      if (typeof event.payload.payload === "string") {
        onEvent({ status: "progress", percent: 0, message: event.payload.payload }, event.payload.eventType);
        return;
      }
      onEvent(event.payload.payload, event.payload.eventType);
    });
    const unlistenError = await listen<string>("backend://progress-error", (event) => {
      onEvent({ status: "error", percent: 0, message: event.payload }, "error");
    });
    await invokeBackend("start_progress_bridge");
    return {
      close: async () => {
        await invokeBackend("stop_progress_bridge").catch(() => undefined);
        const cleanup: UnlistenFn[] = [unlistenProgress, unlistenError];
        cleanup.forEach((unlisten) => unlisten());
      },
    } satisfies ProgressSubscription;
  },
};
