// The Midnight starfield: placed once from a seeded PRNG and baked once into the sky canvas. A
// rolling window of them twinkles on an overlay canvas: SLOTS slots, each running back-to-back
// twinkles of one star at a time, so the active set is always SLOTS stars and every star gets its turn.
// The schedule is a pure function of (seed, time): no state accumulates and no Math.random runs
// after the field is built, so any instant maps straight to the active set and its brightnesses.

/* eslint-disable no-bitwise -- the seeded PRNG and hash are 32-bit integer arithmetic */
import type { SkyColours, Srgb } from './skyColour';

/**
 * Stars show when the sky behind them is darker than this sRGB luma (0..255). The ridge scene has
 * no night flag (the sky theme's Midnight/Noonday is a body class chosen by the app, not seen here),
 * so night is the sky's own darkness: a star's alpha is 1 - luma/NIGHT_LUMA at its height in the
 * gradient, and a sky whose zenith is lighter than this gets no stars at all.
 */
export const NIGHT_LUMA = 110;
/** The sky gradient runs from the top (0) through mid (0.5) to the horizon glow (0.78 and below). */
export const SKY_STOPS = { mid: 0.5, horizon: 0.78 };
export const MAX_STARS = 400;
/** Twinkling stars at any instant (fewer only if the field has fewer stars). */
export const SLOTS = 32;
export const TWINKLE_PERIOD = { min: 2, max: 7 } as const;
/** Gain at the dimmest and brightest swing: dimming goes deeper than brightening. */
export const TWINKLE_GAIN = { dim: 0.35, bright: 1.15 } as const;
const SEED = 0x57a45eed;

export interface Star {
  /** Position as fractions of the sky canvas width and height. */
  x: number;
  y: number;
  /** Radius in CSS px. */
  r: number;
  /** Base alpha 0..0.9 (brightness times how dark the sky is there). */
  alpha: number;
  /** CSS colour, white tinted blue or warm. */
  fill: string;
  /** The sky gradient's colour at this height: dimming paints it over the baked star. */
  cover: string;
}

const luma = (c: Srgb) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** The baked gradient's colour at fraction t of the canvas height (the canvas interpolates in sRGB). */
function skyAt(sky: SkyColours, t: number): Srgb {
  const mix = (a: Srgb, b: Srgb, k: number): Srgb => [
    Math.round(lerp(a[0], b[0], k)),
    Math.round(lerp(a[1], b[1], k)),
    Math.round(lerp(a[2], b[2], k)),
  ];
  if (t <= SKY_STOPS.mid) return mix(sky.top, sky.mid, t / SKY_STOPS.mid);
  if (t <= SKY_STOPS.horizon)
    return mix(sky.mid, sky.horizon, (t - SKY_STOPS.mid) / (SKY_STOPS.horizon - SKY_STOPS.mid));
  return sky.horizon;
}

export const skyLuma = (sky: SkyColours, t: number): number => luma(skyAt(sky, t));
export const isNight = (sky: SkyColours): boolean => luma(sky.top) < NIGHT_LUMA;

/** mulberry32: 32-bit seeded PRNG, one float in [0, 1) per call. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stateless seeded hash of up to three integers to [0, 1). */
export function hash(a: number, b = 0, c = 0): number {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ SEED;
  h = Math.imul(h ^ (h >>> 15) ^ Math.imul(b | 0, 0x85ebca6b), 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 13) ^ Math.imul(c | 0, 0x27d4eb2f), 0x165667b1);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** How many stars a viewport carries: about one per 1100 CSS px squared, 150..MAX_STARS. */
export const starCount = (cssW: number, cssH: number): number =>
  Math.min(MAX_STARS, Math.max(150, Math.round((cssW * cssH) / 1100)));

/**
 * Seeded placement. Each candidate draws all its random numbers whether it is kept or not, so a
 * given seed and sky always give the same field and the prefix does not shift with the count.
 * Heights are squeezed toward the zenith (y = 0.78 u^1.7) and alpha falls with the sky's luma, so
 * the stars thin out and fade into the horizon glow. None for a day sky.
 */
export function makeStars(sky: SkyColours, cssW: number, cssH: number): Star[] {
  if (!isNight(sky)) return [];
  const rnd = prng(SEED);
  const n = starCount(cssW, cssH);
  // Every candidate draws all its numbers, kept or not, so the prefix is stable.
  const candidates = Array.from({ length: MAX_STARS }, () => ({
    x: rnd(),
    y: SKY_STOPS.horizon * rnd() ** 1.7,
    r: 0.35 + 1.0 * rnd() ** 4,
    bright: 0.35 + 0.65 * rnd() ** 1.5,
    tint: rnd(),
  })).slice(0, n);
  return candidates.flatMap(({ x, y, r, bright, tint }) => {
    const alpha = Math.min(0.9, bright * Math.max(0, 1 - skyLuma(sky, y) / NIGHT_LUMA));
    if (alpha < 0.05) return [];
    // White, pulled toward blue or toward warm by the tint draw.
    const to: Srgb = tint < 0.5 ? [165, 195, 255] : [255, 222, 185];
    const k = 0.55 * Math.abs(tint - 0.5) * 2;
    const c = [255, 255, 255].map((v, j) => Math.round(lerp(v, to[j], k)));
    const s = skyAt(sky, y);
    return [
      {
        x,
        y,
        r,
        alpha,
        fill: `rgb(${c[0]},${c[1]},${c[2]})`,
        cover: `rgb(${s[0]},${s[1]},${s[2]})`,
      },
    ];
  });
}

// ---- The schedule ---------------------------------------------------------------------------

export const slotCount = (stars: number): number => Math.min(SLOTS, stars);
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

/** The active set at time `t` seconds for a field of `stars` stars, in slot order. */
export function activeAt(stars: number, t: number): Twinkling[] {
  const slots = slotCount(stars);
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

/** Bake `stars` into `ctx` (canvas `w` x `h` device px, `scale` device px per CSS px) at base alpha. */
export function drawStars(
  ctx: CanvasRenderingContext2D,
  stars: readonly Star[],
  w: number,
  h: number,
  scale: number
) {
  stars.forEach((s) => {
    ctx.globalAlpha = s.alpha;
    ctx.fillStyle = s.fill;
    ctx.beginPath();
    ctx.arc(s.x * w, s.y * h, s.r * scale, 0, 2 * Math.PI);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
}

/**
 * The overlay pass: clear, then for each active star whose gain is off base, paint over the baked
 * star. Dimming covers it with the sky's own colour at (1 - gain), which leaves exactly
 * alpha * gain of the star; brightening adds a second star on top. A star at base draws nothing.
 */
export function drawTwinkle(
  ctx: CanvasRenderingContext2D,
  stars: readonly Star[],
  active: readonly Twinkling[],
  w: number,
  h: number,
  scale: number
) {
  ctx.clearRect(0, 0, w, h);
  active.forEach((a) => {
    const s = stars[a.star];
    if (!s || Math.abs(a.gain - 1) < 0.01) return;
    if (a.gain < 1) {
      ctx.globalAlpha = 1 - a.gain;
      ctx.fillStyle = s.cover;
    } else {
      ctx.globalAlpha = Math.min(1, ((a.gain - 1) * s.alpha) / (1 - s.alpha));
      ctx.fillStyle = s.fill;
    }
    ctx.beginPath();
    ctx.arc(s.x * w, s.y * h, s.r * scale + (a.gain < 1 ? 1 : 0), 0, 2 * Math.PI);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
}
