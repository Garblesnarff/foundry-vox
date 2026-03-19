import qualityPresetData from "../../../shared/quality-presets.json";
import type { QualityPreset } from "../types";

type QualityPresetDefinition = {
  key: QualityPreset;
  label: string;
  steps: number;
  cfg_scale: number;
  noise_temperature: number;
  expected_rtf: number;
  description: string;
};

export const QUALITY_PRESETS = qualityPresetData as QualityPresetDefinition[];

export function speedHint(expectedRtf: number) {
  const speed = 1 / expectedRtf;
  return `~${speed.toFixed(speed >= 1 ? 1 : 1)}x speed`;
}
