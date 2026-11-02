import type { ActivityFrame, Size } from './frame';

/** Placeholders owned by the orbit renderer, not the frame (grammar, Estate section). Unmeasured. */
export const PLACEHOLDER_SIZE_SCALE: Record<Size, number> = { S: 0.7, M: 1, L: 1.4 };

/** O1: a neutral participant gets no orbit. There is no neutral pose; it is not in the list. */
export const drawnCreatures = (frames: readonly ActivityFrame[]): ActivityFrame[] =>
  frames.filter((f) => !f.neutral);
