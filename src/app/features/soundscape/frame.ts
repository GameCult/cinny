// The activity frame of Aqua's soundscape grammar (AquaSynth docs/soundscape-grammar.md at aeae510,
// section 2). The Heimdall session produces it; this file only reads it. Shape follows
// heimdall-body:follow_up:ratatoskr-creature-projection-v2 as the grammar relays it.

export type Estate = 'human' | 'mind' | 'persona';
export type Kind = 'Idle' | 'Reading' | 'Thinking' | 'Working' | 'Speaking' | 'Waiting' | 'Alert';
export type Energy = 'Low' | 'Mid' | 'High' | 'Peak';
export type Size = 'S' | 'M' | 'L';
export type Override = 'None' | 'Muted';

export interface ActivityFrame {
  mind: string;
  estate: Estate;
  kind: Kind;
  energy: Energy;
  size: Size;
  neutral: boolean;
  override: Override;
  seq: number;
  /** Producer observation time, whole seconds (grammar: 1 s resolution). */
  at: number;
}

const ESTATES: readonly Estate[] = ['human', 'mind', 'persona'];
const KINDS: readonly Kind[] = [
  'Idle',
  'Reading',
  'Thinking',
  'Working',
  'Speaking',
  'Waiting',
  'Alert',
];
const ENERGIES: readonly Energy[] = ['Low', 'Mid', 'High', 'Peak'];
const SIZES: readonly Size[] = ['S', 'M', 'L'];

/** Grammar S2 (proposed, unmeasured): a frame older than this is absent. */
export const STALE_AFTER_S = 10;

const oneOf = <T extends string>(set: readonly T[], v: unknown): T | undefined =>
  set.find((s) => s === v);

/** Grammar estate rule: a consumer clamps a human's energy to Low/Mid/High. */
export const clampEnergy = (estate: Estate, energy: Energy): Energy =>
  estate === 'human' && energy === 'Peak' ? 'High' : energy;

/**
 * Read an untrusted frame. Only the grammar's fields survive: any other key (a weight, a vote, a
 * room id) is dropped, so a consumer cannot be steered by data the grammar does not define (A3).
 * Returns undefined for anything malformed; the caller treats that as no frame (A4).
 */
export const readFrame = (raw: unknown): ActivityFrame | undefined => {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const estate = oneOf(ESTATES, r.estate);
  const kind = oneOf(KINDS, r.kind);
  const energy = oneOf(ENERGIES, r.energy);
  const size = oneOf(SIZES, r.size);
  const override =
    r.override === undefined ? 'None' : oneOf(['None', 'Muted'] as const, r.override);
  if (!estate || !kind || !energy || !size || !override) return undefined;
  if (typeof r.mind !== 'string' || r.mind === '' || typeof r.neutral !== 'boolean')
    return undefined;
  if (!Number.isInteger(r.seq) || !Number.isFinite(r.at)) return undefined;
  return {
    mind: r.mind,
    estate,
    kind,
    energy: clampEnergy(estate, energy),
    size,
    neutral: r.neutral,
    override,
    seq: r.seq as number,
    at: r.at as number,
  };
};

/** Latest frame per mind (S1: consumers drop seq <= last). */
export class FrameTable {
  private frames = new Map<string, ActivityFrame>();

  offer(raw: unknown): boolean {
    const f = readFrame(raw);
    if (!f) return false;
    const last = this.frames.get(f.mind);
    if (last && f.seq <= last.seq) return false;
    this.frames.set(f.mind, f);
    return true;
  }

  /** Frames not stale at `nowS`; a missing or stale frame is simply absent (A4), not neutral. */
  fresh(nowS: number): ActivityFrame[] {
    return [...this.frames.values()].filter((f) => nowS - f.at <= STALE_AFTER_S);
  }
}
