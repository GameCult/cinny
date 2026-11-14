import { describe, expect, it } from 'vitest';
import { inkContrast, themeInk } from './frameLuma';
import { luminance } from '../../../../sky/skyTokens.js';

describe('inkContrast', () => {
  it('reads the ink from the themes: dark Noonday ink by day and dusk, light Midnight ink at night', () => {
    expect(themeInk('day')).toBe('#342d25');
    expect(themeInk('dusk')).toBe('#342d25');
    expect(themeInk('night')).toBe('#aeccff');
  });

  it('gives the known ratios on a white and on a black ridge', () => {
    const dark = luminance('#342d25');
    const light = luminance('#aeccff');
    const day = inkContrast({ min: 1, max: 1 }, 'day');
    expect(day.atMax).toBeCloseTo(1.05 / (dark + 0.05), 10);
    expect(day.atMax).toBeCloseTo(13.6, 0);
    const night = inkContrast({ min: 0, max: 0 }, 'night');
    expect(night.atMin).toBeCloseTo((light + 0.05) / 0.05, 10);
    expect(night.atMin).toBeCloseTo(12.9, 0);
  });

  it('the worst contrast is where the range comes closest to the ink', () => {
    const ink = luminance('#342d25');
    const across = inkContrast({ min: 0, max: 1 }, 'day');
    expect(across.worst).toBe(1);
    expect(inkContrast({ min: ink + 0.2, max: 0.9 }, 'day').worst).toBeCloseTo(
      (ink + 0.2 + 0.05) / (ink + 0.05),
      10
    );
  });
});
