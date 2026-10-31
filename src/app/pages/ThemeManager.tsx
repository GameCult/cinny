import React, { ReactNode, useEffect } from 'react';
import { configClass, varsClass } from 'folds';
import {
  GameCultTheme,
  ThemeContextProvider,
  useActiveTheme,
} from '../hooks/useTheme';
import { useSetting } from '../state/hooks/settings';
import { settingsAtom } from '../state/settings';

export function UnAuthRouteThemeManager() {
  useEffect(() => {
    document.body.className = '';
    document.body.classList.add(configClass, varsClass);
    // The GameCult identity is single-theme: signed-out pages ignore the system scheme.
    document.body.classList.add(...GameCultTheme.classNames);
  }, []);

  return null;
}

export function AuthRouteThemeManager({ children }: { children: ReactNode }) {
  const activeTheme = useActiveTheme();
  const [monochromeMode] = useSetting(settingsAtom, 'monochromeMode');

  useEffect(() => {
    document.body.className = '';
    document.body.classList.add(configClass, varsClass);

    document.body.classList.add(...activeTheme.classNames);

    if (monochromeMode) {
      document.body.style.filter = 'grayscale(1)';
    } else {
      document.body.style.filter = '';
    }
  }, [activeTheme, monochromeMode]);

  return <ThemeContextProvider value={activeTheme}>{children}</ThemeContextProvider>;
}
