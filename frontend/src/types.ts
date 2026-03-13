export type VoiceType = "preset" | "clone";
export type AudioFormat = "wav" | "mp3" | "aac";
export type HealthStatus = "loading" | "warming_up" | "ready" | "generating" | "error";

export interface Voice {
  id: string;
  name: string;
  type: VoiceType;
  gender: string | null;
  color: string | null;
  description: string | null;
  tags: string[];
  reference_duration_seconds: number | null;
  reference_text?: string | null;
  reference_audio_path?: string | null;
  created_at: string;
  updated_at?: string;
}

export interface HealthResponse {
  status: HealthStatus;
  model: string;
  model_loaded: boolean;
  warmed_up: boolean;
  device: string;
  dtype: string;
  platform: string;
  error?: string | null;
  message?: string | null;
}

export interface Generation {
  id: string;
  text: string;
  voice_id: string;
  voice_name: string;
  system_prompt: string | null;
  output_path: string;
  format: AudioFormat;
  sample_rate: number;
  duration_seconds: number;
  generation_time_seconds: number;
  rtf: number;
  char_count: number;
  word_count: number;
  created_at: string;
}

export interface Settings {
  model: "tada-1b" | "tada-3b";
  cpu_threads: number;
  output_format: AudioFormat;
  sample_rate: 16000 | 22050 | 24000 | 44100 | 48000;
  bit_depth: 16 | 24 | 32;
  output_directory: string;
  warmup_on_launch: boolean;
}

export interface HistoryStats {
  session: {
    generations: number;
    total_audio_seconds: number;
    total_generation_seconds: number;
    avg_rtf: number;
  };
  lifetime: {
    generations: number;
    total_audio_seconds: number;
    total_generation_seconds: number;
    avg_rtf: number;
  };
}

export interface ProgressEvent {
  status: string;
  percent: number;
  tokens_generated?: number | null;
  tokens_total?: number | null;
  generation_id?: string | null;
  message?: string | null;
}

