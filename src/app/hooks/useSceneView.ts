import { useEffect, useState, useSyncExternalStore } from 'react';
import { getCamera, isHeld, subscribe as subscribeCamera } from '../features/scene/cameraState';
import type { CameraChoice } from '../features/scene/cameraState';
import { getSceneView, subscribeSceneView } from '../features/scene/sceneView';
import type { SceneViewState } from '../features/scene/sceneView';
import { getConstellationLines, subscribe as subscribeSky } from '../features/scene/skyState';
import { loadManifest } from '../features/scene/ridge/manifest';
import type { RidgeManifest } from '../features/scene/ridge/manifest';
import { readCapabilities, resolveTier } from '../features/scene/tier';
import { useClientConfig } from './useClientConfig';

/** Whether the scene view is open and which submenu is up (sceneView.ts). */
export const useSceneViewState = (): SceneViewState =>
  useSyncExternalStore(subscribeSceneView, getSceneView);

const onCamera = (cb: () => void): (() => void) => {
  const off = subscribeCamera(() => cb());
  return () => {
    off();
  };
};

/** The viewer's rotation mode, speed and offset (cameraState.ts). */
export const useCamera = (): CameraChoice => useSyncExternalStore(onCamera, getCamera);

/** Whether a manual turn holds the view (cameraState.ts): the rotation waits for a mode pick or Return. */
export const useCameraHeld = (): boolean => useSyncExternalStore(onCamera, isHeld);

/** Whether the constellation lines are on (skyState.ts). */
export const useConstellationLines = (): boolean =>
  useSyncExternalStore(subscribeSky, getConstellationLines);

/** The manifest of the configured place when the ridge scene is on and it has loaded (memoised by `loadManifest`, so this fetches nothing the scene did not). */
export function useRidgeManifest(): RidgeManifest | undefined {
  const config = useClientConfig().backgroundScene;
  const ridgeOn = !!config && config.style !== 'raymarch';
  const [manifest, setManifest] = useState<RidgeManifest>();
  useEffect(() => {
    if (!ridgeOn) return undefined;
    let live = true;
    loadManifest(import.meta.env.BASE_URL, config?.place).then(
      (m) => live && setManifest(m),
      () => live && setManifest(undefined)
    );
    return () => {
      live = false;
    };
  }, [ridgeOn, config?.place]);
  return ridgeOn ? manifest : undefined;
}

/** Whether the scene view is offered: the background scene is not switched off (tier). The one answer, for the entry and the host. */
export function useSceneViewOffered(): boolean {
  const config = useClientConfig().backgroundScene;
  return resolveTier(config, readCapabilities(navigator)) !== 'off';
}
