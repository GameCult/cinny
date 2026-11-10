import React, { ReactNode, useEffect } from 'react';
import { configClass, varsClass } from 'folds';
import {
  MidnightSkyTheme,
  ThemeContextProvider,
  useActiveTheme,
  useSkyTheme,
} from '../hooks/useTheme';
import { useSetting } from '../state/hooks/settings';
import { settingsAtom } from '../state/settings';

export function UnAuthRouteThemeManager() {
  // Signed-out pages are Midnight Sky unless the sky state picks otherwise; they ignore the
  // system scheme.
  const theme = useSkyTheme() ?? MidnightSkyTheme;

  useEffect(() => {
    document.body.className = '';
    document.body.classList.add(configClass, varsClass);
    document.body.classList.add(...theme.classNames);
  }, [theme]);

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
