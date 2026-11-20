import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// settings.ts reads localStorage when it loads; these suites run without a DOM.
const store: Record<string, string> = {};
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => {
    store[k] = v;
  },
});
// Stored before settings.ts loads: a theme of the person's, and the themeChosen key old settings carry.
store['settings'] = JSON.stringify({
  themeId: 'dark-theme',
  useSystemTheme: false,
  themeChosen: true,
});
vi.stubGlobal('window', {
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
});
// The skyState hooks are useSyncExternalStore reads of these two sources; the server renderer needs a snapshot of
// each, so the hooks read the same stores directly.
vi.mock('./useSkyState', async () => {
  const drawn = await import('../features/scene/sceneDrawn');
  return {
    useResolvedSkyState: () => 'night',
    useSkyChoice: () => ({ kind: 'named', id: 'night' }),
    useSceneOn: () => drawn.getSceneDrawn(),
  };
});
// Style modules need a DOM to inject into; the class names are not what is under test.
vi.mock('folds', () => ({ lightTheme: 'light' }));
vi.mock('../../config.css', () => ({ onDarkFontWeight: 'dk', onLightFontWeight: 'lt' }));
vi.mock('../../colors.css', () => ({
  butterTheme: 'b',
  darkTheme: 'd',
  midnightSkyTheme: 'm',
  noondaySkyTheme: 'n',
  silverTheme: 's',
}));
vi.mock('../../gamecult.css', () => ({}));
vi.mock('../../sky.css', () => ({}));
vi.mock('./useScreenSize', () => ({
  ScreenSize: { Mobile: 'm' },
  useScreenSizeContext: () => 'd',
}));

let useActiveTheme: typeof import('./useTheme').useActiveTheme;
let useSceneInk: typeof import('./useTheme').useSceneInk;
let setSceneDrawn: typeof import('../features/scene/sceneDrawn').setSceneDrawn;
beforeAll(async () => {
  ({ useActiveTheme, useSceneInk } = await import('./useTheme'));
  ({ setSceneDrawn } = await import('../features/scene/sceneDrawn'));
});

const read = () => {
  let out = '';
  const Probe = () => {
    out = `${useActiveTheme().id}|${JSON.stringify(useSceneInk() ?? null)}`;
    return null;
  };
  renderToString(createElement(Probe));
  return out;
};

describe('the drawn sky decides the theme and ink; the stored theme stands where none is drawn', () => {
  beforeEach(() => {
    setSceneDrawn(false);
  });

  it('a scene running over a stored theme wears the sky theme and ink', () => {
    setSceneDrawn(true);
    expect(read()).toBe('midnight-sky|{"state":"night","phone":false}');
  });

  it('a scene that is not drawing (failed, or context lost) leaves the stored theme and its own ink', () => {
    expect(read()).toBe('dark-theme|null');
  });

  it('a restored context wears the sky again', () => {
    setSceneDrawn(true);
    setSceneDrawn(false);
    expect(read()).toBe('dark-theme|null');
    setSceneDrawn(true);
    expect(read()).toBe('midnight-sky|{"state":"night","phone":false}');
  });
});
