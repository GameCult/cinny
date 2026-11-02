import { describe, expect, it } from 'vitest';
import { resolveTier } from './tier';

describe('scene tier', () => {
  it('is off unless the config turns it on, which is the feature flag', () => {
    expect(resolveTier(undefined)).toBe('off');
    expect(resolveTier({})).toBe('off');
    expect(resolveTier({ tier: 'off' }, { deviceMemory: 16 })).toBe('off');
    expect(resolveTier({ tier: 'full' })).toBe('full');
  });

  it('lets the device lower the configured tier and never raise it', () => {
    expect(resolveTier({ tier: 'full' }, { saveData: true })).toBe('still');
    expect(resolveTier({ tier: 'full' }, { deviceMemory: 2 })).toBe('low');
    expect(resolveTier({ tier: 'full' }, { hardwareConcurrency: 4 })).toBe('low');
    expect(resolveTier({ tier: 'low' }, { saveData: true })).toBe('still');
    expect(resolveTier({ tier: 'still' }, { deviceMemory: 16, hardwareConcurrency: 16 })).toBe(
      'still'
    );
    expect(resolveTier({ tier: 'low' }, { deviceMemory: 16, hardwareConcurrency: 16 })).toBe('low');
  });

  it('treats unknown capabilities as capable', () => {
    expect(resolveTier({ tier: 'full' }, {})).toBe('full');
  });
});
