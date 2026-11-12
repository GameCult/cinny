// Rain as one tiled texture of slanted streaks, drawn once and slid down by the compositor (a CSS animation on a transform: no per-frame
// script, no per-frame paint). Two tiles of different size and speed read as depth. The streaks wear the sky's own horizon colour, so
// whatever they lighten stays inside the state's luminance bounds (a streak is a blend of two colours the sky already has).
import { hash2 } from './noise';
import type { Srgb } from './skyColour';

export interface RainTile {
  /** Tile edge, canvas px. */
  size: number;
  /** Seconds for a tile to fall its own height. */
  seconds: number;
  /** Streaks per tile at rain 1. */
  streaks: number;
  /** Streak length, tile fractions. */
  length: number;
  /** Peak alpha. */
  alpha: number;
}

/** Far, fine and slow; near, long and quick. */
export const RAIN_TILES: readonly RainTile[] = [
  { size: 192, seconds: 0.9, streaks: 46, length: 0.16, alpha: 0.32 },
  { size: 320, seconds: 0.6, streaks: 22, length: 0.24, alpha: 0.42 },
];

/** Slant of a streak: pixels left per pixel down. */
export const RAIN_SLANT = 0.18;

/** Streaks to draw at a rain amount 0..1 (none at 0). */
export const streakCount = (t: RainTile, rain: number): number =>
  rain <= 0 ? 0 : Math.max(4, Math.round(t.streaks * rain));

/** Draw one tile. The streaks wrap across the tile's edges so the tile repeats without a seam. */
export function drawRainTile(
  ctx: CanvasRenderingContext2D,
  t: RainTile,
  rain: number,
  colour: Srgb,
  scale: number,
  seed = 0
): void {
  const n = streakCount(t, rain);
  ctx.clearRect(0, 0, t.size, t.size);
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1, scale);
  for (let i = 0; i < n; i += 1) {
    const x = hash2(i, seed + 3) * t.size;
    const y = hash2(i, seed + 7) * t.size;
    const len = t.length * t.size * (0.7 + 0.6 * hash2(i, seed + 11));
    const a = t.alpha * (0.5 + 0.5 * hash2(i, seed + 13)) * (0.5 + 0.5 * rain);
    ctx.strokeStyle = `rgba(${colour[0]},${colour[1]},${colour[2]},${a.toFixed(3)})`;
    // Draw each streak at its place and one tile over in each direction it can cross an edge.
    [-t.size, 0, t.size].forEach((ox) =>
      [-t.size, 0, t.size].forEach((oy) => {
        ctx.beginPath();
        ctx.moveTo(x + ox, y + oy);
        ctx.lineTo(x + ox - len * RAIN_SLANT, y + oy + len);
        ctx.stroke();
      })
    );
  }
}
