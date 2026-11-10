import React, { useEffect, useMemo, useRef } from 'react';
import { useClientConfig } from '../../hooks/useClientConfig';
import { getFallbackSession } from '../../state/sessions';
import { mountBackgroundScene } from './host';
import { readCapabilities, resolveTier } from './tier';
import { getSceneStyleOverride } from './sceneStyle';
import './sceneShell.css';
import './sceneButtons.css';

/** Set on <html> while a scene runs, so signed-out screens can let it show through. */
export const SCENE_ACTIVE_ATTRIBUTE = 'data-scene';

/**
 * The one host for the background scene, mounted once at the app root. Fixed behind everything
 * (z-index -1 sits above the body's background and below all normal content; the signed-out
 * screens and the signed-in shell, see sceneShell.css.ts, are clear so the scene shows through). The ridge scene
 * draws its layers into this wrapper beside the canvas, so the wrapper is the positioned box.
 * Tier 'off' renders nothing and loads nothing.
 */
export function BackgroundScene() {
  const configured = useClientConfig().backgroundScene;
  const config = useMemo(() => {
    const style = getSceneStyleOverride();
    return configured && style ? { ...configured, style } : configured;
  }, [configured]);
  const enabled = resolveTier(config, readCapabilities(navigator)) !== 'off';
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!enabled || !canvas) return undefined;
    const root = document.documentElement;
    const dispose = mountBackgroundScene(config, readCapabilities(navigator), canvas, {
      loggedIn: !!getFallbackSession(),
      onActive: () => root.setAttribute(SCENE_ACTIVE_ATTRIBUTE, ''),
      onInactive: () => root.removeAttribute(SCENE_ACTIVE_ATTRIBUTE),
      // eslint-disable-next-line no-console
      onFail: (e) => console.warn('Background scene unavailable:', e),
    });
    return () => {
      dispose();
      root.removeAttribute(SCENE_ACTIVE_ATTRIBUTE);
    };
  }, [config, enabled]);

  if (!enabled) return null;
  return (
    <div
      aria-hidden
      style={{ position: 'fixed', inset: 0, zIndex: -1, pointerEvents: 'none', overflow: 'hidden' }}
    >
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
    </div>
  );
}
