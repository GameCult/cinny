import React, { ReactNode, useEffect } from 'react';
import { configClass, varsClass } from 'folds';
import { DefaultTheme, ThemeContextProvider, useActiveTheme } from '../hooks/useTheme';
import { useSetting } from '../state/hooks/settings';
import { settingsAtom } from '../state/settings';
import { chromeColor } from '../../skyPalette';

// Browser chrome follows the sky at the top edge; the stock themes keep the static tag.
const setChromeColor = (themeId: string) => {
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', chromeColor(themeId));
};

export function UnAuthRouteThemeManager() {
  useEffect(() => {
    document.body.className = '';
    document.body.classList.add(configClass, varsClass);
    // Signed-out pages ignore the system scheme and wear the default sky.
    document.body.classList.add(...DefaultTheme.classNames);
    setChromeColor(DefaultTheme.id);
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
    setChromeColor(activeTheme.id);

    if (monochromeMode) {
      document.body.style.filter = 'grayscale(1)';
    } else {
      document.body.style.filter = '';
    }
  }, [activeTheme, monochromeMode]);

  return <ThemeContextProvider value={activeTheme}>{children}</ThemeContextProvider>;
}
