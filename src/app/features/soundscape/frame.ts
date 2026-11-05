// The activity frame of Aqua's soundscape grammar (AquaSynth docs/soundscape-grammar, grammar head
// 0091d01, section 2). The Heimdall session produces it; this file only reads it. Shape follows
// heimdall-body:follow_up:ratatoskr-creature-projection-v2 as the grammar relays it. The human
// kind subset (Idle/Working/Speaking) below is PROVISIONAL: still proposed, not ruled, until
// Bifrost's steward cuts the list.

export type Estate = 'human' | 'mind' | 'persona';
export type Kind = 'Idle' | 'Reading' | 'Thinking' | 'Working' | 'Speaking' | 'Waiting' | 'Alert';
export type Energy = 'Low' | 'Mid' | 'High' | 'Peak';
export type Size = 'S' | 'M' | 'L';
export type Override = 'None' | 'Muted';

interface FrameBase {
  mind: string;
  estate: Estate;
  override: Override;
  seq: number;
  /** Producer observation time, whole seconds (grammar: 1 s resolution). */
  at: number;
}
/** O1: a neutral frame carries no size, kind or energy; it is not an Idle and nothing reads one. */
export interface NeutralFrame extends FrameBase {
  neutral: true;
  size?: undefined;
  kind?: undefined;
  energy?: undefined;
}
export interface LiveFrame extends FrameBase {
  neutral: false;
  size: Size;
  kind: Kind;
  energy: Energy;
}
export type ActivityFrame = NeutralFrame | LiveFrame;

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

/** PROVISIONAL (grammar section 2, awaiting the projection-v2 field list): a human's kinds. */
export const HUMAN_KINDS: readonly Kind[] = ['Idle', 'Working', 'Speaking'];

/** Estate clamp, only ever revealing less: a human's out-of-subset or omitted kind is Idle. */
const clampKind = (estate: Estate, kind: unknown): Kind | undefined =>
  estate === 'human' ? oneOf(HUMAN_KINDS, kind) ?? 'Idle' : oneOf(KINDS, kind);

/** A human's energy is three buckets: Peak reads as High. */
const clampEnergy = (estate: Estate, energy: Energy): Energy =>
  estate === 'human' && energy === 'Peak' ? 'High' : energy;

/**
 * Read an untrusted frame. Only the grammar's fields survive: any other key (a weight, a vote, a
 * room id) is dropped, so a consumer cannot be steered by data the grammar does not define (A3).
 * `neutral` is read first: a neutral frame yields no size, kind or energy even if the producer sent
 * them (O1). Returns undefined for anything malformed; the caller treats that as no frame (A4).
 */
export const readFrame = (raw: unknown): ActivityFrame | undefined => {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.neutral !== 'boolean') return undefined;
  const estate = oneOf(ESTATES, r.estate);
  const override =
    r.override === undefined ? 'None' : oneOf(['None', 'Muted'] as const, r.override);
  if (!estate || !override) return undefined;
  if (typeof r.mind !== 'string' || r.mind === '') return undefined;
  if (!Number.isInteger(r.seq) || !Number.isFinite(r.at)) return undefined;
  const base = { mind: r.mind, estate, override, seq: r.seq as number, at: r.at as number };
  if (r.neutral) return { ...base, neutral: true };
  const kind = clampKind(estate, r.kind);
  const energy = oneOf(ENERGIES, r.energy);
  const size = oneOf(SIZES, r.size);
  if (!kind || !energy || !size) return undefined;
  return { ...base, neutral: false, size, kind, energy: clampEnergy(estate, energy) };
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
