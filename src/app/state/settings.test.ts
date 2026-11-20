import { describe, expect, it, vi } from 'vitest';

const stored = JSON.stringify({ themeId: 'dark-theme', themeChosen: true });
vi.stubGlobal('localStorage', { getItem: () => stored, setItem: () => undefined });

describe('settings load', () => {
  it('tolerates a themeChosen key stored by an older build: the rest loads, the key is inert', async () => {
    const { getSettings, defaultThemeId } = await import('./settings');
    const s = getSettings() as unknown as Record<string, unknown>;
    expect(s.themeId).toBe('dark-theme');
    expect(s.useSystemTheme).toBe(false);
    expect(defaultThemeId).toBeDefined();
  });
});
