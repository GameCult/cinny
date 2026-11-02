import type { ActivityFrame, Energy, Kind } from './frame';

/** Grammar V3 (proposed, unmeasured): voices audible at once. */
export const DEFAULT_VOICE_CAP = 4;

/** Local listener preferences. Never written back into a frame (O3). */
export interface SoundscapePrefs {
  /** The feature flag. Default off. */
  enabled: boolean;
  /** Master mute. Default on. */
  muted: boolean;
  /** 0..1 */
  volume: number;
  voiceCap: number;
}

export interface VoiceCommand {
  mind: string;
  kind: Kind;
  energy: Energy;
  gain: number;
}

const ENERGY_RANK: Record<Energy, number> = { Low: 0, Mid: 1, High: 2, Peak: 3 };
/** Grammar section 3: Idle and Waiting default silent. */
const SILENT_KINDS: ReadonlySet<Kind> = new Set<Kind>(['Idle', 'Waiting']);

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/**
 * Which voices speak now. Neutral overrides everything (O1); `Muted` silences one Mind (O2);
 * over the cap the lowest energy drops first (V3, ties by mind id so the result is stable).
 * Identity is the mind id only (V1); `gain` is the user's volume, not a vote weight.
 * Lead exemption in V3 is not implemented: the grammar does not say how a lead is chosen.
 */
export const planVoices = (
  frames: readonly ActivityFrame[],
  prefs: SoundscapePrefs
): VoiceCommand[] => {
  if (!prefs.enabled || prefs.muted) return [];
  const gain = clamp01(prefs.volume);
  if (gain === 0) return [];
  const cap = Math.max(0, Math.floor(prefs.voiceCap));
  return frames
    .filter((f) => !f.neutral && f.override !== 'Muted' && !SILENT_KINDS.has(f.kind))
    .sort((a, b) => ENERGY_RANK[b.energy] - ENERGY_RANK[a.energy] || a.mind.localeCompare(b.mind))
    .slice(0, cap)
    .map((f) => ({ mind: f.mind, kind: f.kind, energy: f.energy, gain }));
};
