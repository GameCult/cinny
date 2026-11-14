// Which baked frames the live sun lies between, and how far. Pure. The frames are ordered by the sun elevation they were baked for, a
// morning half rising from the night key through dawn and morning to noon, an afternoon half falling from noon through golden and dusk
// to night; the two halves share noon and the night key. The half is the live sun's side of the noon frame's azimuth.
import type { Frame, FrameKey } from './manifest';

export interface FrameChoice {
  /** The frame shown at full opacity. */
  a: Frame;
  /** The frame blended over it at `w`, or null when one frame stands alone. */
  b: Frame | null;
  /** Weight of b in 0..1; 0 when b is null. */
  w: number;
}

/** Blends this close to either frame are not worth a second image. */
export const BLEND_EDGE = 0.02;

const MORNING: readonly FrameKey[] = ['night', 'dawn', 'morning', 'noon'];
const AFTERNOON: readonly FrameKey[] = ['night', 'dusk', 'golden', 'noon'];

export function frameChoice(
  frames: readonly Frame[],
  sun: { elevation: number; azimuth: number }
): FrameChoice {
  const by = (k: FrameKey): Frame => {
    const f = frames.find((x) => x.key === k);
    if (!f) throw new Error(`frameChoice: no ${k} frame`);
    return f;
  };
  const noon = by('noon');
  const half = (sun.azimuth < noon.sun.az ? MORNING : AFTERNOON).map(by);
  // Ascending in elevation along the half, whatever the bake's numbers: sort so a hand-made manifest cannot invert the order.
  half.sort((p, q) => p.sun.el - q.sun.el);
  const lowest = half[0];
  const highest = half[half.length - 1];
  if (sun.elevation <= lowest.sun.el) return { a: lowest, b: null, w: 0 };
  if (sun.elevation >= highest.sun.el) return { a: highest, b: null, w: 0 };
  let i = 0;
  while (half[i + 1].sun.el < sun.elevation) i += 1;
  const lo = half[i];
  const hi = half[i + 1];
  const w = (sun.elevation - lo.sun.el) / (hi.sun.el - lo.sun.el);
  if (w < BLEND_EDGE) return { a: lo, b: null, w: 0 };
  if (w > 1 - BLEND_EDGE) return { a: hi, b: null, w: 0 };
  return { a: lo, b: hi, w };
}
