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
import { settingsAtom } from '../state/settings';
import { useSetting } from '../state/hooks/settings';
import { skyThemeId } from '../features/scene/skyTheme';
import { useResolvedSkyState } from './useSkyState';

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

/** The theme the sky being drawn asks for ('auto' asks for the one of the sky it resolves to). */
export const useSkyTheme = (): Theme | undefined => {
  const id = skyThemeId(useResolvedSkyState());
  return id === NoondaySkyTheme.id ? NoondaySkyTheme : id && MidnightSkyTheme;
};

export const useActiveTheme = (): Theme => {
  const skyTheme = useSkyTheme();
  const systemThemeKind = useSystemThemeKind();
  const themes = useThemes();
  const [systemTheme] = useSetting(settingsAtom, 'useSystemTheme');
  const [themeId] = useSetting(settingsAtom, 'themeId');
  const [lightThemeId] = useSetting(settingsAtom, 'lightThemeId');
  const [darkThemeId] = useSetting(settingsAtom, 'darkThemeId');

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
