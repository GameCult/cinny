import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useClientConfig } from '../../hooks/useClientConfig';
import { trimTrailingSlash } from '../../utils/common';
import { getMxIdLocalPart } from '../../utils/matrix';
import {
  DingManifest,
  Motif,
  createDingPlayer,
  dingsEnabled,
  parseManifest,
  pickDing,
} from './dings';

const DINGS_ROOT = `${trimTrailingSlash(import.meta.env.BASE_URL)}/public/dings`;

/**
 * Plays a ding for a sender and motif. The manifest is read once at runtime. Returns false when
 * there is no manifest (nothing rendered yet), so the caller keeps the stock sound; once there is
 * one, a sender or motif with no clip is silence, as the design says, and the return is true.
 * The client config's `dings.enabled` is the switch (default off): off, nothing is fetched, no
 * gesture listener is added, and the return is always false, so the stock sound plays.
 */
export const useDings = () => {
  const enabled = dingsEnabled(useClientConfig().dings);
  const manifestRef = useRef<DingManifest>();
  const player = useMemo(
    () => (enabled ? createDingPlayer((url) => new Audio(url), window) : undefined),
    [enabled]
  );

  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    fetch(`${DINGS_ROOT}/manifest.json`)
      .then((r) => (r.ok ? r.json() : undefined))
      .then((json) => {
        if (live) manifestRef.current = parseManifest(json);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [enabled]);

  return useCallback(
    (sender: string, motif: Motif): boolean => {
      const manifest = manifestRef.current;
      if (!player || !manifest) return false;
      const ding = pickDing(manifest, getMxIdLocalPart(sender) ?? sender, motif);
      if (ding) player.play(`${DINGS_ROOT}/${ding.path}`, ding.volume);
      return true;
    },
    [player]
  );
};
