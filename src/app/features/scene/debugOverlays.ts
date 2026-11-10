import type { BackgroundSceneConfig } from './tier';

/**
 * Whether the page URL may switch on the scene's diagnostic overlays (`?probe=1` frame readout, `?tierlabel=1` path
 * label). Only a dev build, a demo preview build (VITE_PREVIEW_DEMO=1), or a config that says `debugOverlays: true`
 * allows it; a production visitor adding a query string gets nothing.
 */
export const debugOverlaysAllowed = (config: BackgroundSceneConfig | undefined): boolean =>
  import.meta.env?.DEV === true ||
  import.meta.env?.VITE_PREVIEW_DEMO === '1' ||
  config?.debugOverlays === true;

/** The page URL asks for this overlay (`?name=1`), and the overlays are allowed. */
export const overlayRequested = (name: 'probe' | 'tierlabel', allowed: boolean): boolean =>
  allowed && new URLSearchParams(window.location.search).get(name) === '1';
