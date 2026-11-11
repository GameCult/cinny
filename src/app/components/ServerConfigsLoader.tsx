import { ReactNode, useCallback, useMemo } from 'react';
import {
  Capabilities,
  MatrixClient,
  validateAuthMetadata,
  ValidatedAuthMetadata,
} from 'matrix-js-sdk';
import { AsyncStatus, useAsyncCallbackValue } from '../hooks/useAsyncCallback';
import { useMatrixClient } from '../hooks/useMatrixClient';
import { MediaConfig } from '../hooks/useMediaConfig';
import { promiseFulfilledResult } from '../utils/common';

export type ServerConfigs = {
  capabilities?: Capabilities;
  mediaConfig?: MediaConfig;
  authMetadata?: ValidatedAuthMetadata;
};

type ServerConfigsLoaderProps = {
  children: (configs: ServerConfigs) => ReactNode;
};
/**
 * The homeserver's capabilities, media config and OIDC metadata. A homeserver with no OIDC (and the demo's pretend
 * server) returns no auth metadata: there is nothing to validate, so nothing is logged. Metadata that did come back
 * and fails validation is logged and dropped.
 */
export async function loadServerConfigs(
  mx: Pick<MatrixClient, 'getCapabilities' | 'getMediaConfig' | 'getAuthMetadata'>
): Promise<ServerConfigs> {
  const result = await Promise.allSettled([
    mx.getCapabilities(),
    mx.getMediaConfig(),
    mx.getAuthMetadata(),
  ]);

  const capabilities = promiseFulfilledResult(result[0]);
  const mediaConfig = promiseFulfilledResult(result[1]);
  const authMetadata = promiseFulfilledResult(result[2]);
  let validatedAuthMetadata: ValidatedAuthMetadata | undefined;

  if (authMetadata) {
    try {
      validatedAuthMetadata = validateAuthMetadata(authMetadata);
    } catch (e) {
      console.error(e);
    }
  }

  return { capabilities, mediaConfig, authMetadata: validatedAuthMetadata };
}

export function ServerConfigsLoader({ children }: ServerConfigsLoaderProps) {
  const mx = useMatrixClient();
  const fallbackConfigs = useMemo(() => ({}), []);

  const [configsState] = useAsyncCallbackValue<ServerConfigs, unknown>(
    useCallback(() => loadServerConfigs(mx), [mx])
  );

  const configs: ServerConfigs =
    configsState.status === AsyncStatus.Success ? configsState.data : fallbackConfigs;

  return children(configs);
}
