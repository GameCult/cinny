import { describe, expect, it } from 'vitest';
import { zoneView } from './zoneView';

describe('zoneView', () => {
  it('opens albums by default and the timeline for an event deep link', () => {
    expect(zoneView(undefined, undefined)).toBe('albums');
    expect(zoneView(undefined, '$e')).toBe('timeline');
  });
  it('lets the user go back to albums or on to the timeline whatever the link said', () => {
    expect(zoneView('albums', '$e')).toBe('albums');
    expect(zoneView('timeline', undefined)).toBe('timeline');
  });
});
