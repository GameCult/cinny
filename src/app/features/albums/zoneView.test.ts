import { describe, expect, it } from 'vitest';
import { zoneView } from './zoneView';

describe('zoneView', () => {
  it('opens albums by default and the timeline for an event deep link', () => {
    expect(zoneView(undefined, undefined)).toBe('albums');
    expect(zoneView(undefined, '$e')).toBe('timeline');
  });
  it('lets an event link win over an earlier choice of albums', () => {
    expect(zoneView('albums', '$e')).toBe('timeline');
  });
  it('honours the choice when there is no event link', () => {
    expect(zoneView('albums', undefined)).toBe('albums');
    expect(zoneView('timeline', undefined)).toBe('timeline');
  });
});
