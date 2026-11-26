import React from 'react';
import { Icon, IconButton, Icons } from 'folds';
import { PhoneHit } from '../../styles/PhoneHit.css';
import { useSceneViewOffered } from '../../hooks/useSceneView';
import { loadSceneView, openSceneView } from './sceneView';

/**
 * The title-bar button that opens the scene view, the fullscreen view of the background scene with its own controls (sceneView.ts). A single button, not a
 * row, so the bar still fits a 320 px phone beside the search button. The view's code loads when the button is hovered or focused. Not offered when the
 * scene tier is off: there is no scene to look at.
 */
export function SceneViewEntry() {
  const offered = useSceneViewOffered();
  if (!offered) return null;
  const preload = () => {
    loadSceneView().catch(() => undefined); // a failed chunk is asked for again when the view opens (SceneViewHost)
  };
  return (
    <IconButton
      className={PhoneHit}
      variant="Background"
      aria-label="Scene view"
      title="Scene view"
      onMouseEnter={preload}
      onFocus={preload}
      onClick={openSceneView}
    >
      <Icon src={Icons.Photo} size="200" />
    </IconButton>
  );
}
