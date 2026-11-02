import { describe, expect, it } from 'vitest';
import { BUCKET_SCALE, creatureScale, NEUTRAL_SCALE, SizeBucket } from './creatures';

const buckets: SizeBucket[] = ['small', 'medium', 'large'];

describe('creature scale', () => {
  it('follows sizeBucket for a creature with an estate', () => {
    buckets.forEach((sizeBucket) =>
      expect(creatureScale({ sizeBucket, neutral: false })).toBe(BUCKET_SCALE[sizeBucket])
    );
  });

  it('is one fixed size for every neutral creature, whatever its sizeBucket', () => {
    buckets.forEach((sizeBucket) =>
      expect(creatureScale({ sizeBucket, neutral: true })).toBe(NEUTRAL_SCALE)
    );
  });

  it('is only visible as an override where the bucket would have said something else', () => {
    expect(BUCKET_SCALE.small).not.toBe(NEUTRAL_SCALE);
    expect(BUCKET_SCALE.large).not.toBe(NEUTRAL_SCALE);
  });
});
