import React, { ReactNode, useEffect } from 'react';
import { configClass, varsClass } from 'folds';
import {
  MidnightSkyTheme,
  SkyInkContextProvider,
  ThemeContextProvider,
  useActiveTheme,
  useSceneInk,
  useSkyTheme,
} from '../hooks/useTheme';
import { useSetting } from '../state/hooks/settings';
import { settingsAtom } from '../state/settings';
import { labelInk } from '../features/scene/skyInk';
import { SKY_LABEL_INK } from '../features/scene/sceneShell.css';

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
  const skyInk = useSceneInk();
  const labels = skyInk && labelInk(skyInk);

  // The sky's label ink where it differs from the theme's (skyInk.ts); unset, the theme's ink stands.
  useEffect(() => {
    const root = document.documentElement;
    if (labels) root.style.setProperty(SKY_LABEL_INK, labels);
    else root.style.removeProperty(SKY_LABEL_INK);
    return () => {
      root.style.removeProperty(SKY_LABEL_INK);
    };
  }, [labels]);

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

  return (
    <ThemeContextProvider value={activeTheme}>
      <SkyInkContextProvider value={skyInk}>{children}</SkyInkContextProvider>
    </ThemeContextProvider>
  );
}
