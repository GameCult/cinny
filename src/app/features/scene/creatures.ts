// Creature sizing for the orbiting personas. Only the rule lives here; drawing them is a later cut.
//
// Props contract: heimdall-body/ratatoskr-creature-projection (against GameCult/Bifrost).
// Nothing here is binding until Bifrost's steward cuts that contract.
//
// Shape: {id, estate, sizeBucket, neutral, activity}.
// Invariants:
//   - Exact vote weights stay in Bifrost; Ratatoskr only ever sees a bucket.
//   - neutral=true overrides any bucket, and no size is drawn.
//   - activity comes from the Heimdall session.
// Consent: humans get a coarse bucket by default plus a typed opt-out; Minds and Personas may show finer buckets.
// Humans have three coarse buckets. The scales below (0.7 / 1 / 1.4) are placeholders, not fixed.

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
