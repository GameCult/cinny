import { describe, expect, it } from 'vitest';
import { BUCKET_SCALE, creatureScale, NEUTRAL_SCALE, SizeBucket } from './creatures';

const buckets: SizeBucket[] = ['small', 'medium', 'large'];

describe('creature scale', () => {
  it('follows sizeBucket for a creature with an estate', () => {
    buckets.forEach((sizeBucket) =>
      expect(creatureScale({ sizeBucket, neutral: false })).toBe(BUCKET_SCALE[sizeBucket])
    );
  });

  it('draws nothing for a neutral creature, whatever sizeBucket it was sent', () => {
    expect(creatureScale({ neutral: true })).toBeNull();
    buckets.forEach((sizeBucket) => expect(creatureScale({ sizeBucket, neutral: true })).toBeNull());
  });

  it('does not crash or default to medium when a non-neutral creature has no sizeBucket', () => {
    expect(creatureScale({ neutral: false })).toBeNull();
    expect(creatureScale({ sizeBucket: undefined, neutral: false })).not.toBe(BUCKET_SCALE.medium);
  });

  it('draws nothing for an unknown bucket, including inherited property names', () => {
    expect(creatureScale({ sizeBucket: 'huge' as SizeBucket, neutral: false })).toBeNull();
    expect(creatureScale({ sizeBucket: 'toString' as SizeBucket, neutral: false })).toBeNull();
  });
});
