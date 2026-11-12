import React, { useCallback, useEffect, useState } from 'react';
import { Switch, Text, color } from 'folds';
import { SettingTile } from '../../components/setting-tile';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { getNotificationState, usePermissionState } from '../../hooks/usePermission';
import type { ActivePushConfig } from './config';
import { disablePush, enablePush } from './pusher';

export const pushSupported = (): boolean =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

const readyManager = async () => (await navigator.serviceWorker.ready).pushManager;

/** Background notifications through the installed app's service worker. The caller renders it only when the host's config fills the push block and the browser can. */
export function PushNotification({ cfg }: { cfg: ActivePushConfig }) {
  const mx = useMatrixClient();
  const permission = usePermissionState('notifications', getNotificationState());
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    readyManager()
      .then((m) => m.getSubscription())
      .then((s) => setOn(!!s))
      .catch(() => undefined);
  }, [cfg]);

  const toggle = useCallback(
    async (enable: boolean) => {
      setBusy(true);
      setError(undefined);
      try {
        if (enable) {
          if ((await window.Notification.requestPermission()) !== 'granted') {
            throw new Error('Notification permission was not granted.');
          }
          await enablePush(mx, await readyManager(), cfg, navigator.userAgent.slice(0, 64));
        } else {
          await disablePush(mx, await readyManager(), cfg);
        }
        setOn(enable);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not change background notifications.');
      } finally {
        setBusy(false);
      }
    },
    [cfg, mx]
  );

  return (
    <SettingTile
      title="Background Notifications"
      description={
        error || permission === 'denied' ? (
          <Text as="span" style={{ color: color.Critical.Main }} size="T200">
            {error ?? 'Notification permission is blocked. Allow it from the browser address bar.'}
          </Text>
        ) : (
          <span>
            Notify when the app is closed. Installing the app to the home screen helps on iOS.
          </span>
        )
      }
      after={<Switch disabled={busy || permission === 'denied'} value={on} onChange={toggle} />}
    />
  );
}
