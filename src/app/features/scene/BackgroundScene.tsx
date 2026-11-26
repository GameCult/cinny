import React, { useEffect, useRef } from 'react';
import { useClientConfig } from '../../hooks/useClientConfig';
import { getFallbackSession } from '../../state/sessions';
import { mountBackgroundScene } from './host';
import { setSceneDrawn } from './sceneDrawn';
import { SceneViewHost } from './SceneViewHost';
import { readCapabilities, resolveTier } from './tier';
import './sceneShell.css';
import './sceneButtons.css';

/**
 * The one host for the background scene, mounted once at the app root. Fixed behind everything
 * (z-index -1 sits above the body's background and below all normal content; the signed-out
 * screens and the signed-in shell, see sceneShell.css.ts, are clear so the scene shows through). The ridge scene
 * draws its layers into this wrapper beside the canvas, so the wrapper is the positioned box.
 * Tier 'off' renders no scene and loads none; the scene view's host is here too, since the view is an overlay over this scene.
 */
export function BackgroundScene() {
  const config = useClientConfig().backgroundScene;
  const enabled = resolveTier(config, readCapabilities(navigator)) !== 'off';
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!enabled || !canvas) return undefined;
    const dispose = mountBackgroundScene(config, readCapabilities(navigator), canvas, {
      loggedIn: !!getFallbackSession(),
      onActive: (sky) => setSceneDrawn(true, sky),
      onInactive: () => setSceneDrawn(false),
      // eslint-disable-next-line no-console
      onFail: (e) => console.warn('Background scene unavailable:', e),
    });
    return () => {
      dispose();
      setSceneDrawn(false);
    };
  }, [config, enabled]);

  return (
    <>
      {enabled && (
        <div
          aria-hidden
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: -1,
            pointerEvents: 'none',
            overflow: 'hidden',
            visibility: 'visible', // the scene is what the scene view shows: it stays when the app (#root, its ancestor) is hidden
          }}
        >
          <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
        </div>
      )}
      <SceneViewHost />
    </>
  );
}
