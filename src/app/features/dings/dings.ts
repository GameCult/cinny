// Dings: pre-rendered earcons shipped as static assets, `dings/<mxid-localpart>/<motif>.ogg` plus
// `dings/manifest.json` (docs/gamecult/ratatoskr-target.md, Agreements). The sender picks the
// instrument, the event picks the motif. This file is the whole decision; the client only asks it.

export type Motif = 'mention' | 'dm' | 'message' | 'invite';
type Clips = Partial<Record<Motif, string>>;
export type DingManifest = { neutral: Clips; senders: Record<string, Clips> };

/** Client config `dings`. Off unless `enabled` is exactly true; nothing about dings loads otherwise. */
export type DingsConfig = { enabled?: boolean };
export const dingsEnabled = (config: DingsConfig | undefined): boolean => config?.enabled === true;

const MOTIFS: Motif[] = ['mention', 'dm', 'message', 'invite'];

// Mentions and DMs loud, an ordinary message quiet.
export const DING_VOLUME: Record<Motif, number> = {
  mention: 1,
  dm: 1,
  invite: 0.7,
  message: 0.3,
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

// A clip path stays inside dings/: relative, ogg or mp3 (not wav), no dot segments, no scheme.
const isClipPath = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_.-]+)*\.(ogg|mp3)$/.test(v) &&
  !v.split('/').includes('..');

const readClips = (v: unknown): Clips => {
  const clips: Clips = {};
  if (!isRecord(v)) return clips;
  MOTIFS.forEach((m) => {
    if (Object.prototype.hasOwnProperty.call(v, m) && isClipPath(v[m])) clips[m] = v[m] as string;
  });
  return clips;
};

/** The manifest is JSON from outside the typed world: read it defensively, undefined if unusable. */
export const parseManifest = (json: unknown): DingManifest | undefined => {
  if (!isRecord(json) || !isRecord(json.neutral) || !isRecord(json.senders)) return undefined;
  const senders: Record<string, Clips> = Object.create(null);
  Object.keys(json.senders).forEach((localpart) => {
    senders[localpart] = readClips(
      json.senders && (json.senders as Record<string, unknown>)[localpart]
    );
  });
  return { neutral: readClips(json.neutral), senders };
};

/** The sender's own clip, else the neutral one, else nothing: silence. */
export const pickDing = (
  manifest: DingManifest,
  localpart: string,
  motif: Motif
): { path: string; volume: number } | undefined => {
  const own = Object.prototype.hasOwnProperty.call(manifest.senders, localpart)
    ? manifest.senders[localpart][motif]
    : undefined;
  const path = own ?? manifest.neutral[motif];
  return path === undefined ? undefined : { path, volume: DING_VOLUME[motif] };
};

export const motifFor = (e: { invite?: boolean; highlight: boolean; direct: boolean }): Motif => {
  if (e.invite) return 'invite';
  if (e.highlight) return 'mention';
  return e.direct ? 'dm' : 'message';
};

type Clip = { volume: number; play: () => Promise<void> };
type GestureTarget = {
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
};
const GESTURES = ['pointerdown', 'keydown', 'touchend'];

/**
 * Browsers refuse audio until the first user gesture. The player stays silent until one has
 * happened, then plays; a clip the browser still refuses is dropped, never thrown.
 */
export const createDingPlayer = (make: (url: string) => Clip, target: GestureTarget) => {
  let unlocked = false;
  const unlock = () => {
    unlocked = true;
    GESTURES.forEach((g) => target.removeEventListener(g, unlock));
  };
  GESTURES.forEach((g) => target.addEventListener(g, unlock));
  return {
    unlocked: () => unlocked,
    play(url: string, volume: number): boolean {
      if (!unlocked) return false;
      const clip = make(url);
      clip.volume = volume;
      clip.play().catch(() => undefined);
      return true;
    },
  };
};
