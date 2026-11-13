import { createContext, useContext } from 'react';
import type { DingsConfig } from '../features/dings/dings';
import type { BackgroundSceneConfig } from '../features/scene/tier';
import type { PushConfig } from '../features/push/config';

export type HashRouterConfig = {
  enabled?: boolean;
  basename?: string;
};

export type RegistrationConfig = {
  enabled?: boolean;
  url?: string;
};

export type ClientConfig = {
  defaultHomeserver?: number;
  homeserverList?: string[];
  allowCustomHomeservers?: boolean;

  featuredCommunities?: {
    openAsDefault?: boolean;
    spaces?: string[];
    rooms?: string[];
    servers?: string[];
  };

  hashRouter?: HashRouterConfig;

  backgroundScene?: BackgroundSceneConfig;

  // Per-Mind notification earcons (src/app/features/dings). Off unless `enabled: true`.
  dings?: DingsConfig;

  // Rooms (ids or aliases) shown as the album view; a room whose create type is org.gamecult.file_zone needs no entry.
  fileZoneRooms?: string[];

  // Sharing a set of files into a file-zone room as one album. Off unless `enabled` is true.
  fileZoneShare?: { enabled?: boolean };

  // The Files desk (docs/commons-files-desk.md): a served-directory file zone beside the Matrix one. Off unless
  // `enabled` is true; `host` is the file host's base URL (a value Eureka names, never a path this client invents).
  filesDesk?: { enabled?: boolean; host?: string };

  // The sign-up entry on the sign-in page. Off unless `enabled` is true; `url` is the account
  // service's own registration page (a value, never a route this client invents).
  registration?: RegistrationConfig;

  // Web Push to the installed app (src/app/features/push). Off unless all three keys are filled; ships empty.
  push?: PushConfig;

  // Dev preview only: the build answers a pretend homeserver in-page (src/preview-demo).
  previewDemo?: boolean;
};

const ClientConfigContext = createContext<ClientConfig | null>(null);

export const ClientConfigProvider = ClientConfigContext.Provider;

export function useClientConfig(): ClientConfig {
  const config = useContext(ClientConfigContext);
  if (!config) throw new Error('Client config are not provided!');
  return config;
}

export const clientDefaultServer = (clientConfig: ClientConfig): string =>
  clientConfig.homeserverList?.[clientConfig.defaultHomeserver ?? 0] ?? 'chat.gamecult.org';

export const clientAllowedServer = (clientConfig: ClientConfig, server: string): boolean => {
  const { homeserverList, allowCustomHomeservers } = clientConfig;

  if (allowCustomHomeservers) return true;

  return homeserverList?.includes(server) === true;
};
