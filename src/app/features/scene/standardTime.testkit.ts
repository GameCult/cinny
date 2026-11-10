import { standardOffsetMinutes } from './skyState';

/** 22 September 2026 at h:m of local solar time as the sky clock reads it (standard time, whatever daylight saving says). */
export const atStandardTime = (h: number, m = 0): Date => {
  const probe = new Date(2026, 8, 22);
  return new Date(Date.UTC(2026, 8, 22, h, m) + standardOffsetMinutes(probe) * 60000);
};
