import { lightTheme } from 'folds';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { onDarkFontWeight, onLightFontWeight } from '../../config.css';
import {
  butterTheme,
  darkTheme,
  midnightSkyTheme,
  noondaySkyTheme,
  silverTheme,
} from '../../colors.css';
import '../../gamecult.css';
import '../../sky.css';
import { defaultThemeId, settingsAtom } from '../state/settings';
import { useSetting } from '../state/hooks/settings';
import { sceneThemeId } from '../features/scene/skyTheme';
import { sceneInk, type SkyInk } from '../features/scene/skyInk';
import { useResolvedSkyState, useSceneOn, useSkyState } from './useSkyState';
import { ScreenSize, useScreenSizeContext } from './useScreenSize';

export enum ThemeKind {
  Light = 'light',
  Dark = 'dark',
}

export type Theme = {
  id: string;
  kind: ThemeKind;
  classNames: string[];
};

export const LightTheme: Theme = {
  id: 'light-theme',
  kind: ThemeKind.Light,
  classNames: [lightTheme, onLightFontWeight, 'prism-light'],
};

export const SilverTheme: Theme = {
  id: 'silver-theme',
  kind: ThemeKind.Light,
  classNames: ['silver-theme', silverTheme, onLightFontWeight, 'prism-light'],
};
export const DarkTheme: Theme = {
  id: 'dark-theme',
  kind: ThemeKind.Dark,
  classNames: ['dark-theme', darkTheme, onDarkFontWeight, 'prism-dark'],
};
export const ButterTheme: Theme = {
  id: 'butter-theme',
  kind: ThemeKind.Dark,
  classNames: ['butter-theme', butterTheme, onDarkFontWeight, 'prism-dark'],
};

export const MidnightSkyTheme: Theme = {
  id: 'midnight-sky',
  kind: ThemeKind.Dark,
  classNames: ['gamecult-theme', 'midnight-sky', midnightSkyTheme, onDarkFontWeight, 'prism-dark'],
};

export const NoondaySkyTheme: Theme = {
  id: 'noonday-sky',
  kind: ThemeKind.Light,
  classNames: ['gamecult-theme', 'noonday-sky', noondaySkyTheme, onLightFontWeight, 'prism-light'],
};

export const useThemes = (): Theme[] => {
  const themes: Theme[] = useMemo(
    () => [MidnightSkyTheme, NoondaySkyTheme, LightTheme, SilverTheme, DarkTheme, ButterTheme],
    []
  );

  return themes;
};

export const useThemeNames = (): Record<string, string> =>
  useMemo(
    () => ({
      [MidnightSkyTheme.id]: 'Midnight Sky',
      [NoondaySkyTheme.id]: 'Noonday Sky',
      [LightTheme.id]: 'Light',
      [SilverTheme.id]: 'Silver',
      [DarkTheme.id]: 'Dark',
      [ButterTheme.id]: 'Butter',
    }),
    []
  );

export const useSystemThemeKind = (): ThemeKind => {
  const darkModeQueryList = useMemo(() => window.matchMedia('(prefers-color-scheme: dark)'), []);
  const [themeKind, setThemeKind] = useState<ThemeKind>(
    darkModeQueryList.matches ? ThemeKind.Dark : ThemeKind.Light
  );

  useEffect(() => {
    const handleMediaQueryChange = () => {
      setThemeKind(darkModeQueryList.matches ? ThemeKind.Dark : ThemeKind.Light);
    };

    darkModeQueryList.addEventListener('change', handleMediaQueryChange);
    return () => {
      darkModeQueryList.removeEventListener('change', handleMediaQueryChange);
    };
  }, [darkModeQueryList, setThemeKind]);

  return themeKind;
};

const toTheme = (id: ReturnType<typeof sceneThemeId>): Theme | undefined =>
  id === NoondaySkyTheme.id ? NoondaySkyTheme : id && MidnightSkyTheme;

/**
 * A theme the person chose: the system scheme, any pick made in the theme menu (`themeChosen`, which also covers
 * Midnight Sky, the default), or a saved id other than the default (picks from before the flag existed).
 */
export const chosenTheme = (useSystemTheme: boolean, themeId?: string, themeChosen?: boolean) =>
  useSystemTheme || themeChosen === true || (themeId !== undefined && themeId !== defaultThemeId);

/** The theme the sky asks for on a page with no theme of its own (signed out), or undefined for none. */
export const useSkyTheme = (): Theme | undefined =>
  toTheme(sceneThemeId(useSkyState(), useResolvedSkyState(), useSceneOn(), false));

/** The sky theme the signed-in page wears, or undefined when the person's own theme wins. */
const useSceneSkyThemeId = (): ReturnType<typeof sceneThemeId> => {
  const sky = useSkyState();
  const resolved = useResolvedSkyState();
  const sceneOn = useSceneOn();
  const [systemTheme] = useSetting(settingsAtom, 'useSystemTheme');
  const [themeId] = useSetting(settingsAtom, 'themeId');
  const [themeChosen] = useSetting(settingsAtom, 'themeChosen');
  // A person's own theme wins over the sky, fixed or 'auto'.
  return sceneThemeId(sky, resolved, sceneOn, chosenTheme(systemTheme, themeId, themeChosen));
};

/** The ink the page wears over the scene (`sceneInk`, skyInk.ts), or undefined when the theme's own ink stands. */
export const useSceneInk = (): SkyInk | undefined => {
  const themeId = useSceneSkyThemeId();
  const state = useResolvedSkyState();
  const sceneOn = useSceneOn();
  const phone = useScreenSizeContext() === ScreenSize.Mobile;
  return useMemo(() => sceneInk(themeId, sceneOn, state, phone), [themeId, sceneOn, state, phone]);
};

const SkyInkContext = createContext<SkyInk | undefined>(undefined);
export const SkyInkContextProvider = SkyInkContext.Provider;
/** The ink for this sky state and viewport (provided once by the theme manager), or undefined for the theme's own. */
export const useSkyInk = (): SkyInk | undefined => useContext(SkyInkContext);

export const useActiveTheme = (): Theme => {
  const systemThemeKind = useSystemThemeKind();
  const themes = useThemes();
  const [systemTheme] = useSetting(settingsAtom, 'useSystemTheme');
  const [themeId] = useSetting(settingsAtom, 'themeId');
  const [lightThemeId] = useSetting(settingsAtom, 'lightThemeId');
  const [darkThemeId] = useSetting(settingsAtom, 'darkThemeId');
  const skyTheme = toTheme(useSceneSkyThemeId());

  if (skyTheme) return skyTheme;

  if (!systemTheme) {
    const selectedTheme = themes.find((theme) => theme.id === themeId) ?? MidnightSkyTheme;

    return selectedTheme;
  }

  const selectedTheme =
    systemThemeKind === ThemeKind.Dark
      ? themes.find((theme) => theme.id === darkThemeId) ?? MidnightSkyTheme
      : themes.find((theme) => theme.id === lightThemeId) ?? NoondaySkyTheme;

  return selectedTheme;
};

const ThemeContext = createContext<Theme | null>(null);
export const ThemeContextProvider = ThemeContext.Provider;

export const useTheme = (): Theme => {
  const theme = useContext(ThemeContext);
  if (!theme) {
    throw new Error('No theme provided!');
  }

  return theme;
};
