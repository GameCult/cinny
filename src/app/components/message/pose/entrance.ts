import { useState } from 'react';

// A message animates in the first time it is shown, not each time the virtualised timeline
// remounts it. Messages mounting together are staggered so a screenful does not pop at once.
const STEP_MS = 300;
const MAX_DELAY_MS = 900;
const SEEN_CAP = 2000;

const seen = new Set<string>();
let nextSlot = 0;

export const claimEntrance = (id: string, now: number): number | undefined => {
  if (seen.has(id)) return undefined;
  if (seen.size >= SEEN_CAP) seen.clear();
  seen.add(id);
  const start = Math.max(nextSlot, now);
  nextSlot = Math.min(start + STEP_MS, now + MAX_DELAY_MS);
  return Math.min(start - now, MAX_DELAY_MS);
};

export const useEntranceDelay = (id: string | undefined): number | undefined =>
  useState(() => (id ? claimEntrance(id, performance.now()) : undefined))[0];
