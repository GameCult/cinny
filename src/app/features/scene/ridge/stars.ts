// The twinkle of the real stars (`nightBodies.ts` places them from the catalogue for the place and moment). A rolling window of them twinkles
// on an overlay canvas: SLOTS slots, each running back-to-back twinkles of one star at a time, so the active set is always SLOTS stars and every
// star gets its turn. The schedule is a pure function of (seed, time): no state accumulates and no Math.random runs, so any instant maps
// straight to the active set and its gains. A gain multiplies the star's radiance before the display (scintillation is flux), so a star
// the twilight hides stays hidden whatever it does.

/* eslint-disable no-bitwise -- the seeded hash is 32-bit integer arithmetic */

/** Twinkling stars at any instant (fewer only if the field has fewer stars). */
export const SLOTS = 32;
export const TWINKLE_PERIOD = { min: 2, max: 7 } as const;
/** Gain at the dimmest and brightest swing: dimming goes deeper than brightening. */
export const TWINKLE_GAIN = { dim: 0.35, bright: 1.15 } as const;
const SEED = 0x57a45eed;

export interface Star {
  /** The star's index in the catalogue (`starCatalogue.ts`): the identity the twinkle schedule is keyed by, the same on every plate of a sky. */
  id: number;
  /** Position as fractions of the sky canvas width and height. */
  x: number;
  y: number;
  /** Radius in CSS px. */
  r: number;
  /** CSS colour of the star's centre at base brightness: the display of the sky behind it plus the star, through the sky's own display. */
  fill: string;
  /** CSS colour of the sky behind it, through the same display: twinkling paints it over the baked star first. */
  cover: string;
  /** The star's centre colour with its radiance multiplied by `gain` (scintillation). */
  shade: (gain: number) => string;
}

/** Stateless seeded hash of up to three integers to [0, 1). */
export function hash(a: number, b = 0, c = 0): number {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ SEED;
  h = Math.imul(h ^ (h >>> 15) ^ Math.imul(b | 0, 0x85ebca6b), 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 13) ^ Math.imul(c | 0, 0x27d4eb2f), 0x165667b1);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ---- The schedule ---------------------------------------------------------------------------

export const slotCount = (stars: number): number => Math.min(SLOTS, stars);
/**
 * The slots for a schedule over `universe` stars of which `shown` are on the plate that is up: enough that SLOTS of the ones shown twinkle at any instant on
 * average, though the schedule runs over the whole universe (the catalogue), so that the same stars twinkle whichever plate shows them. Never more than half
 * the universe, so each slot has a star to turn to.
 */
export const slotsFor = (universe: number, shown: number): number =>
  Math.max(1, Math.min(Math.floor(universe / 2), Math.round((SLOTS * universe) / Math.max(1, shown)), universe));
/** A slot's twinkle period in seconds: its own, in TWINKLE_PERIOD. */
export const slotPeriod = (j: number): number =>
  TWINKLE_PERIOD.min + (TWINKLE_PERIOD.max - TWINKLE_PERIOD.min) * hash(j, 1);
/** A slot's phase: seconds into its first cycle at t = 0. */
export const slotOffset = (j: number): number => hash(j, 2) * slotPeriod(j);

/** Stars in slot j are those with index = j (mod slots), `m` of them; no star is in two slots. */
const partitionSize = (stars: number, slots: number, j: number): number =>
  Math.floor((stars - 1 - j) / slots) + 1;

/** The k-th star slot j twinkles: epochs of a seeded shuffle of its partition, never repeating across the seam. */
function partitionPick(stars: number, slots: number, j: number, k: number): number {
  const m = partitionSize(stars, slots, j);
  const shuffled = (e: number) => {
    const order = Array.from({ length: m }, (_, q) => q).sort(
      (a, b) => hash(j, e, a + 10) - hash(j, e, b + 10) || a - b
    );
    return order;
  };
  const e = Math.floor(k / m);
  const order = shuffled(e);
  if (m > 1 && order[0] === shuffled(e - 1)[m - 1]) [order[0], order[1]] = [order[1], order[0]];
  return j + slots * order[k - e * m];
}

/**
 * Brightness multiplier at fraction u of one twinkle (0..1): exactly 1 at both ends, so a star
 * joins and leaves at its base brightness. One swing, a little unrelated shimmer, and the
 * asymmetric map below: dimming goes to TWINKLE_GAIN.dim, brightening only to .bright.
 */
export function twinkleGain(
  u: number,
  seed: { flip: boolean; ripple: number; phase: number }
): number {
  if (u <= 0 || u >= 1) return 1;
  const main = Math.sin(2 * Math.PI * u) * (seed.flip ? -1 : 1);
  const shimmer = Math.sin(2 * Math.PI * seed.ripple * u + seed.phase) * Math.sin(Math.PI * u);
  const s = Math.max(-1, Math.min(1, 0.85 * main + 0.15 * shimmer));
  return s >= 0 ? 1 + (TWINKLE_GAIN.bright - 1) * s : 1 + (1 - TWINKLE_GAIN.dim) * s;
}

export interface Twinkling {
  slot: number;
  star: number;
  /** Seconds since this twinkle started, and its length. */
  start: number;
  period: number;
  gain: number;
}

/** The active set at time `t` seconds for a universe of `stars` stars, in slot order, in `slots` slots (`slotCount` of them, or `slotsFor`). `star` is an index into the universe. */
export function activeAt(stars: number, t: number, slots: number = slotCount(stars)): Twinkling[] {
  return Array.from({ length: slots }, (_, j) => {
    const period = slotPeriod(j);
    const off = slotOffset(j);
    const k = Math.floor((t - off) / period);
    const start = off + k * period;
    const seed = {
      flip: hash(j, k, 3) < 0.5,
      ripple: 2 + Math.floor(hash(j, k, 4) * 2),
      phase: 2 * Math.PI * hash(j, k, 5),
    };
    return {
      slot: j,
      star: partitionPick(stars, slots, j, k),
      start,
      period,
      gain: twinkleGain((t - start) / period, seed),
    };
  });
}

// ---- Drawing --------------------------------------------------------------------------------

/**
 * The overlay pass over the plate's stars by identity: clear, then for each active star on this plate whose gain is off base, cover the baked star with the sky behind it and draw it again
 * at the gain. A star at base draws nothing.
 */
export function drawTwinkle(
  ctx: CanvasRenderingContext2D,
  stars: ReadonlyMap<number, Star>,
  active: readonly Twinkling[],
  w: number,
  h: number,
  scale: number
) {
  ctx.clearRect(0, 0, w, h);
  active.forEach((a) => {
    const s = stars.get(a.star);
    if (!s || Math.abs(a.gain - 1) < 0.01) return;
    ctx.fillStyle = s.cover;
    ctx.beginPath();
    ctx.arc(s.x * w, s.y * h, s.r * scale + 1, 0, 2 * Math.PI);
    ctx.fill();
    ctx.fillStyle = s.shade(a.gain);
    ctx.beginPath();
    ctx.arc(s.x * w, s.y * h, s.r * scale, 0, 2 * Math.PI);
    ctx.fill();
  });
}
