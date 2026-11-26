import React, { ComponentType, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon, IconButton, Icons } from 'folds';
import { PhoneHit } from '../../styles/PhoneHit.css';
import { useSceneViewOffered, useSceneViewState } from '../../hooks/useSceneView';
import { closeSceneView, loadSceneViewOrClose, restoreEntryFocus } from './sceneView';
import * as css from './sceneShell.css';

/**
 * What stands in the portal while the view's code loads: Return and Escape, so the view can be left before the rest of it is there. The app behind is hidden
 * and inert already, so without this the screen is blank.
 */
export function SceneViewLoading() {
  useEffect(() => {
    const onKey = (evt: KeyboardEvent) => {
      if (evt.key === 'Escape') {
        evt.stopPropagation();
        closeSceneView();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <IconButton
      className={`${PhoneHit} ${css.LoadingReturn}`}
      variant="Background"
      aria-label="Return"
      title="Return"
      autoFocus
      onClick={closeSceneView}
    >
      <Icon src={Icons.ArrowLeft} size="200" />
    </IconButton>
  );
}

/**
 * The scene view (sceneView.ts) in the portal layer while it is open: over the scene, outside the app it hides. Its code is a chunk of its own: until it has
 * loaded, `SceneViewLoading` is what is shown, and a failed load closes the view (`loadSceneViewOrClose`). The view is not offered with the scene tier off, so an
 * open view that finds the tier off closes.
 */
export function SceneViewHost() {
  const { open } = useSceneViewState();
  const offered = useSceneViewOffered();
  const [view, setView] = useState<{ View: ComponentType } | undefined>();
  const shown = open && offered;

  // The view is gone from the page (its focus trap with it) once `open` is false: only now can the entry take the focus and keep it.
  useEffect(() => {
    if (!open) restoreEntryFocus();
  }, [open]);

  useEffect(() => {
    if (open && !offered) closeSceneView();
  }, [open, offered]);

  useEffect(() => {
    if (!shown) return undefined;
    let live = true;
    loadSceneViewOrClose().then((m) => {
      if (live && m) setView({ View: m.default });
    });
    return () => {
      live = false;
    };
  }, [shown]);

  const portal = document.getElementById('portalContainer');
  if (!shown || !portal) return null;
  return createPortal(view ? <view.View /> : <SceneViewLoading />, portal);
}
