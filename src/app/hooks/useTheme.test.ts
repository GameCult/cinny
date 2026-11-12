import { beforeAll, describe, expect, it, vi } from 'vitest';

// settings.ts reads localStorage when it loads, and this suite runs without a DOM.
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined });
let chosenTheme: typeof import('./useTheme').chosenTheme;
let defaultThemeId: string;
beforeAll(async () => {
  ({ chosenTheme } = await import('./useTheme'));
  ({ defaultThemeId } = await import('../state/settings'));
});

describe('chosenTheme: what counts as a theme the person chose', () => {
  it('is not a theme before anything was picked: no id saved, or the default saved', () => {
    expect(chosenTheme(false, undefined, undefined)).toBe(false);
    expect(chosenTheme(false, defaultThemeId, undefined)).toBe(false);
    expect(chosenTheme(false, defaultThemeId, false)).toBe(false);
  });

  it('is a pick of Midnight Sky made in the theme menu, which sets the flag', () => {
    expect(chosenTheme(false, defaultThemeId, true)).toBe(true);
  });

  it('is a saved id other than the default, with or without the flag', () => {
    expect(chosenTheme(false, 'dark-theme', undefined)).toBe(true);
    expect(chosenTheme(false, 'noonday-sky', true)).toBe(true);
  });

  it('is the system scheme', () => {
    expect(chosenTheme(true, defaultThemeId, undefined)).toBe(true);
  });
});
