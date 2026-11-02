// Creature sizing for the orbiting personas. Only the rule lives here; drawing them is a later cut.

export type SizeBucket = 'small' | 'medium' | 'large';

export interface Creature {
  id: string;
  estate: string;
  sizeBucket: SizeBucket;
  /** A neutral creature (no estate allegiance) is drawn at one fixed size whatever its bucket. */
  neutral: boolean;
  activity: 'idle' | 'active';
}

export const BUCKET_SCALE: Readonly<Record<SizeBucket, number>> = {
  small: 0.7,
  medium: 1,
  large: 1.4,
};

/** Neutral creatures are medium sized, not necessarily their bucket's size. */
export const NEUTRAL_SCALE = BUCKET_SCALE.medium;

/** Neutral overrides sizeBucket. */
export function creatureScale(c: Pick<Creature, 'sizeBucket' | 'neutral'>): number {
  return c.neutral ? NEUTRAL_SCALE : BUCKET_SCALE[c.sizeBucket];
}
