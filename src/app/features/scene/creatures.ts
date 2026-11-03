// Creature sizing for the orbiting personas. Only the rule lives here; drawing them is a later cut.
//
// Props contract: heimdall-body:follow_up:ratatoskr-creature-projection-v2 (against GameCult/Bifrost; supersedes heimdall-body/ratatoskr-creature-projection).
// Nothing here is binding until Bifrost's steward cuts that contract.
//
// Shape: {id, estate, neutral, activity} plus sizeBucket when neutral is false.
// Invariants:
//   - Exact vote weights stay in Bifrost; Ratatoskr only ever sees a bucket.
//   - neutral=true means Bifrost publishes no sizeBucket, no kind and no energy. A received value is
//     ignored, and a neutral creature is not drawn.
//   - A missing or unknown sizeBucket is not drawn either; no size is ever defaulted.
//   - activity comes from the Heimdall session.
// Consent: humans get a coarse bucket by default plus a typed opt-out; Minds and Personas may show finer buckets.
// Humans have three coarse buckets. The scales below (0.7 / 1 / 1.4) are placeholders, not fixed.

export type SizeBucket = 'small' | 'medium' | 'large';

export interface Creature {
  id: string;
  estate: string;
  /** Absent when neutral. Read it only through creatureScale. */
  sizeBucket?: SizeBucket;
  neutral: boolean;
  activity: 'idle' | 'active';
}

export const BUCKET_SCALE: Readonly<Record<SizeBucket, number>> = {
  small: 0.7,
  medium: 1,
  large: 1.4,
};

/** The draw scale, or null when nothing is drawn: a neutral creature, or a bucket that is absent or unknown. */
export function creatureScale(c: Pick<Creature, 'sizeBucket' | 'neutral'>): number | null {
  if (c.neutral || c.sizeBucket === undefined) return null;
  return Object.prototype.hasOwnProperty.call(BUCKET_SCALE, c.sizeBucket) ? BUCKET_SCALE[c.sizeBucket] : null;
}
